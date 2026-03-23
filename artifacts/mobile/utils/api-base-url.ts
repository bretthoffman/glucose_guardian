const explicitApiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
const replitDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();

function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

/**
 * API base URL resolution for mobile:
 * 1) EXPO_PUBLIC_API_BASE_URL (preferred for split frontend/backend deploys)
 * 2) EXPO_PUBLIC_DOMAIN (existing Replit behavior)
 * 3) "" (relative paths, useful for same-origin local setups)
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

