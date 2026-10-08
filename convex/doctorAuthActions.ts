"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { DOCTOR_AUTH_CONFIG as C } from "./doctorAuth/config";
import type { DoctorProfile, ThrottleEntry } from "./doctorAuth/internal";
import type { LicenseRefusal } from "./doctorAuth/licenses";
import { normalizeDomain } from "./doctorAuth/licenses";
import { requireDoctorApiSecret } from "./doctorAuth/secret";
import {
  burnPasswordCheck,
  emailCodeHash,
  hashDoctorPassword,
  inviteCodeHash,
  legacyPasswordMatches,
  newEmailCode,
  newInviteCode,
  newLicenseKey,
  verifyDoctorPassword,
} from "./doctorAuth/passwordNode";
import { emailConfigured, sendEmail } from "./email";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

type LoginResult =
  | { result: "ok"; doctor: DoctorProfile }
  | { result: "invalid" }
  | { result: "locked"; retryAfterMs: number };

/**
 * Doctor sign-in, for the api-server's POST /auth/login. The password is checked against its
 * scrypt digest — or, for an account still on the pre-scrypt value, against that, upgraded on the
 * spot. Wrong passwords count against the email (5 → locked 15 min) and the caller's IP (30), whether
 * or not the email has an account, so neither lockouts nor timing reveal which emails do.
 */
export const login = action({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LoginResult> => {
    requireDoctorApiSecret(args.serverSecret);
    const email = normalizeEmail(args.email);
    const now = Date.now();
    const throttle: ThrottleEntry[] = [
      { key: `login:email:${email}`, policy: "loginEmail" },
      ...(args.clientIp ? [{ key: `login:ip:${args.clientIp}`, policy: "loginIp" as const }] : []),
    ];
    const { retryAfterMs } = await ctx.runQuery(internal.doctorAuth.internal.lockStatus, {
      keys: throttle.map((t) => t.key),
      now,
    });
    if (retryAfterMs > 0) return { result: "locked", retryAfterMs };

    const record = await ctx.runQuery(internal.doctorAuth.internal.getLoginRecord, { email });
    let ok = false;
    if (record?.passwordDigest) {
      ok = verifyDoctorPassword(args.passwordHash, record.passwordDigest);
    } else {
      burnPasswordCheck(args.passwordHash);
      if (record?.legacyPasswordHash) ok = legacyPasswordMatches(args.passwordHash, record.legacyPasswordHash);
    }
    if (!record || !ok) {
      await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: throttle, now });
      return { result: "invalid" };
    }

    if (!record.passwordDigest) {
      await ctx.runMutation(internal.doctorAuth.internal.setPasswordDigest, {
        doctorId: record.doctorId,
        passwordDigest: hashDoctorPassword(args.passwordHash),
      });
    }
    // Only the account's counter: a success from an IP doesn't excuse its failures elsewhere.
    await ctx.runMutation(internal.doctorAuth.internal.clearThrottles, { keys: [throttle[0]!.key] });
    return { result: "ok", doctor: record.profile };
  },
});

type RegisterResult =
  | { result: "ok"; doctorId: Id<"doctorAccounts"> }
  | { result: "invalid_invite" }
  | { result: "email_taken" }
  | { result: "locked"; retryAfterMs: number };

/**
 * Create a doctor account — only with a live invite issued for that same email (see
 * createInvite). Wrong codes count against the caller's IP (10 an hour).
 */
