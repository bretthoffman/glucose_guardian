import type { Request } from "express";

/**
 * The caller's IP, for per-IP attempt limits. On Vercel, `x-real-ip` and `x-forwarded-for` are set
 * by the platform; outside it we fall back to the socket address.
 */
export function clientIp(req: Request): string | undefined {
  const real = req.headers["x-real-ip"];
  const fromReal = (Array.isArray(real) ? real[0] : real)?.trim();
  if (fromReal) return fromReal;
  const fwd = req.headers["x-forwarded-for"];
  const fromFwd = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return fromFwd || req.socket?.remoteAddress || undefined;
}

/** True when a Convex call failed because that function isn't deployed yet. */
export function isMissingConvexFunction(e: unknown): boolean {
  return e instanceof Error && /Could not find (public )?function/i.test(e.message);
}
