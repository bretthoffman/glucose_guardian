import { ConvexReactClient } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

export function getExpoConvexUrl(): string {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL?.trim();
  if (!url) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set. Add it to artifacts/mobile/.env");
  }
  return url;
}

/**
 * The app's single Convex client (see PREBUILD_PLAN_01 §3.2).
 *
 * Previously this module minted a NEW `ConvexHttpClient` on every call. It's now one shared
 * `ConvexReactClient` for two reasons:
 *  1. `ConvexProviderWithClerk` attaches the Clerk auth token to THIS instance and keeps it
 *     refreshed — a per-call client would be unauthenticated, and hand-rolling token refresh is the
 *     failure mode we're deliberately avoiding.
 *  2. It unlocks `useQuery` subscriptions, so the polling contexts can become real-time (Stage 2).
 *
 * Imperative `client.query()/mutation()/action()` still work exactly as before, which is why the
 * existing call sites didn't have to change.
 */
export const convex = new ConvexReactClient(getExpoConvexUrl(), {
  // React Native has no browser tab to lose focus; keep the socket up so subscriptions stay live.
  unsavedChangesWarning: false,
});

/**
 * Back-compat accessor. Returns the SHARED authenticated client rather than constructing one, so
 * every existing `createConvexAuthClient().query(...)` call site keeps working and is now
 * automatically authenticated when a guardian is signed in.
 */
export function createConvexAuthClient(): ConvexReactClient {
  return convex;
}

export { api };