export const registerWithInvite = action({
  args: {
    serverSecret: v.string(),
    inviteCode: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    displayName: v.string(),
    title: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    institution: v.optional(v.string()),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RegisterResult> => {
    requireDoctorApiSecret(args.serverSecret);
    const email = normalizeEmail(args.email);
    const displayName = args.displayName.trim();
    if (!email || !displayName || !args.passwordHash) {
      throw new Error("Email, password and name are required");
    }
    const now = Date.now();
    const throttle: ThrottleEntry[] = args.clientIp
      ? [{ key: `invite:ip:${args.clientIp}`, policy: "inviteIp" }]
      : [];
    if (throttle.length) {
      const { retryAfterMs } = await ctx.runQuery(internal.doctorAuth.internal.lockStatus, {
        keys: throttle.map((t) => t.key),
        now,
      });
      if (retryAfterMs > 0) return { result: "locked", retryAfterMs };
    }

    // Checked before hashing, so bad codes can't make the server do scrypt work.
    const codeHash = inviteCodeHash(args.inviteCode);
    const live = await ctx.runQuery(internal.doctorAuth.internal.checkInvite, { codeHash, email, now });
    if (!live) {
      if (throttle.length) {
        await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: throttle, now });
      }
      return { result: "invalid_invite" };
    }

    return await ctx.runMutation(internal.doctorAuth.internal.createAccountFromInvite, {
      codeHash,
      email,
      passwordDigest: hashDoctorPassword(args.passwordHash),
      displayName,
      title: args.title,
      firstName: args.firstName,
      lastName: args.lastName,
      institution: args.institution,
    });
  },
});

type Locked = { result: "locked"; retryAfterMs: number };

/** Bad codes from one IP count against `invite:ip:<ip>` (10 an hour), whichever kind they were. */
function codeThrottle(clientIp: string | undefined): ThrottleEntry[] {
  return clientIp ? [{ key: `invite:ip:${clientIp}`, policy: "inviteIp" }] : [];
}

async function lockedFor(
  ctx: { runQuery: (...a: any[]) => Promise<any> },
  throttle: ThrottleEntry[],
  now: number,
): Promise<Locked | null> {
  if (!throttle.length) return null;
  const { retryAfterMs } = await ctx.runQuery(internal.doctorAuth.internal.lockStatus, {
    keys: throttle.map((t) => t.key),
    now,
  });
  return retryAfterMs > 0 ? { result: "locked", retryAfterMs } : null;
}

type CodeDescription =
  | {
      kind: "license";
      organization: { name: string; location?: string };
      allowedDomains: string[];
      seatsAvailable: boolean;
    }
  | { kind: "invite" }
  | { kind: "invalid" };

/**
 * The home screen's first step: is this a license key (and for which organization) or an
 * invite? Unknown codes count against the caller's IP like bad invites do.
 */
export const describeAccessCode = action({
  args: { serverSecret: v.string(), code: v.string(), clientIp: v.optional(v.string()) },
  handler: async (ctx, args): Promise<CodeDescription | Locked> => {
    requireDoctorApiSecret(args.serverSecret);
    const now = Date.now();
    const throttle = codeThrottle(args.clientIp);
    const locked = await lockedFor(ctx, throttle, now);
    if (locked) return locked;
    const described: CodeDescription = await ctx.runQuery(internal.doctorAuth.licenses.describeCode, {
      codeHash: inviteCodeHash(args.code),
      now,
    });
    if (described.kind === "invalid" && throttle.length) {
      await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: throttle, now });
    }
    return described;
  },
});

type SendCodeResult =
  | { result: "sent"; organizationName: string }
  | { result: "email_unavailable" }
  | LicenseRefusal
  | Locked;

/**
 * License-key sign-up, step 1: check the key allows this email, then email it a 6-digit code
 * (a shared key doesn't prove who owns the address; the code does). Five sends per address an hour.
 */
