import { ConvexError } from "convex/values";

/**
 * User-facing message out of a failed Convex call.
 *
 * Backend functions throw `ConvexError("...")` for anything a user should read — plain `Error`
 * messages are REDACTED to "Server Error" on prod deployments (they passed through on dev, which
 * is why alerts went opaque at the prod cutover). This prefers the structured ConvexError data,
 * then falls back to parsing dev-style message text, then to the caller's fallback copy.
 */
export function convexErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) {
    const d: unknown = e.data;
    if (typeof d === "string" && d.trim()) return d.trim();
    if (d && typeof d === "object") {
      const m = (d as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
  }
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  for (const marker of ["Uncaught ConvexError: ", "Uncaught Error: "]) {
    const at = text.indexOf(marker);
    if (at >= 0) {
      const rest = text.slice(at + marker.length);
      const end = rest.indexOf(" at handler");
      const msg = (end >= 0 ? rest.slice(0, end) : rest).trim();
      if (msg) return msg;
    }
  }
  return fallback;
}
