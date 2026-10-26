import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Re-arm the sync state after a credential write. The first ingest can race the
 * credential write (seen in prod: state row created, ingest failed
 * `no_credentials` and backed off for hours, credentials committed 32ms later)
 * and nothing else makes the row due again — the connection stays parked with a
 * stale diagnostic even though credentials now exist. Every credential upsert
 * calls this so the next cron tick (≤1 min) retries with the fresh credentials.
 * An in-flight lease is still respected by `claimConnection`.
 */
export async function resetSyncStateForNewCredentials(
  ctx: MutationCtx,
  userId: Id<"users">,
  provider: "dexcom" | "libre",
  now: number,
): Promise<void> {
  const row = await ctx.db
    .query("cgmSyncState")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
    .unique();
  if (!row) return;
  await ctx.db.patch(row._id, {
    consecutiveFailures: 0,
    status: "pending",
    nextEligibleAt: now,
    reconnectRequired: false,
    providerDiagnosticCategory: undefined,
    providerDiagnosticMessageKey: undefined,
    lastFailureCategory: undefined,
    updatedAt: now,
  });
}
