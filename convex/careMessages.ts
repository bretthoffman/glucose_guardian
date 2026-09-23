/**
 * Care Circle direct messaging — in-app conversations between the participants of one patient's
 * circle. A participant is an ENDPOINT, keyed as:
 *   - `user:<userId>`  a guardian (the patient/owner account or an active co-guardian)
 *   - `code:<CODE>`    an access code (kid "child" code or "caregiver" code). A signed-in nurse
 *                      account viewing via a code messages AS that code, so from the other side it
 *                      is indistinguishable from an accountless code holder.
 *   - `doctor:<id>`    a linked doctor (portal). Reachable ONLY from caregiver codes that doctor has
 *                      tagged as a School Nurse — parents talk to the doctor in the portal’s guardian
 *                      thread, and family members never get a doctor chat (see nurseDoctorIds).
 *
 * A THREAD is the two endpoint keys sorted and joined with "|". Threads are DERIVED from the circle
 * roster — EVERY pair of participants gets one (guardian↔code, code↔code, and guardian↔guardian for
 * co-guardians) — and are never stored, so a thread exists and is usable the moment the participant
 * does: creating an access code, or accepting a co-guardian invite, immediately gives every other
 * member a thread with them (and them a thread with each member), before either side ever opens it.
 *
 * Authorization mirrors careLogs.ts: a caller is either an authenticated guardian (owner or active
 * co-guardian of `patientUserId`) or an access code. Messaging is ALWAYS on — it ignores the `chat`
 * permission grant — but a code endpoint is still gated by its schedule window (`careAccessAllowed`),
 * so out-of-window the code resolves to no viewer (empty board), matching the app-wide access lock.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { userCompat } from "./identity";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import {
  caregiverKey,
  findPatientProfileByDoctorCode,
  getActiveLink,
  normalizeAccessCode,
  requireDoctorApiSecret,
} from "./doctorAccounts";

const MAX_TEXT = 1000;

// ─── local auth / identity helpers (same pattern as careLogs.ts) ─────────────────────────────

function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function patientDisplayName(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">): Promise<string> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  return profile?.childName?.trim() || "Patient";
}

/** The guardian's OWN display name (never the child they care for) — see careLogs.guardianDisplayName. */
async function guardianDisplayName(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const parent = profile?.parentName?.trim();
  if (parent) return parent;
  if (profile?.accountRole === "adult" || profile?.accountRole === "caregiver") {
    const own = profile.childName?.trim();
    if (own) return own;
  }
  const user = await ctx.db.get(userId);
  const handle = user?.email?.split("@")[0]?.trim();
  if (handle) return handle;
  return profile?.childName?.trim() || "Guardian";
}

async function resolveActiveAccessCode(ctx: QueryCtx | MutationCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== 8) return null;
  const row = await ctx.db
    .query("careAccessCodes")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
  return row && row.status === "active" ? row : null;
}

async function activeCoGuardianLinks(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("careLinks")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId).eq("status", "active"))
    .collect();
}

async function isActiveCoGuardian(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  memberUserId: Id<"users">,
): Promise<boolean> {
  const links = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", memberUserId),
    )
    .collect();
  return links.some((l) => l.status === "active");
}

type AccessCodeRow = Awaited<ReturnType<typeof activeCircleCodes>>[number];

async function activeCircleCodes(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("careAccessCodes")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId).eq("status", "active"))
    .collect();
}

/** All guardian user ids in the circle: the owner first, then active co-guardians. */
async function circleGuardianIds(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">): Promise<Id<"users">[]> {
  const links = await activeCoGuardianLinks(ctx, patientUserId);
  return [patientUserId, ...links.map((l) => l.memberUserId)];
}

// ─── endpoint keys + thread keys ─────────────────────────────────────────────────────────────

const guardianKey = (id: Id<"users">) => `user:${id}`;
const codeKey = (code: string) => `code:${code}`;
const isGuardianKey = (key: string) => key.startsWith("user:");
const keyValue = (key: string) => key.slice(5); // strip "user:" / "code:"

