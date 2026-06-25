import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { LibreDiagnosticSummary } from "./cgm/diagnostics";
import { diagnosticMessageKey, reconnectRequiredForDiagnostic } from "./cgm/diagnostics";
import {
  makeLibreAdapter,
  runLibreDiagnosticFlow,
  type LibreCreds,
  type LibreSession,
} from "./cgm/providers";

const MIN_DIAGNOSTIC_INTERVAL_MS = 60_000;

/** INTERNAL: last diagnostic timestamp for throttling. */
export const getLastDiagnosticAt = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", "libre"))
      .unique();
    return row?.lastAttemptAt ?? null;
  },
});

/** INTERNAL: persist sanitized diagnostic snapshot onto cgmSyncState. */
export const persistDiagnosticSnapshot = internalMutation({
  args: {
    userId: v.id("users"),
    now: v.number(),
    summary: v.object({
      status: v.string(),
      messageKey: v.string(),
      authenticationSucceeded: v.boolean(),
      regionResolved: v.boolean(),
      apiHostLabel: v.optional(v.string()),
      connectionCount: v.number(),
      selectedConnectionFound: v.boolean(),
      graphRequestSucceeded: v.boolean(),
      readingCount: v.number(),
      latestReadingTimestamp: v.union(v.string(), v.null()),
      reconnectRequired: v.boolean(),
      retryable: v.boolean(),
      multiConnectionDetected: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", "libre"))
      .unique();
    if (!row) return;

    const s = args.summary;
    const status =
      s.status === "connected_no_data"
        ? ("connected_no_data" as const)
        : s.status === "no_shared_patient"
          ? ("no_shared_patient" as const)
          : s.reconnectRequired
            ? ("needs_reconnect" as const)
            : s.readingCount > 0
              ? ("ok" as const)
              : row.status;

    await ctx.db.patch(row._id, {
      status,
      providerDiagnosticCategory: s.status,
      providerDiagnosticMessageKey: s.messageKey,
      libreConnectionCount: s.connectionCount,
      reconnectRequired: s.reconnectRequired,
      lastAttemptAt: args.now,
      ...(s.authenticationSucceeded && !s.reconnectRequired ? { lastSuccessAt: args.now } : {}),
      updatedAt: args.now,
    });
  },
});

/**
 * Run a single bounded Libre diagnostic sequence for the authenticated patient.
 * Throttled to at most once per minute per user.
 */
export const runLibreDiagnostic = action({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args): Promise<LibreDiagnosticSummary | { error: "unauthorized" | "not_libre" | "throttled" }> => {
    const auth = await ctx.runQuery(internal.cgmIngest.authConnection, {
      userId: args.userId,
      passwordHash: args.passwordHash,
    });
    if (!auth) return { error: "unauthorized" };
    if (auth.provider !== "libre") return { error: "not_libre" };

    const lastAt = await ctx.runQuery(internal.cgmDiagnostics.getLastDiagnosticAt, {
      userId: args.userId,
    });
    const now = Date.now();
    if (lastAt && now - lastAt < MIN_DIAGNOSTIC_INTERVAL_MS) {
      return { error: "throttled" };
    }

    const target = await ctx.runQuery(internal.cgmIngest.getCredsAndSession, {
      userId: args.userId,
      provider: "libre",
    });
    if (target.provider !== "libre") return { error: "not_libre" };

    const creds: LibreCreds | null = target.creds;
    let session: LibreSession | null = target.session;

    if (!session && creds) {
      const adapter = makeLibreAdapter();
      const login = await adapter.login(creds);
      if (login.ok) {
        session = login.session;
        await ctx.runMutation(internal.cgmIngest.updateLibreSession, {
          userId: args.userId,
          token: session.token,
          libreApiBase: session.apiBase,
        });
      }
    }

    const summary = await runLibreDiagnosticFlow(creds, { existingSession: session });

    await ctx.runMutation(internal.cgmDiagnostics.persistDiagnosticSnapshot, {
      userId: args.userId,
      now,
      summary,
    });

    return summary;
  },
});
