/**
 * Care Circle direct messaging — in-app conversations between the participants of one patient's
 * circle. A participant is an ENDPOINT, keyed as:
 *   - `user:<userId>`  a guardian (the patient/owner account or an active co-guardian)
 *   - `code:<CODE>`    an access code (kid "child" code or "caregiver" code). A signed-in nurse
 *                      account viewing via a code messages AS that code, so from the other side it
 *                      is indistinguishable from an accountless code holder.
 *
 * A THREAD is the two endpoint keys sorted and joined with "|". Threads are DERIVED from the circle
 * roster (guardians × codes, and code × code) — never stored — so a freshly created code's threads
 * exist and are usable before the code is ever signed into. There are deliberately NO
 * guardian↔guardian threads (co-guardians already share the circle).
 *
 * Authorization mirrors careLogs.ts: a caller is either an authenticated guardian (owner or active
 * co-guardian of `patientUserId`) or an access code. Messaging is ALWAYS on — it ignores the `chat`
 * permission grant — but a code endpoint is still gated by its schedule window (`careAccessAllowed`),
 * so out-of-window the code resolves to no viewer (empty board), matching the app-wide access lock.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { careAccessAllowed, type CareAccess } from "./careSchedule";

const MAX_TEXT = 1000;

// ─── local auth / identity helpers (same pattern as careLogs.ts) ─────────────────────────────

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

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

/** Canonical thread id: the two endpoint keys sorted so either side computes the same value. */
const threadKeyOf = (a: string, b: string) => [a, b].sort().join("|");

function endpointKind(key: string, codes: AccessCodeRow[]): "guardian" | "child" | "caregiver" {
  if (isGuardianKey(key)) return "guardian";
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
  if (isGuardianKey(key)) return await guardianDisplayName(ctx, keyValue(key) as Id<"users">);
  const row = codes.find((c) => c.code === keyValue(key));
  if (!row) return "Caregiver";
  if ((row.kind ?? "caregiver") === "child") return await patientDisplayName(ctx, patientUserId);
  return row.label;
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
  if (args.userId && args.passwordHash && args.patientUserId) {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    if (args.userId !== args.patientUserId && !(await isActiveCoGuardian(ctx, args.patientUserId, args.userId))) {
      return null;
    }
    return { key: guardianKey(args.userId), patientUserId: args.patientUserId };
  }
  return null;
}

/** The endpoint keys a viewer may converse with (excludes themselves + guardian↔guardian). */
function counterpartsFor(viewer: Viewer, guardianIds: Id<"users">[], codes: AccessCodeRow[]): string[] {
  if (isGuardianKey(viewer.key)) {
    // Guardians only message access codes.
    return codes.map((c) => codeKey(c.code));
  }
  const myCode = keyValue(viewer.key);
  return [
    ...guardianIds.map((g) => guardianKey(g)),
    ...codes.filter((c) => c.code !== myCode).map((c) => codeKey(c.code)),
  ];
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
    const counterparts = counterpartsFor(viewer, guardianIds, codes);

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
        otherKind: endpointKind(other, codes),
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
    if (!viewer) throw new Error("Messaging unavailable");

    const eps = args.threadKey.split("|");
    if (eps.length !== 2 || !eps.includes(viewer.key)) throw new Error("Not your conversation");
    const other = eps[0] === viewer.key ? eps[1] : eps[0];
    if (other === viewer.key) throw new Error("Invalid conversation");
    if (isGuardianKey(viewer.key) && isGuardianKey(other)) throw new Error("Not allowed");

    // The other endpoint must still be a current member of this circle.
    const codes = await activeCircleCodes(ctx, viewer.patientUserId);
    if (isGuardianKey(other)) {
      const guardianIds = await circleGuardianIds(ctx, viewer.patientUserId);
      if (!guardianIds.includes(keyValue(other) as Id<"users">)) {
        throw new Error("That person is no longer in this circle");
      }
    } else if (!codes.some((c) => c.code === keyValue(other))) {
      throw new Error("That access code is no longer active");
    }

    const text = args.text.trim();
    if (!text) throw new Error("Empty message");
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