const DOCTOR_PREFIX = "doctor:";
const doctorKey = (id: Id<"doctorAccounts">) => `${DOCTOR_PREFIX}${id}`;
const isDoctorKey = (key: string) => key.startsWith(DOCTOR_PREFIX);
const doctorIdOf = (key: string) => key.slice(DOCTOR_PREFIX.length) as Id<"doctorAccounts">;

/** Canonical thread id: the two endpoint keys sorted so either side computes the same value. */
const threadKeyOf = (a: string, b: string) => [a, b].sort().join("|");

export type EndpointRole = "guardian" | "co-guardian" | "child" | "caregiver" | "adult" | "doctor";

/**
 * The ROLE of an endpoint, for the little qualifier beside a name in the thread list.
 *
 * Three cases the old three-value version couldn't express:
 *  - an ADULT managing their own diabetes is not anyone's guardian, and needs no qualifier at all —
 *    they're the person the app is about, which is self-evident;
 *  - once a circle holds more than one guardian they are CO-guardians, and both should say so;
 *  - a caregiver EMAIL account is a caregiver, same as a caregiver code.
 *
 * `guardianCount` is the circle's owner plus its active co-guardians, so this flips to "co-guardian"
 * the moment a second guardian joins and back to "guardian" if they leave — no stored state.
 */
async function endpointRole(
  ctx: QueryCtx | MutationCtx,
  key: string,
  codes: AccessCodeRow[],
  guardianCount: number,
): Promise<EndpointRole> {
  if (isDoctorKey(key)) return "doctor";
  if (isGuardianKey(key)) {
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", keyValue(key) as Id<"users">))
      .unique();
    // A caregiver (nurse) EMAIL account is a caregiver, not a guardian.
    if (profile?.accountRole === "caregiver") return "caregiver";
    if (profile?.accountRole === "adult") return "adult";
    return guardianCount > 1 ? "co-guardian" : "guardian";
  }
  const row = codes.find((c) => c.code === keyValue(key));
  return (row?.kind ?? "caregiver") === "child" ? "child" : "caregiver";
}

/**
 * The canonical name of an endpoint — a property of the endpoint itself, not the viewer, so each
 * side automatically shows the OTHER endpoint's name: a guardian's own name, the kid's name for a
 * child code, or the code's label for a caregiver code.
 */
async function endpointName(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  key: string,
  codes: AccessCodeRow[],
): Promise<string> {
  if (isDoctorKey(key)) return await doctorFormalName(ctx, doctorIdOf(key));
  if (isGuardianKey(key)) return await guardianDisplayName(ctx, keyValue(key) as Id<"users">);
  const row = codes.find((c) => c.code === keyValue(key));
  if (!row) return "Caregiver";
  if ((row.kind ?? "caregiver") === "child") return await patientDisplayName(ctx, patientUserId);
  return row.label;
}

