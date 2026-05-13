import { ConvexHttpClient } from "convex/browser";

/**
 * Convex-backed patient server operations (Dexcom credential store).
 * Requires CONVEX_URL + CONVEX_PATIENT_BACKEND_SECRET on the API host.
 */
export function isConvexPatientBackendConfigured(): boolean {
  return Boolean(
    process.env.CONVEX_URL?.trim() && process.env.CONVEX_PATIENT_BACKEND_SECRET?.trim(),
  );
}

export function getConvexPatientBackendSecret(): string {
  const s = process.env.CONVEX_PATIENT_BACKEND_SECRET?.trim();
  if (!s) {
    throw new Error("CONVEX_PATIENT_BACKEND_SECRET is not set");
  }
  return s;
}

/** New client per call avoids sharing mutation queue across concurrent serverless invocations. */
export function createConvexPatientBackendClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL?.trim();
  if (!url) {
    throw new Error("CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}
