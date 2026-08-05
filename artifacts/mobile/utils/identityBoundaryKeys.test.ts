import { describe, expect, it } from "vitest";
// `?raw` so this works in the edge-runtime test environment (no fs) — it's a build-time transform.
import authSource from "../context/AuthContext.tsx?raw";

/**
 * STRUCTURAL GUARD, not a behavior test.
 *
 * Every value the app persists lives under a single device-global AsyncStorage key — only the
 * logs-migration marker is account-scoped. That design is fine for one-account-per-device, but it
 * means correctness depends entirely on clearing the right keys at each identity boundary, and there
 * was nothing enforcing that. The consequence was a recurring family of shared-phone bugs, each
 * looking unrelated: a stale CGM connection leaking into a caregiver session, alert settings shared
 * between identities, the previous guardian's doctor conversation rendering for the next person, and
 * their logs labelled "· by you".
 *
 * Every one of those was the same root cause — a key with no clearing-list entry.
 *
 * This test fails when a new `*_KEY` is introduced in AuthContext without a decision being recorded:
 * either add it to `logout`'s `multiRemove` (cleared on identity boundary), or add it to
 * INTENTIONALLY_PERSISTENT below WITH a reason. Both are one-liners; the point is that skipping the
 * decision is no longer silent.
 */

/** Keys that deliberately survive an identity boundary. Adding an entry here requires a reason. */
const INTENTIONALLY_PERSISTENT: Record<string, string> = {
  LOGS_MIGRATED_KEY_PREFIX:
    "Account-SCOPED (suffixed with the Convex userId) and inert — importLogs is idempotent by clientId, " +
    "so a stale marker can't leak data. Only downside is unbounded growth of markers.",
  ALERT_PREFS_CODE_KEY_PREFIX:
    "CODE-SCOPED (suffixed with the access code), so it cannot leak between identities — which is the " +
    "whole reason it exists rather than reusing the device-global ALERT_PREFS_KEY. It SHOULD survive a " +
    "boundary: a caregiver or kid who turns their notifications off shouldn't have to redo it every " +
    "time they re-enter their code. Holds only device-local switches (never thresholds, which stay " +
    "inherited from the owner read-only).",
};

function keyConstantsDeclaredIn(source: string): string[] {
  // `const FOO_KEY = "@gluco_guardian_..."` / `const FOO_KEY_PREFIX = "..."`
  return [...source.matchAll(/^const ([A-Z0-9_]*KEY(?:_PREFIX)?)\s*=\s*"/gm)].map((m) => m[1]);
}

function keysImportedFromConstants(source: string): string[] {
  const m = source.match(/import\s*\{([^}]*)\}\s*from\s*"@\/constants\/storage-keys"/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.endsWith("_KEY") || s.endsWith("_STORAGE_KEY"));
}

/** The identifier list inside `logout`'s multiRemove([...]) call. */
function keysClearedByLogout(source: string): string[] {
  const start = source.indexOf("const logout = useCallback");
  expect(start, "logout should still exist in AuthContext").toBeGreaterThan(-1);
  const body = source.slice(start);
  const call = body.match(/multiRemove\(\[([\s\S]*?)\]\)/);
  expect(call, "logout should still clear keys via multiRemove([...])").toBeTruthy();
  return call![1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9_]+$/.test(s));
}

describe("every persisted key has an identity-boundary decision", () => {
  const declared = keyConstantsDeclaredIn(authSource);
  const imported = keysImportedFromConstants(authSource);
  const cleared = new Set(keysClearedByLogout(authSource));

  it("finds the key inventory and the clearing list (guards the parsing itself)", () => {
    // If a refactor moves these, the test must fail loudly rather than silently pass on an empty set.
    expect(declared.length).toBeGreaterThan(8);
    expect(cleared.size).toBeGreaterThan(8);
  });

  it("clears every AuthContext-declared key on sign-out, or documents why not", () => {
    const undecided = declared.filter((k) => !cleared.has(k) && !(k in INTENTIONALLY_PERSISTENT));
    expect(
      undecided,
      `These storage keys are never cleared at an identity boundary. Add each to logout()'s ` +
        `multiRemove, or to INTENTIONALLY_PERSISTENT in this test with a reason:\n  ${undecided.join("\n  ")}`,
    ).toEqual([]);
  });

  it("clears every key imported from constants/storage-keys that AuthContext owns", () => {
    const undecided = imported.filter((k) => !cleared.has(k) && !(k in INTENTIONALLY_PERSISTENT));
    expect(undecided, `Imported keys with no clearing decision:\n  ${undecided.join("\n  ")}`).toEqual([]);
  });

  it("keeps the two clinical keys in the clearing list (regression guard)", () => {
    // These were the ones with ZERO removeItem anywhere in the repo: the previous guardian's doctor
    // thread and a pending insulin-dose proposal that the next person could approve.
    expect(cleared.has("DOCTOR_MESSAGES_KEY")).toBe(true);
    expect(cleared.has("THERAPY_PROPOSAL_KEY")).toBe(true);
  });

  it("keeps ACCOUNT_KEY in the clearing list (regression guard)", () => {
    // Leaving this behind is what pre-filled the previous user's email on the sign-in screen and made
    // a caregiver session inherit their id, mislabelling their logs as "· by you".
    expect(cleared.has("ACCOUNT_KEY")).toBe(true);
  });
});