/** "Dr. Rivera": the doctor’s title + last name, else their display name. */
async function doctorFormalName(ctx: QueryCtx | MutationCtx, doctorId: Id<"doctorAccounts">): Promise<string> {
  const doctor = await ctx.db.get(doctorId);
  const formal = [doctor?.title, doctor?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return formal || doctor?.displayName?.trim() || "Doctor";
}

/** The patient’s current doctor code (normalized), which is what doctor links are keyed by. */
async function patientDoctorCode(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">): Promise<string | null> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  return profile?.doctorCode ? normalizeAccessCode(profile.doctorCode) : null;
}

/** Names of the nurse (caregiver) accounts that added this code — the names on their logs. */
async function codeAccountNames(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  code: string,
): Promise<string[]> {
  const links = await ctx.db
    .query("caregiverLinks")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .collect();
  const names: string[] = [];
  for (const link of links) {
    if (link.code === code) names.push(await guardianDisplayName(ctx, link.caregiverUserId));
  }
  return names;
}

/**
 * The doctors a caregiver code may message: doctors linked to the patient who have tagged this
 * code — by its label, or by the name of a nurse account using it — as a School Nurse in the
 * portal. Everyone else in the circle stays out of doctor chats.
 */
async function nurseDoctorIds(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  code: AccessCodeRow,
): Promise<Id<"doctorAccounts">[]> {
  if ((code.kind ?? "caregiver") !== "caregiver") return [];
  const doctorCode = await patientDoctorCode(ctx, patientUserId);
  if (!doctorCode) return [];
  const links = (
    await ctx.db
      .query("doctorPatientLinks")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", doctorCode))
      .collect()
  ).filter((l) => l.revokedAt == null && l.caregiverTitles?.some((t) => t.title === "school_nurse"));
  if (!links.length) return [];
  const names = new Set(
    [code.label, ...(await codeAccountNames(ctx, patientUserId, code.code))].map(caregiverKey),
  );
  return links
    .filter((l) =>
      l.caregiverTitles!.some((t) => t.title === "school_nurse" && names.has(caregiverKey(t.name))),
    )
    .map((l) => l.doctorId);
}

// ─── viewer resolution ───────────────────────────────────────────────────────────────────────

/** Shared arg shape: EITHER guardian creds (userId+passwordHash+patientUserId) OR an access code. */
const viewerArgs = {
  userId: v.optional(v.id("users")),
  passwordHash: v.optional(v.string()),
  patientUserId: v.optional(v.id("users")),
  code: v.optional(v.string()),
};

interface Viewer {
  key: string;
  patientUserId: Id<"users">;
}

async function resolveViewer(
  ctx: QueryCtx | MutationCtx,
  args: { userId?: Id<"users">; passwordHash?: string; patientUserId?: Id<"users">; code?: string },
): Promise<Viewer | null> {
  // Access-code endpoint — schedule-gated (out-of-window ⇒ no viewer ⇒ locked board).
  if (args.code != null) {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return null;
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    return { key: codeKey(row.code), patientUserId: row.patientUserId };
  }
  // Guardian endpoint — must be the owner or an active co-guardian of patientUserId.
  if (args.patientUserId) {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    if (user._id !== args.patientUserId && !(await isActiveCoGuardian(ctx, args.patientUserId, user._id))) {
      return null;
    }
    return { key: guardianKey(user._id), patientUserId: args.patientUserId };
  }
  return null;
}

/**
 * The endpoint keys a viewer may converse with: everyone else in the circle. Every participant pair
 * gets a thread — guardian↔code, code↔code, and guardian↔guardian (co-guardians) — so linking two
 * accounts immediately creates a thread between them, exactly like creating an access code does.
 * Only the viewer themselves is excluded.
 */
function counterpartsFor(
  viewer: Viewer,
  guardianIds: Id<"users">[],
  codes: AccessCodeRow[],
  doctorIds: Id<"doctorAccounts">[] = [],
): string[] {
  const myCode = isGuardianKey(viewer.key) ? null : keyValue(viewer.key);
  return [
    ...guardianIds.map((g) => guardianKey(g)).filter((k) => k !== viewer.key),
    ...codes.filter((c) => c.code !== myCode).map((c) => codeKey(c.code)),
    ...doctorIds.map(doctorKey),
  ];
}

/** Doctors this viewer may message — only a caregiver code tagged School Nurse has any. */
async function viewerDoctorIds(
  ctx: QueryCtx | MutationCtx,
  viewer: Viewer,
  codes: AccessCodeRow[],
): Promise<Id<"doctorAccounts">[]> {
  if (isGuardianKey(viewer.key)) return [];
  const mine = codes.find((c) => c.code === keyValue(viewer.key));
  return mine ? await nurseDoctorIds(ctx, viewer.patientUserId, mine) : [];
}

// ─── queries + mutations ─────────────────────────────────────────────────────────────────────

/**
 * The viewer's thread list, one per available counterpart (so empty threads for brand-new codes
 * still appear). Sorted unread-first, then by most-recent activity. `unreadTotal` drives the badges.
 */
export const listThreads = query({
  args: viewerArgs,
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx, args);
    if (!viewer) return { threads: [], unreadTotal: 0 };

    const codes = await activeCircleCodes(ctx, viewer.patientUserId);
    const guardianIds = await circleGuardianIds(ctx, viewer.patientUserId);
    const doctorIds = await viewerDoctorIds(ctx, viewer, codes);
    const counterparts = counterpartsFor(viewer, guardianIds, codes, doctorIds);

    const threads = [];
    let unreadTotal = 0;
    for (const other of counterparts) {
      const threadKey = threadKeyOf(viewer.key, other);
      const msgs = await ctx.db
        .query("careMessages")
        .withIndex("by_thread", (q) =>
          q.eq("patientUserId", viewer.patientUserId).eq("threadKey", threadKey),
        )
        .collect();
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      const unread = msgs.filter((m) => m.senderKey !== viewer.key && !m.read).length;
      unreadTotal += unread;
      threads.push({
        threadKey,
        otherKind: await endpointRole(ctx, other, codes, guardianIds.length),
        otherName: await endpointName(ctx, viewer.patientUserId, other, codes),
        lastText: last?.text ?? null,
        lastAt: last?.createdAt ?? null,
        lastFromMe: last ? last.senderKey === viewer.key : false,
        unread,
      });
    }

    threads.sort((a, b) => {
      const au = a.unread > 0 ? 1 : 0;
      const bu = b.unread > 0 ? 1 : 0;
      if (au !== bu) return bu - au;
      return (b.lastAt ?? 0) - (a.lastAt ?? 0);
    });
    return { threads, unreadTotal };
  },
});

