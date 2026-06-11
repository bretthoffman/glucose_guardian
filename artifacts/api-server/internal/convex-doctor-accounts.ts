import { ConvexHttpClient } from "convex/browser";

/**
 * Convex-backed doctor account + patient link operations.
 * Requires CONVEX_URL + CONVEX_DOCTOR_API_SECRET on the API host.
 * Separate from CONVEX_DOCTOR_INGEST_SECRET (snapshot sync path).
 */
export function isConvexDoctorAccountsConfigured(): boolean {
  return Boolean(
    process.env.CONVEX_URL?.trim() && process.env.CONVEX_DOCTOR_API_SECRET?.trim(),
  );
}

export function getConvexDoctorApiSecret(): string {
  const s = process.env.CONVEX_DOCTOR_API_SECRET?.trim();
  if (!s) {
    throw new Error("CONVEX_DOCTOR_API_SECRET is not set");
  }
  return s;
}

/** New client per call avoids sharing mutation queue across concurrent serverless invocations. */
export function createConvexDoctorAccountsClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL?.trim();
  if (!url) {
    throw new Error("CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

/** Session lifetime for Bearer tokens issued by POST /api/doctor/auth/login. */
export const DOCTOR_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeDoctorAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
