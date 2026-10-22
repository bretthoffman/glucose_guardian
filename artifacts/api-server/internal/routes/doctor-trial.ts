/**
 * Doctor Portal pass: the one-time code printed on a family's Visit Summary PDF. A doctor without
 * a portal account opens it (POST /open), then reads that one patient's data, view only, for 24
 * hours from first use. The code itself is the credential: the portal sends it in the
 * X-Portal-Pass header and every read re-checks it in Convex (convex/portalTrial.ts), so an expired
 * or turned-off pass stops working on the very next request. Nothing here can write.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { api } from "../../../../convex/_generated/api.js";
import {
  createConvexDoctorAccountsClient,
  getConvexDoctorApiSecret,
  isConvexDoctorAccountsConfigured,
} from "../convex-doctor-accounts.js";
import { limitCodeAttempts } from "../code-rate-limit";

const router: IRouter = Router();

/** The pseudo access code the portal uses for the pass patient in its URLs. Never a real code. */
export const TRIAL_ACCESS_CODE = "PASS";
const PAGE = 5000;

type Reading = { value: number; trend: string; timestamp: string };

function passFrom(req: Request): string {
  const raw = req.headers["x-portal-pass"];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

function notConfigured(res: Response): boolean {
  if (isConvexDoctorAccountsConfigured()) return false;
  res.status(503).json({ error: "Doctor Portal isn't available right now." });
  return true;
}

function rangeFrom(req: Request, maxDays: number): { from: string; to: string } | string {
  const fromMs = Date.parse(String(req.query.from ?? ""));
  const toMs = Date.parse(String(req.query.to ?? ""));
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) return "from and to must be ISO timestamps with from < to";
  if (toMs - fromMs > maxDays * 86_400_000) return `Range too large (max ${maxDays} days)`;
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

async function readings(code: string, fromIso: string, toIso: string): Promise<Reading[] | null> {
  const client = createConvexDoctorAccountsClient();
  const out: Reading[] = [];
  let from = fromIso;
  for (let page = 0; page < 12; page++) {
    const result = (await client.query(api.portalTrial.trialGlucose, {
      serverSecret: getConvexDoctorApiSecret(),
      code,
      fromTimestamp: from,
      toTimestamp: toIso,
    })) as { readings: Reading[] } | null;
    if (!result) return page === 0 ? null : out;
    const rows = result.readings;
    out.push(...(page === 0 ? rows : rows.filter((r) => r.timestamp > from)));
    if (rows.length < PAGE) break;
    from = rows[rows.length - 1]!.timestamp;
  }
  return out;
}

const expired = (res: Response) =>
  res.status(401).json({ error: "This Doctor Portal pass has ended.", reason: "pass_ended" });

/** A doctor enters the code from the PDF. The first use starts the 24 hours. */
router.post("/open", limitCodeAttempts, (req, res) => {
  void (async () => {
    try {
      if (notConfigured(res)) return;
      const code = String((req.body as { code?: unknown })?.code ?? "").trim();
      if (!code) {
        res.status(400).json({ error: "Enter the code from the report." });
        return;
      }
      const r = (await createConvexDoctorAccountsClient().mutation(api.portalTrial.redeem, {
        serverSecret: getConvexDoctorApiSecret(),
        code,
      })) as { ok: true; expiresAt: number; patientName: string } | { ok: false; reason: "invalid" | "expired" };
      if (!r.ok) {
        res.status(r.reason === "expired" ? 410 : 404).json({
          reason: r.reason,
          error:
            r.reason === "expired"
              ? "This code has already been used and its 24 hours are over. To keep following this patient, get a practice license."
              : "That code doesn't match a report. Check the code at the top of the Visit Summary.",
        });
        return;
      }
      res.json({ expiresAt: new Date(r.expiresAt).toISOString(), patientName: r.patientName, accessCode: TRIAL_ACCESS_CODE });
    } catch (e) {
      console.error("[doctor-trial] POST /open", e);
      res.status(500).json({ error: "Couldn't open the code. Please try again." });
    }
  })();
});

/** The patient snapshot, shaped like GET /api/doctor/patient/:accessCode. */
router.get("/patient", (req, res) => {
  void (async () => {
    try {
      if (notConfigured(res)) return;
      const code = passFrom(req);
      const client = createConvexDoctorAccountsClient();
      const record = (await client.query(api.portalTrial.trialProfile, { serverSecret: getConvexDoctorApiSecret(), code })) as
        | { profile: Record<string, unknown>; alertPreferences?: Record<string, unknown>; updatedAt: number; expiresAt: number }
        | null;
      if (!record) return void expired(res);
      const now = Date.now();
      const [glucose, logs] = await Promise.all([
        readings(code, new Date(now - 24 * 3600_000).toISOString(), new Date(now).toISOString()),
        client.query(api.portalTrial.trialLogs, {
          serverSecret: getConvexDoctorApiSecret(),
          code,
          fromTimestamp: new Date(now - 30 * 86_400_000).toISOString(),
          toTimestamp: new Date(now).toISOString(),
        }) as Promise<{ food: unknown[]; insulin: unknown[] } | null>,
      ]);
      res.json({
        accessCode: TRIAL_ACCESS_CODE,
        profile: record.profile,
        alertPreferences: record.alertPreferences,
        glucoseReadings: glucose ?? [],
        foodLog: (logs?.food ?? []).slice(0, 100),
        insulinLog: (logs?.insulin ?? []).slice(0, 100),
        messages: [],
        syncedAt: new Date(record.updatedAt).toISOString(),
        // Not "server": that tells the portal the phone has never synced, which a pass viewer can't act on.
        source: "pass",
        therapyProposal: null,
        therapyDecision: null,
        settingsHistory: [],
        labA1c: null,
        passExpiresAt: new Date(record.expiresAt).toISOString(),
      });
    } catch (e) {
      console.error("[doctor-trial] GET /patient", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

router.get("/readings", (req, res) => {
  void (async () => {
    try {
      if (notConfigured(res)) return;
      const range = rangeFrom(req, 35);
      if (typeof range === "string") return void res.status(400).json({ error: range });
      const rows = await readings(passFrom(req), range.from, range.to);
      if (!rows) return void expired(res);
      res.json({ accessCode: TRIAL_ACCESS_CODE, ...range, readings: rows });
    } catch (e) {
      console.error("[doctor-trial] GET /readings", e);
      res.status(500).json({ error: "Could not load glucose history" });
    }
  })();
});

router.get("/logs", (req, res) => {
  void (async () => {
    try {
      if (notConfigured(res)) return;
      const range = rangeFrom(req, 400);
      if (typeof range === "string") return void res.status(400).json({ error: range });
      const logs = (await createConvexDoctorAccountsClient().query(api.portalTrial.trialLogs, {
        serverSecret: getConvexDoctorApiSecret(),
        code: passFrom(req),
        fromTimestamp: range.from,
        toTimestamp: range.to,
      })) as { food: unknown[]; insulin: unknown[] } | null;
      if (!logs) return void expired(res);
      res.json({ accessCode: TRIAL_ACCESS_CODE, ...range, food: logs.food, insulin: logs.insulin });
    } catch (e) {
      console.error("[doctor-trial] GET /logs", e);
      res.status(503).json({ error: "Log history not available yet" });
    }
  })();
});

export default router;