/** The messages of one thread (oldest→newest), if the viewer is one of its endpoints. */
export const listMessages = query({
  args: { ...viewerArgs, threadKey: v.string() },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx, args);
    if (!viewer) return [];
    if (!args.threadKey.split("|").includes(viewer.key)) return [];
    const msgs = await ctx.db
      .query("careMessages")
      .withIndex("by_thread", (q) =>
        q.eq("patientUserId", viewer.patientUserId).eq("threadKey", args.threadKey),
      )
      .collect();
    return msgs.map((m) => ({
      id: m._id,
      text: m.text,
      senderKey: m.senderKey,
      senderName: m.senderName,
      fromMe: m.senderKey === viewer.key,
      createdAt: m.createdAt,
    }));
  },
});

export const sendMessage = mutation({
  args: { ...viewerArgs, threadKey: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx, args);
    if (!viewer) throw new ConvexError("Messaging unavailable");

    const eps = args.threadKey.split("|");
    if (eps.length !== 2 || !eps.includes(viewer.key)) throw new ConvexError("Not your conversation");
    const other = eps[0] === viewer.key ? eps[1] : eps[0];
    if (other === viewer.key) throw new ConvexError("Invalid conversation");

    // The other endpoint must still be a current member of this circle.
    const codes = await activeCircleCodes(ctx, viewer.patientUserId);
    if (isDoctorKey(other)) {
      if (!(await viewerDoctorIds(ctx, viewer, codes)).includes(doctorIdOf(other))) {
        throw new ConvexError("This doctor isn’t available to message");
      }
    } else if (isGuardianKey(other)) {
      const guardianIds = await circleGuardianIds(ctx, viewer.patientUserId);
      if (!guardianIds.includes(keyValue(other) as Id<"users">)) {
        throw new ConvexError("That person is no longer in this circle");
      }
    } else if (!codes.some((c) => c.code === keyValue(other))) {
      throw new ConvexError("That access code is no longer active");
    }

    const text = args.text.trim();
    if (!text) throw new ConvexError("Empty message");
    const senderName = await endpointName(ctx, viewer.patientUserId, viewer.key, codes);
    const id = await ctx.db.insert("careMessages", {
      patientUserId: viewer.patientUserId,
      threadKey: args.threadKey,
      senderKey: viewer.key,
      senderName,
      text: text.slice(0, MAX_TEXT),
      read: false,
      createdAt: Date.now(),
    });

    if (isDoctorKey(other)) {
      // Doctors have no app: flag the reply in the portal’s alert bell (no message text, since
      // alerts can be emailed).
      const doctorCode = await patientDoctorCode(ctx, viewer.patientUserId);
      if (doctorCode) {
        await ctx.db.insert("doctorAlerts", {
          doctorId: doctorIdOf(other),
          accessCode: doctorCode,
          kind: "nurse_message",
          message: `New message from ${senderName}`,
          createdAt: Date.now(),
        });
      }
      return { id };
    }

    // Push the message to the RECIPIENT endpoint only, so it lands even with the app closed.
    // Scheduled so a push failure can't fail the send.
    await ctx.scheduler.runAfter(0, internal.push.notifyMessage, {
      patientUserId: viewer.patientUserId,
      senderName,
      text: text.slice(0, MAX_TEXT),
      threadKey: args.threadKey,
      ...(isGuardianKey(other)
        ? { toUserId: keyValue(other) as Id<"users"> }
        : { toCode: keyValue(other) }),
    });
    return { id };
  },
});

