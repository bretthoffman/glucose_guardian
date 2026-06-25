import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  diagnosticMessageKey,
  failureCategoryToDiagnostic,
  reconnectRequiredForDiagnostic,
  type ProviderDiagnosticCategory,
} from "./cgm/diagnostics";
import type { FailureCategory } from "./cgm/core";

async function assertPatientAuth(
  ctx: QueryCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function resolveDiagnostic(
  row: {
    providerDiagnosticCategory?: string;
    providerDiagnosticMessageKey?: string;
    lastFailureCategory?: string;
    status: string;
    lastReadingTimestamp?: string;
  },
  hasCredentials: boolean,
): { category: ProviderDiagnosticCategory; messageKey: string; reconnectRequired: boolean } {
  if (row.providerDiagnosticCategory) {
    const category = row.providerDiagnosticCategory as ProviderDiagnosticCategory;
    return {
      category,
      messageKey: row.providerDiagnosticMessageKey ?? diagnosticMessageKey(category),
      reconnectRequired: reconnectRequiredForDiagnostic(category),
    };
  }
  if (!hasCredentials) {
    const category: ProviderDiagnosticCategory = "no_credentials";
    return {
      category,
      messageKey: diagnosticMessageKey(category),
      reconnectRequired: true,
    };
  }
  if (row.status === "needs_reconnect") {
    const category = failureCategoryToDiagnostic(
      (row.lastFailureCategory as FailureCategory | undefined) ?? "invalid_credentials",
    );
    return {
      category,
      messageKey: diagnosticMessageKey(category),
      reconnectRequired: true,
    };
  }
  if (row.status === "connected_no_data") {
    const category: ProviderDiagnosticCategory = "connected_no_data";
    return { category, messageKey: diagnosticMessageKey(category), reconnectRequired: false };
  }
  if (row.status === "no_shared_patient") {
    const category: ProviderDiagnosticCategory = "no_shared_patient";
    return { category, messageKey: diagnosticMessageKey(category), reconnectRequired: false };
  }
  if (row.lastReadingTimestamp) {
    const category: ProviderDiagnosticCategory = "connected";
    return { category, messageKey: diagnosticMessageKey(category), reconnectRequired: false };
  }
  const category: ProviderDiagnosticCategory = "connected";
  return { category, messageKey: diagnosticMessageKey(category), reconnectRequired: false };
}

/**
 * Client-safe CGM sync/connection state for the authenticated patient.
 * Never returns credentials, tokens, raw errors, or another user's data.
 */
export const getSyncStatus = query({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) return null;

    const conn = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!conn) {
      return { connected: false as const };
    }

    const syncRow = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", conn.type))
      .unique();

    const dexcomCreds = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const libreCreds = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const hasCredentials =
      conn.type === "dexcom" ? dexcomCreds !== null : libreCreds !== null;

    const diagnostic = syncRow
      ? resolveDiagnostic(syncRow, hasCredentials)
      : hasCredentials
        ? {
            category: "connected" as ProviderDiagnosticCategory,
            messageKey: diagnosticMessageKey("connected"),
            reconnectRequired: false,
          }
        : {
            category: "no_credentials" as ProviderDiagnosticCategory,
            messageKey: diagnosticMessageKey("no_credentials"),
            reconnectRequired: true,
          };

    return {
      connected: true as const,
      provider: conn.type,
      status: syncRow?.status ?? "pending",
      lastAttemptAt: syncRow?.lastAttemptAt ?? null,
      lastSuccessAt: syncRow?.lastSuccessAt ?? null,
      lastReadingTimestamp: syncRow?.lastReadingTimestamp ?? null,
      nextEligibleAt: syncRow?.nextEligibleAt ?? null,
      hasStoredCredentials: hasCredentials,
      diagnosticCategory: diagnostic.category,
      messageKey: diagnostic.messageKey,
      reconnectRequired: diagnostic.reconnectRequired,
      libreConnectionCount: syncRow?.libreConnectionCount ?? null,
      multiConnectionDetected:
        conn.type === "libre" && (syncRow?.libreConnectionCount ?? 0) > 1 ? true : false,
    };
  },
});
