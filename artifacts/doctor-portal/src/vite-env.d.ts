/// <reference types="vite/client" />

/**
 * The portal's only backend is the shared Glucose Guardian api-server. It never talks to Convex
 * directly (so there are no Convex or Clerk keys here) — the api-server's CONVEX_URL decides which
 * deployment backs the portal: production, `polished-badger-189`.
 */
interface ImportMetaEnv {
  /**
   * Glucose Guardian api-server origin, e.g. https://glucose-guardian-ashen.vercel.app.
   * Required for production builds (see src/lib/env.ts).
   */
  readonly VITE_API_BASE_URL?: string;
  /** Local dev only: Vite proxies /api/* here when VITE_API_BASE_URL is unset (avoids CORS). */
  readonly VITE_API_PROXY_TARGET?: string;
  /** Dev-only: set to "true" to disable mock data and develop against the real backend. */
  readonly VITE_DISABLE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