/** Mark every incoming (not-from-me) message in the thread as read. */
export const markThreadRead = mutation({
  args: { ...viewerArgs, threadKey: v.string() },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx, args);
    if (!viewer) return;
    if (!args.threadKey.split("|").includes(viewer.key)) return;
    const msgs = await ctx.db
      .query("careMessages")
      .withIndex("by_thread", (q) =>
        q.eq("patientUserId", viewer.patientUserId).eq("threadKey", args.threadKey),
      )
      .collect();
    for (const m of msgs) {
      if (m.senderKey !== viewer.key && !m.read) await ctx.db.patch(m._id, { read: true });
    }
  },
});

// ─── doctor portal side (api-server, doctor API secret) ──────────────────────────────────────
// The portal never sees access codes: caregiver codes are referenced by their document id, and
// thread keys (which contain the code) stay server-side.

const doctorArgs = {
  serverSecret: v.string(),
  doctorId: v.id("doctorAccounts"),
  accessCode: v.string(),
};

/** The linked patient behind a doctor's request; the api-server has already checked the link. */
async function doctorPatient(
  ctx: QueryCtx | MutationCtx,
  args: { serverSecret: string; doctorId: Id<"doctorAccounts">; accessCode: string },
) {
  requireDoctorApiSecret(args.serverSecret);
  const code = normalizeAccessCode(args.accessCode);
  if (!(await getActiveLink(ctx, args.doctorId, code))) throw new ConvexError("No access to this patient");
  return await findPatientProfileByDoctorCode(ctx, code);
}

/**
 * Who is in the patient's Care Circle right now, for the portal sidebar: the account owner,
 * co-guardians, and active access codes (with any nurse accounts using them). `messaging` says how
 * this doctor can reach them — "parents" = the portal's guardian thread, "nurse" = a Care Circle
 * chat (caregiver codes this doctor tagged School Nurse), null = not messageable.
 */
export const doctorCareCircle = query({
  args: doctorArgs,
  handler: async (ctx, args) => {
    const profile = await doctorPatient(ctx, args);
    if (!profile) return { members: [] };
    const patientUserId = profile.userId;
    const codes = await activeCircleCodes(ctx, patientUserId);
    const accountLinks = await ctx.db
      .query("caregiverLinks")
      .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
      .collect();

    const members = [];
    for (const [i, userId] of (await circleGuardianIds(ctx, patientUserId)).entries()) {
      members.push({
        id: `user:${userId}`,
        name: await guardianDisplayName(ctx, userId),
        kind: i > 0 ? "co_guardian" : profile.accountRole === "adult" ? "patient" : "owner",
        accounts: [] as { name: string; organization?: string }[],
        lastUsedAt: undefined as number | undefined,
        messaging: "parents" as "parents" | "nurse" | null,
      });
    }
    for (const code of codes) {
      if ((code.kind ?? "caregiver") === "child") {
        members.push({
          id: `code:${code._id}`,
          name: await patientDisplayName(ctx, patientUserId),
          kind: "patient_device",
          accounts: [],
          lastUsedAt: code.lastUsedAt,
          messaging: null,
        });
        continue;
      }
      const accounts: { name: string; organization?: string }[] = [];
      for (const link of accountLinks.filter((l) => l.code === code.code)) {
        const nurse = await ctx.db
          .query("patientProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", link.caregiverUserId))
          .unique();
        accounts.push({
          name: await guardianDisplayName(ctx, link.caregiverUserId),
          organization: nurse?.organization?.trim() || undefined,
        });
      }
      const nurse = (await nurseDoctorIds(ctx, patientUserId, code)).includes(args.doctorId);
      members.push({
        id: `code:${code._id}`,
        name: code.label,
        kind: "caregiver_code",
        accounts,
        lastUsedAt: code.lastUsedAt,
        messaging: nurse ? ("nurse" as const) : null,
      });
    }
    return { members };
  },
});

