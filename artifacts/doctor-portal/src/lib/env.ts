/**
 * Startup environment check for the doctor portal.
 *
 * In production the portal must know the Glucose Guardian API origin via VITE_API_BASE_URL.
 * In dev the Vite proxy forwards /api/* to VITE_API_PROXY_TARGET, so it isn't required there.
 * Doctor auth is the backend's own Bearer-token system — no Clerk/Convex keys are needed.
 */
if (import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL) {
  throw new Error(
    "[doctor-portal] Missing VITE_API_BASE_URL — set the Glucose Guardian API origin for production builds.",
  );
}
