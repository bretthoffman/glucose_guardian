import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { v } from "convex/values";

async function assertPatientAuth(
  ctx: { db: { get: (id: Id<"users">) => Promise<{ passwordHash: string } | null> } },
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

/** Client-safe PIN state — never returns hash, salt, or raw PIN. */
export const getStatus = query({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const authOk = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!authOk) return { status: "unauthorized" as const };
    const row = await ctx.db
      .query("patientGuardianPins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();
    if (!row || row.state !== "active") {
      return { status: "not_set" as const };
    }
    if (row.lockoutUntil != null && row.lockoutUntil > now) {
      return {
        status: "temporarily_locked" as const,
        lockoutRemainingMs: row.lockoutUntil - now,
      };
    }
    return { status: "active" as const };
  },
});