export const sendLicenseEmailCode = action({
  args: {
    serverSecret: v.string(),
    licenseKey: v.string(),
    email: v.string(),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SendCodeResult> => {
    requireDoctorApiSecret(args.serverSecret);
    const email = normalizeEmail(args.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
    const now = Date.now();
    const throttle = codeThrottle(args.clientIp);
    const sendKey: ThrottleEntry = { key: `emailcode:send:${email}`, policy: "emailCodeSend" };
    const locked = await lockedFor(ctx, [...throttle, sendKey], now);
    if (locked) return locked;

    const keyHash = inviteCodeHash(args.licenseKey);
    const check: LicenseRefusal | { result: "ok"; organizationName: string } = await ctx.runQuery(
      internal.doctorAuth.licenses.checkLicenseForEmail,
      { keyHash, email },
    );
    if (check.result === "invalid_license" && throttle.length) {
      await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: throttle, now });
    }
    if (check.result !== "ok") return check;
    if (!emailConfigured()) return { result: "email_unavailable" };

    const code = newEmailCode();
    await ctx.runMutation(internal.doctorAuth.licenses.storeEmailCode, {
      email,
      codeHash: emailCodeHash(email, code),
      now,
    });
    await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: [sendKey], now });
    const sent = await sendEmail(
      email,
      `${code} is your Glucose Guardian verification code`,
      `<div style="font-family:system-ui,sans-serif;max-width:480px">
        <p>Enter this code to finish creating your Glucose Guardian doctor portal account for
        <strong>${escapeHtml(check.organizationName)}</strong>:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
        <p style="color:#64748b;font-size:13px">It expires in ${Math.round(C.EMAIL_CODE_VALID_MS / 60000)} minutes.
        If you didn't ask for it, you can ignore this email.</p>
      </div>`,
    );
    return sent ? { result: "sent", organizationName: check.organizationName } : { result: "email_unavailable" };
  },
});

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type LicenseRegisterResult =
  | { result: "ok"; doctorId: Id<"doctorAccounts"> }
  | { result: "invalid_email_code" }
  | LicenseRefusal
  | Locked;

/**
 * License-key sign-up, step 2: with the emailed code, create the account in the key's
 * organization. Wrong codes use up the code's 5 attempts and count against the caller's IP.
 */
