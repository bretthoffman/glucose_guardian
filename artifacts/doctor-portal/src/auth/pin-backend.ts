import { customFetch } from "@doctor-portal/api-client-react";

/**
 * Account-level portal PIN, stored server-side on the doctor account so it follows the doctor to
 * any clinic computer (instead of a fresh PIN per device). The PIN is a convenience re-lock over
 * an already-authenticated Bearer session — never the primary auth boundary — so the hash is a
 * cheap non-cryptographic digest computed in the browser; the raw PIN never leaves the device.
 *
 * Every call degrades gracefully: if the backend routes aren't live yet (older deploy → 404) the
 * caller falls back to the legacy device-local PIN, so the portal keeps working through the
 * rollout and upgrades to account-level automatically once the backend ships.
 */
export function hashPin(pin: string): string {
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) | 0;
  return `h${h}`;
}

/** Persist the account PIN. Returns false when the backend route is unavailable (→ local-only). */
export async function setAccountPin(pinHash: string): Promise<boolean> {
  try {
    await customFetch("/api/doctor/me/pin", {
      method: "POST",
      body: JSON.stringify({ pinHash }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a PIN against the account. Returns:
 *  - `true` / `false` when the server has a PIN and could compare it, or
 *  - `null` when there's nothing to compare against server-side (route missing, offline, or the
 *    account has no server PIN yet) — signalling the caller to fall back to the device-local hash.
 */
export async function verifyAccountPin(pinHash: string): Promise<boolean | null> {
  try {
    const r = await customFetch<{ valid?: boolean; hasPin?: boolean }>(
      "/api/doctor/me/pin/verify",
      { method: "POST", body: JSON.stringify({ pinHash }) },
    );
    if (!r || r.hasPin === false) return null;
    return !!r.valid;
  } catch {
    return null;
  }
}