/** This doctor's chats with the circle's school nurses (oldest→newest messages per chat). */
export const doctorNurseThreads = query({
  args: doctorArgs,
  handler: async (ctx, args) => {
    const profile = await doctorPatient(ctx, args);
    if (!profile) return { threads: [] };
    const me = doctorKey(args.doctorId);
    const threads = [];
    for (const code of await activeCircleCodes(ctx, profile.userId)) {
      if (!(await nurseDoctorIds(ctx, profile.userId, code)).includes(args.doctorId)) continue;
      const threadKey = threadKeyOf(codeKey(code.code), me);
      const msgs = await ctx.db
        .query("careMessages")
        .withIndex("by_thread", (q) => q.eq("patientUserId", profile.userId).eq("threadKey", threadKey))
        .collect();
      threads.push({
        codeId: code._id,
        name: code.label,
        messages: msgs.map((m) => ({
          id: m._id,
          text: m.text,
          fromDoctor: m.senderKey === me,
          senderName: m.senderName,
          createdAt: m.createdAt,
        })),
        unread: msgs.filter((m) => m.senderKey !== me && !m.read).length,
      });
    }
    return { threads };
  },
});

async function nurseThreadFor(
  ctx: QueryCtx | MutationCtx,
  args: { serverSecret: string; doctorId: Id<"doctorAccounts">; accessCode: string; codeId: Id<"careAccessCodes"> },
) {
  const profile = await doctorPatient(ctx, args);
  const code = await ctx.db.get(args.codeId);
  if (!profile || !code || code.patientUserId !== profile.userId || code.status !== "active") {
    throw new ConvexError("That caregiver is no longer in this circle");
  }
  if (!(await nurseDoctorIds(ctx, profile.userId, code)).includes(args.doctorId)) {
    throw new ConvexError("Only caregivers you've tagged as School Nurse can be messaged");
  }
  return {
    patientUserId: profile.userId,
    code,
    threadKey: threadKeyOf(codeKey(code.code), doctorKey(args.doctorId)),
  };
}

export const doctorSendNurseMessage = mutation({
  args: { ...doctorArgs, codeId: v.id("careAccessCodes"), text: v.string() },
  handler: async (ctx, args) => {
    const { patientUserId, code, threadKey } = await nurseThreadFor(ctx, args);
    const text = args.text.trim();
    if (!text) throw new ConvexError("Empty message");
    const senderName = await doctorFormalName(ctx, args.doctorId);
    const id = await ctx.db.insert("careMessages", {
      patientUserId,
      threadKey,
      senderKey: doctorKey(args.doctorId),
      senderName,
      text: text.slice(0, MAX_TEXT),
      read: false,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.push.notifyMessage, {
      patientUserId,
      senderName,
      text: text.slice(0, MAX_TEXT),
      threadKey,
      toCode: code.code,
    });
    return { id };
  },
});

export const doctorMarkNurseThreadRead = mutation({
  args: { ...doctorArgs, codeId: v.id("careAccessCodes") },
  handler: async (ctx, args) => {
    const { patientUserId, threadKey } = await nurseThreadFor(ctx, args);
    const me = doctorKey(args.doctorId);
    const msgs = await ctx.db
      .query("careMessages")
      .withIndex("by_thread", (q) => q.eq("patientUserId", patientUserId).eq("threadKey", threadKey))
      .collect();
    for (const m of msgs) {
      if (m.senderKey !== me && !m.read) await ctx.db.patch(m._id, { read: true });
    }
  },
});
