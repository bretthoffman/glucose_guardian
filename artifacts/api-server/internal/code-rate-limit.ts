import type { NextFunction, Request, Response } from "express";

/**
 * Rate limiter for the two doctor routes whose ONLY credential is a 6-char access code in the body
 * (`POST /api/doctor/sync`, `POST /api/doctor/order-decision`). It bounds how fast a caller can walk
 * the code space.
 *
 * ⚠️ HONEST LIMITATION: this state is per-instance and in-memory, so on Vercel it resets on every
 * cold start and is not shared between concurrent lambdas. That makes it a speed bump, not a wall —
 * a determined attacker with parallelism gets more attempts than the nominal budget. It is still
 * worth having (it stops naive scripted guessing outright and costs nothing on the happy path), but
 * the durable version would keep counters in Convex keyed by code. Tracked as follow-up.
 *
 * The real strength comes from the code being crypto-random (32^6 ≈ 1.07e9) — see
 * `utils/accessCodeGen.ts` and `convex/careCircle.ts randomCode()`. This limiter exists so that
 * keyspace can't be chewed through quickly.
 *
 * Keyed by client IP rather than by code: keying by code would let an attacker rotate codes freely,
 * which is exactly the attack. Legitimate traffic is one device syncing its own code every couple of
 * minutes, so the budget below is generous for real use.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Best-effort client identity. Vercel sets x-forwarded-for; fall back to the socket address. */
function clientKey(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = raw?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  return ip;
}

/** Drop expired buckets so a long-lived instance can't grow this map without bound. */
function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export function limitCodeAttempts(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  sweep(now);
  const key = clientKey(req);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > MAX_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return;
  }
  next();
}
