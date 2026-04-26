/**
 * API base URL for the patient app (Expo).
 *
 * **Preferred:** set `EXPO_PUBLIC_API_BASE_URL` in `artifacts/mobile/.env` (create from
 * `.env.example`). Expo reads env files from the mobile package root, not the monorepo root.
 * Use a full origin with no trailing slash, e.g. `https://your-api.example.com`.
 *
 * **Expo Go on a real device:** an empty base yields relative `/api/...` URLs, which resolve
 * against the device and will not hit your deployed API — set `EXPO_PUBLIC_API_BASE_URL`.
 *
 * Resolution order:
 * 1) `EXPO_PUBLIC_API_BASE_URL` (preferred)
 * 2) `EXPO_PUBLIC_DOMAIN` → `https://${EXPO_PUBLIC_DOMAIN}` (legacy Replit-style host)
 * 3) `""` → relative paths (same-origin / web-only setups)
 */
const explicitApiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const replitDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();

function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

/**
 * Resolved API origin (no trailing slash), or empty string when using relative `/api/*` URLs.
 */
export const API_BASE_URL = explicitApiBase
  ? normalizeBaseUrl(explicitApiBase)
  : replitDomain
    ? normalizeBaseUrl(`https://${replitDomain}`)
    : "";

export function apiUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${API_BASE_URL}${path}`;
}

