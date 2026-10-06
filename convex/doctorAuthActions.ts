"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { DOCTOR_AUTH_CONFIG as C } from "./doctorAuth/config";
import type { DoctorProfile, ThrottleEntry } from "./doctorAuth/internal";
import { requireDoctorApiSecret } from "./doctorAuth/secret";
import {
  burnPasswordCheck,
  hashDoctorPassword,
  inviteCodeHash,
  legacyPasswordMatches,
  newInviteCode,
  verifyDoctorPassword,
} from "./doctorAuth/passwordNode";

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