export const registerWithLicense = action({
  args: {
    serverSecret: v.string(),
    licenseKey: v.string(),
    email: v.string(),
    emailCode: v.string(),
    passwordHash: v.string(),
    displayName: v.string(),
    title: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    specialty: v.optional(v.string()),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LicenseRegisterResult> => {
    requireDoctorApiSecret(args.serverSecret);
    const email = normalizeEmail(args.email);
    const displayName = args.displayName.trim();
    if (!email || !displayName || !args.passwordHash) {
      throw new Error("Email, password and name are required");
    }
    const now = Date.now();
    const throttle = codeThrottle(args.clientIp);
    const locked = await lockedFor(ctx, throttle, now);
    if (locked) return locked;

    // Checked before hashing, so bad codes can't make the server do scrypt work.
    const emailCode = emailCodeHash(email, args.emailCode);
    const { ok } = await ctx.runMutation(internal.doctorAuth.licenses.tryEmailCode, {
      email,
      codeHash: emailCode,
      now,
    });
    if (!ok) {
      if (throttle.length) {
        await ctx.runMutation(internal.doctorAuth.internal.recordFailures, { entries: throttle, now });
      }
      return { result: "invalid_email_code" };
    }

    return await ctx.runMutation(internal.doctorAuth.licenses.createAccountFromLicense, {
      keyHash: inviteCodeHash(args.licenseKey),
      email,
      emailCodeHash: emailCode,
      passwordDigest: hashDoctorPassword(args.passwordHash),
      displayName,
      title: args.title,
      firstName: args.firstName,
      lastName: args.lastName,
      specialty: args.specialty,
    });
  },
});

/**
 * Admin: add a licensed organization and issue its license key (shown only here — copy it):
 *
 *   npx convex run doctorAuthActions:createOrganization \
 *     '{"name":"Riverside Pediatrics","location":"Charlotte, NC","seats":25,"allowedDomains":["riverside.org"]}' --prod
 *
 * `allowedDomains` limits sign-up to those work-email domains (and their subdomains); leave it
 * out to allow any email. See doctorAuth/licenses for listOrganizations, updateOrganization and
 * revokeLicenseKey, and issueLicenseKey below to replace a key.
 */
export const createOrganization = internalAction({
  args: {
    name: v.string(),
    location: v.optional(v.string()),
    seats: v.number(),
    allowedDomains: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Enter the organization's name");
    if (!Number.isInteger(args.seats) || args.seats < 1) throw new Error("seats must be a whole number ≥ 1");
    const allowedDomains = (args.allowedDomains ?? []).map(normalizeDomain).filter(Boolean);
    const organizationId: Id<"doctorOrganizations"> = await ctx.runMutation(
      internal.doctorAuth.licenses.insertOrganization,
      {
        name,
        location: args.location?.trim() || undefined,
        seats: args.seats,
        allowedDomains,
        note: args.note?.trim() || undefined,
      },
    );
    const licenseKey = newLicenseKey();
    await ctx.runMutation(internal.doctorAuth.licenses.replaceLicenseKey, {
      organization: organizationId,
      keyHash: inviteCodeHash(licenseKey),
    });
    return { organizationId, name, seats: args.seats, allowedDomains, licenseKey };
  },
});

/**
 * Admin: issue a new license key for an organization (by name or id). The old key stops
 * working; accounts already created are unaffected.
 *
 *   npx convex run doctorAuthActions:issueLicenseKey '{"organization":"Riverside Pediatrics"}' --prod
 */
export const issueLicenseKey = internalAction({
  args: { organization: v.string() },
  handler: async (ctx, args): Promise<{ organization: string; licenseKey: string }> => {
    const licenseKey = newLicenseKey();
    const { name } = await ctx.runMutation(internal.doctorAuth.licenses.replaceLicenseKey, {
      organization: args.organization,
      keyHash: inviteCodeHash(licenseKey),
    });
    return { organization: name, licenseKey };
  },
});

/**
 * Admin: invite a doctor. Run it from the Convex dashboard (Functions → doctorAuthActions →
 * createInvite) or the CLI:
 *
 *   npx convex run doctorAuthActions:createInvite '{"email":"dr.lee@clinic.org"}' --prod
 *
 * then send the doctor the code. It works once, only for that email, for 14 days; a newer invite
 * for the same email replaces it. See also doctorAuth/internal:listInvites and :revokeInvites.
 */
export const createInvite = internalAction({
  args: { email: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ email: string; inviteCode: string; expires: string }> => {
    const email = normalizeEmail(args.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
    if (await ctx.runQuery(internal.doctorAuth.internal.getLoginRecord, { email })) {
      throw new Error("That email already has a doctor account");
    }
    const inviteCode = newInviteCode();
    const expiresAt = Date.now() + C.INVITE_VALID_MS;
    await ctx.runMutation(internal.doctorAuth.internal.storeInvite, {
      codeHash: inviteCodeHash(inviteCode),
      email,
      note: args.note,
      expiresAt,
    });
    return { email, inviteCode, expires: new Date(expiresAt).toISOString() };
  },
});

/**
 * One-time cleanup: give every account still on the reversible pre-scrypt value a scrypt digest
 * (sign-in already upgrades accounts as doctors use them; this covers everyone else).
 *
 *   npx convex run doctorAuthActions:migrateLegacyPasswords --prod
 */
export const migrateLegacyPasswords = internalAction({
  args: {},
  handler: async (ctx): Promise<{ migrated: number }> => {
    const legacy = await ctx.runQuery(internal.doctorAuth.internal.listLegacyPasswordAccounts, {});
    for (const account of legacy) {
      await ctx.runMutation(internal.doctorAuth.internal.setPasswordDigest, {
        doctorId: account.doctorId,
        passwordDigest: hashDoctorPassword(account.legacyPasswordHash),
      });
    }
    return { migrated: legacy.length };
  },
});
