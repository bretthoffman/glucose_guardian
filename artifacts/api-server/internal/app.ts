import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

/**
 * CORS allowlist.
 *
 * This was `cors()` with no options, i.e. every origin allowed. Combined with the two doctor routes
 * that carry no auth middleware (`POST /api/doctor/sync`, `POST /api/doctor/order-decision`, whose
 * only credential is a 6-char code in the body), that made those endpoints reachable — and
 * brute-forceable — from any web page a doctor or guardian happened to have open.
 *
 * The MOBILE app is unaffected either way: React Native `fetch` is not a browser and sends no Origin,
 * and requests with no Origin are still allowed here. This only constrains browser callers, which
 * means the doctor portal. Set `DOCTOR_PORTAL_ORIGINS` (comma-separated) to its exact origin(s).
 *
 * If the variable is unset we fall back to allowing all origins so a missing env var can't take the
 * portal down — but that leaves the hole open, so it is logged loudly at boot.
 */
const allowedOrigins = (process.env.DOCTOR_PORTAL_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    "[cors] DOCTOR_PORTAL_ORIGINS is not set — allowing ALL browser origins. " +
      "Set it to the doctor portal origin(s) to close cross-origin access to /api/doctor/*.",
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = a native app, a server-to-server call, or curl — not a browser page.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false); // reject without throwing (a throw would surface as a 500)
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "glucose-guardian-api" });
});

app.use("/api", router);

export default app;
