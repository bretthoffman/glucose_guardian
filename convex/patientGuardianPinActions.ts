"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { hashGuardianPin, verifyGuardianPinHash } from "./guardianPin/hashNode";
import { isValidGuardianPinFormat } from "./guardianPin/validate";

type SetupResult =
  | { result: "ok" }
  | { result: "unauthorized" }
  | { result: "invalid_format" }
  | { result: "mismatch" }
  | { result: "already_active" }
  | { result: "persist_failed" };

type VerifyResult =
  | { result: "verified" }
  | { result: "invalid" }
  | { result: "temporarily_locked"; lockoutRemainingMs: number }
  | { result: "setup_required" }
  | { result: "unauthorized" };

type ChangeResult =
  | { result: "ok" }
  | { result: "unauthorized" }
  | { result: "invalid_format" }
  | { result: "mismatch" }
  | { result: "setup_required" }
  | { result: "invalid_current" }
  | { result: "temporarily_locked"; lockoutRemainingMs?: number }
  | { result: "persist_failed" };

type PinRow = {
  state: "active";
  pinHash: string;
  pinSalt: string;
  lockoutUntil?: number;
  migrationMarker?: string;
};

/** Establish a new Guardian PIN (authorized account owner only). */
export const setupPin = action({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    pin: v.string(),
    pinConfirm: v.string(),
  },
  handler: async (ctx, args): Promise<SetupResult> => {
    const authOk = await ctx.runQuery(internal.guardianPin.internal.assertAuth, {
      userId: args.userId,
      passwordHash: args.passwordHash,
    });
    if (!authOk) return { result: "unauthorized" as const };

    if (!isValidGuardianPinFormat(args.pin) || !isValidGuardianPinFormat(args.pinConfirm)) {
      return { result: "invalid_format" as const };
    }
    if (args.pin !== args.pinConfirm) {
      return { result: "mismatch" as const };
    }

    const row = await ctx.runQuery(internal.guardianPin.internal.getRow, { userId: args.userId });
    if (row?.state === "active" && row.pinHash && row.pinSalt && !row.migrationMarker) {
      return { result: "already_active" as const };
    }

    const { pinHash, pinSalt } = hashGuardianPin(args.pin);
    const migrationMarker =
      row && (!row.pinHash || !row.pinSalt || row.migrationMarker)
        ? row.migrationMarker ?? "legacy_recovery_setup"
        : undefined;
    try {
      await ctx.runMutation(internal.guardianPin.internal.persistPin, {
        userId: args.userId,
        passwordHash: args.passwordHash,
        pinHash,
        pinSalt,
        migrationMarker,
      });
    } catch {
      return { result: "persist_failed" as const };
    }
    return { result: "ok" as const };
  },
});

/** Verify candidate PIN server-side; throttles repeated failures. */
export const verifyPin = action({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    pin: v.string(),
  },
  handler: async (ctx, args): Promise<VerifyResult> => {
    const now = Date.now();
    const authOk = await ctx.runQuery(internal.guardianPin.internal.assertAuth, {
      userId: args.userId,
      passwordHash: args.passwordHash,
    });
    if (!authOk) return { result: "unauthorized" };

    if (!isValidGuardianPinFormat(args.pin)) {
      return { result: "invalid" };
    }

    const row = (await ctx.runQuery(internal.guardianPin.internal.getRow, {
      userId: args.userId,
    })) as PinRow | null;
    if (!row || row.state !== "active" || !row.pinHash || !row.pinSalt) {
      return { result: "setup_required" as const };
    }

    if (row.lockoutUntil != null && row.lockoutUntil > now) {
      return {
        result: "temporarily_locked" as const,
        lockoutRemainingMs: row.lockoutUntil - now,
      };
    }

    const valid = verifyGuardianPinHash(args.pin, row.pinHash, row.pinSalt);
    if (!valid) {
      const attempt = (await ctx.runMutation(internal.guardianPin.internal.recordFailedAttempt, {
        userId: args.userId,
        passwordHash: args.passwordHash,
        now,
      })) as { failedAttempts: number; lockoutUntil?: number };
      if (attempt.lockoutUntil != null && attempt.lockoutUntil > now) {
        return {
          result: "temporarily_locked" as const,
          lockoutRemainingMs: attempt.lockoutUntil - now,
        };
      }
      return { result: "invalid" as const };
    }

    await ctx.runMutation(internal.guardianPin.internal.resetFailedAttempts, {
      userId: args.userId,
      passwordHash: args.passwordHash,
      now,
    });
    return { result: "verified" as const };
  },
});

/** Change an active PIN — requires current PIN verification. */
export const changePin = action({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    currentPin: v.string(),
    newPin: v.string(),
    newPinConfirm: v.string(),
  },
  handler: async (ctx, args): Promise<ChangeResult> => {
    const now = Date.now();
    const authOk = await ctx.runQuery(internal.guardianPin.internal.assertAuth, {
      userId: args.userId,
      passwordHash: args.passwordHash,
    });
    if (!authOk) return { result: "unauthorized" };

    if (
      !isValidGuardianPinFormat(args.currentPin) ||
      !isValidGuardianPinFormat(args.newPin) ||
      !isValidGuardianPinFormat(args.newPinConfirm)
    ) {
      return { result: "invalid_format" };
    }
    if (args.newPin !== args.newPinConfirm) {
      return { result: "mismatch" };
    }

    const row = (await ctx.runQuery(internal.guardianPin.internal.getRow, {
      userId: args.userId,
    })) as PinRow | null;
    if (!row || row.state !== "active" || !row.pinHash || !row.pinSalt) {
      return { result: "setup_required" as const };
    }
    if (row.lockoutUntil != null && row.lockoutUntil > now) {
      return {
        result: "temporarily_locked" as const,
        lockoutRemainingMs: row.lockoutUntil - now,
      };
    }
    if (!verifyGuardianPinHash(args.currentPin, row.pinHash, row.pinSalt)) {
      const attempt = (await ctx.runMutation(internal.guardianPin.internal.recordFailedAttempt, {
        userId: args.userId,
        passwordHash: args.passwordHash,
        now,
      })) as { failedAttempts: number; lockoutUntil?: number };
      if (attempt.lockoutUntil != null && attempt.lockoutUntil > now) {
        return {
          result: "temporarily_locked" as const,
          lockoutRemainingMs: attempt.lockoutUntil - now,
        };
      }
      return { result: "invalid_current" as const };
    }

    const { pinHash, pinSalt } = hashGuardianPin(args.newPin);
    try {
      await ctx.runMutation(internal.guardianPin.internal.persistPin, {
        userId: args.userId,
        passwordHash: args.passwordHash,
        pinHash,
        pinSalt,
      });
    } catch {
      return { result: "persist_failed" as const };
    }
    return { result: "ok" as const };
  },
});
