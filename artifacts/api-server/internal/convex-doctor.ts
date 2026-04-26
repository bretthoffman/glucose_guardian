import { ConvexHttpClient } from "convex/browser";

/**
 * Convex-backed doctor portal persistence (optional).
 * When unset, doctor routes fall back to in-memory Maps (legacy local dev).
 */
export function isConvexDoctorConfigured(): boolean {
  return Boolean(
    process.env.CONVEX_URL?.trim() &&
      process.env.CONVEX_DOCTOR_INGEST_SECRET?.trim(),
  );
}

export function getConvexDoctorIngestSecret(): string {
  const s = process.env.CONVEX_DOCTOR_INGEST_SECRET?.trim();
  if (!s) {
    throw new Error("CONVEX_DOCTOR_INGEST_SECRET is not set");
  }
  return s;
}

/** New client per call avoids sharing mutation queue across concurrent serverless invocations. */
export function createConvexDoctorHttpClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL?.trim();
  if (!url) {
    throw new Error("CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}
