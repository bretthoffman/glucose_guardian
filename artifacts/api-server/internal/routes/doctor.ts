import { Router, type IRouter } from "express";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { api } from "../../../../convex/_generated/api.js";
import {
  createConvexDoctorAccountsClient,
  DOCTOR_SESSION_TTL_MS,
  getConvexDoctorApiSecret,
  isConvexDoctorAccountsConfigured,
} from "../convex-doctor-accounts.js";
import {
  createConvexDoctorHttpClient,
  getConvexDoctorIngestSecret,
  isConvexDoctorConfigured,
} from "../convex-doctor.js";
import {
  createDoctorSessionToken,
  type DoctorAuthedRequest,
  hashDoctorSessionToken,
  normalizeDoctorAccessCode,
  parseBearerToken,
  requireDoctorAuth,
  requireDoctorPatientLink,
} from "../doctor-auth.js";
import { answerDoctorQuestion, isAssistantConfigured } from "../doctor-assistant.js";

const router: IRouter = Router();

interface DoctorMessage {
  id: string;
  timestamp: string;
  text: string;
  sender: "doctor" | "guardian";
  read: boolean;
}

/** A doctor-proposed treatment-setting change awaiting caregiver confirmation. */
interface ServerTherapyProposal {
  id: string;
  proposedAt: string;
  proposedByDoctorId: string;
  proposedByName: string;
  note: string;
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}

interface ServerTherapyDecision {
  proposalId: string;
  status: "approved" | "declined";
  decidedAt: string;
}

/**
 * Clinical sanity guards on proposed settings — flags implausible values before they reach a
 * caregiver's approval card. Returns an error string, or null when all provided values are sane.
 */
function validateTherapyRanges(changes: {
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}): string | null {
  const { carbRatio, correctionFactor, targetGlucose } = changes;
  if (carbRatio != null && (carbRatio < 1 || carbRatio > 150)) {
    return "carbRatio is out of range (1–150 g/unit)";
  }
  if (correctionFactor != null && (correctionFactor < 1 || correctionFactor > 200)) {
    return "correctionFactor is out of range (1–200 mg/dL per unit)";
  }
  if (targetGlucose != null && (targetGlucose < 70 || targetGlucose > 200)) {
    return "targetGlucose is out of range (70–200 mg/dL)";
  }
  return null;
}

interface PatientSnapshot {
  accessCode: string;
  profile: {
    childName: string;
    parentName?: string;
    caregiverPhone?: string;
    diabetesType: string;
    dateOfBirth: string;
    weightLbs?: number;
    doctorName?: string;
    insulinTypes?: string[];
    carbRatio?: number;
    targetGlucose?: number;
    correctionFactor?: number;
    photoDataUri?: string;
  };
  glucoseReadings: { value: number; trend: string; timestamp: string }[];
  insulinLog: {
    id: string;
    timestamp: string;
    units: number;
    type: "bolus" | "correction" | "manual" | "basal";
    note?: string;
    foodLogId?: string;
    insulinType?: string;
    recommendedUnits?: number;
    manualOverride?: boolean;
  }[];
  foodLog: {
    id: string;
    timestamp: string;
    foodName: string;
    estimatedCarbs: number;
    insulinUnits: number;
    confidence: "high" | "medium" | "low";
    fromPhoto: boolean;
    /** Device-local file URI on the patient's phone (stripped server-side; not renderable). */
    photoUri?: string;
    /** Small base64 data-URI of the meal photo, synced by the app for the portal. */
    photoDataUri?: string;
  }[];
  messages: DoctorMessage[];
  alertPreferences?: {
    lowThreshold?: number;
    highThreshold?: number;
    urgentLowThreshold?: number;
    urgentHighThreshold?: number;
  };
  syncedAt: string;
}

// ─── Legacy in-memory store (when Convex env is not configured) ─────────────
const patientStore = new Map<string, PatientSnapshot>();
const messagesStore = new Map<string, DoctorMessage[]>();
const orderStore = new Map<
  string,
  { proposal: ServerTherapyProposal | null; decision: ServerTherapyDecision | null }
>();

function generateDemoReadings() {
  const readings: { value: number; trend: string; timestamp: string }[] = [];
  const now = Date.now();
  const trends = ["Flat", "FortyFiveUp", "SingleUp", "FortyFiveDown", "Flat", "Flat", "SingleDown", "Flat"];
  let bg = 118;
  for (let i = 288; i >= 0; i--) {
    bg += (Math.random() - 0.46) * 12;
    if (bg < 60) bg = 65 + Math.random() * 10;
    if (bg > 280) bg = 240 - Math.random() * 20;
    readings.push({
      value: Math.round(bg),
      trend: trends[Math.floor(Math.random() * trends.length)]!,
      timestamp: new Date(now - i * 5 * 60 * 1000).toISOString(),
    });
  }
  return readings;
}

const demoReadings = generateDemoReadings();
const demoMessages: DoctorMessage[] = [
  {
    id: "msg-1",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    text: "Hi Dr. Chen! Emma had a rough night — lots of lows around 2–4 AM. We adjusted her basal but want your input.",
    sender: "guardian",
    read: true,
  },
  {
    id: "msg-2",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
    text: "Thanks for the heads up. Looking at her CGM data now. Those nocturnal lows are likely from the dinner bolus stacking. Let's reduce her dinner I:C ratio from 1:10 to 1:12 and watch for a few days.",
    sender: "doctor",
    read: true,
  },
  {
    id: "msg-3",
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    text: "The adjustment seems to be working! Only one mild low last night at 68, came back up on her own. Should we keep this ratio?",
    sender: "guardian",
    read: false,
  },
];

const DEMO_CODE = "DEMO";
const demoSnapshot: PatientSnapshot = {
  accessCode: DEMO_CODE,
  profile: {
    childName: "Emma Chen",
    parentName: "Sarah Chen",
    diabetesType: "Type 1",
    dateOfBirth: "2014-06-15",
    weightLbs: 68,
    doctorName: "Dr. Michael Chen",
    insulinTypes: ["Humalog", "Lantus"],
    carbRatio: 10,
    targetGlucose: 110,
    correctionFactor: 50,
  },
  glucoseReadings: demoReadings,
  insulinLog: [
    { id: "ins-1", timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), units: 3.5, type: "bolus", note: "Lunch - pasta", foodLogId: "food-1" },
    { id: "ins-2", timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), units: 1.0, type: "correction", note: "BG was 185" },
    { id: "ins-3", timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), units: 2.5, type: "bolus", note: "Snack", foodLogId: "food-2" },
    { id: "ins-4", timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), units: 4.0, type: "bolus", note: "Dinner - pizza" },
    { id: "ins-5", timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), units: 12, type: "manual", note: "Lantus nightly dose" },
  ],
  foodLog: [
    { id: "food-1", timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), foodName: "Pasta with marinara sauce", estimatedCarbs: 52, insulinUnits: 3.5, confidence: "high", fromPhoto: true },
    { id: "food-2", timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), foodName: "Apple with peanut butter", estimatedCarbs: 28, insulinUnits: 2.5, confidence: "medium", fromPhoto: false },
    { id: "food-3", timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), foodName: "Cheese pizza (2 slices)", estimatedCarbs: 60, insulinUnits: 4.0, confidence: "medium", fromPhoto: true },
  ],
  messages: demoMessages,
  alertPreferences: {
    lowThreshold: 70,
    highThreshold: 180,
    urgentLowThreshold: 55,
    urgentHighThreshold: 250,
  },
  syncedAt: new Date().toISOString(),
};

patientStore.set(DEMO_CODE, demoSnapshot);
messagesStore.set(DEMO_CODE, demoMessages);
// ─────────────────────────────────────────────────────────────────────────────

type ConvexDoctorDoc = {
  accessCode: string;
  messages: DoctorMessage[];
  profile?: PatientSnapshot["profile"];
  glucoseReadings?: PatientSnapshot["glucoseReadings"];
  insulinLog?: PatientSnapshot["insulinLog"];
  foodLog?: PatientSnapshot["foodLog"];
  alertPreferences?: PatientSnapshot["alertPreferences"];
  therapyProposal?: ServerTherapyProposal | null;
  therapyDecision?: ServerTherapyDecision | null;
  settingsHistory?: {
    changedAt: string;
    carbRatio?: number;
    correctionFactor?: number;
    targetGlucose?: number;
  }[];
  labA1c?: {
    value: number;
    measuredAt: string;
    enteredByDoctorId: string;
    enteredByName: string;
    enteredAt: string;
  } | null;
  syncedAt?: string;
};

const FOOD_PHOTO_MAX_BYTES = 16 * 1024;
const FOOD_PHOTO_MAX_ENTRIES = 20;

/**
 * Guard the doctorPortalState document (Convex caps docs at ~1MB): drop device-local file URIs
 * (useless off the phone), and keep meal-photo data-URIs only on the newest entries and only when
 * they're genuinely small thumbnails. Worst case ~320KB of photos per patient.
 */
function sanitizeFoodLog(foodLog: PatientSnapshot["foodLog"]): PatientSnapshot["foodLog"] {
  const newestFirst = [...foodLog].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const keepPhotoIds = new Set(
    newestFirst.slice(0, FOOD_PHOTO_MAX_ENTRIES).map((f) => f.id),
  );
  return foodLog.map((f) => {
    const { photoUri: _dropped, photoDataUri, ...rest } = f;
    const keep =
      photoDataUri &&
      photoDataUri.startsWith("data:image/") &&
      photoDataUri.length <= FOOD_PHOTO_MAX_BYTES &&
      keepPhotoIds.has(f.id);
    return keep ? { ...rest, photoDataUri } : rest;
  });
}

/**
 * Fire-and-forget compliance log write. Never blocks or fails the request; silently a no-op
 * until the logAccess Convex function is deployed.
 */
function logDoctorAccess(doctorId: string, accessCode: string, action: string): void {
  if (!isConvexDoctorAccountsConfigured()) return;
  const client = createConvexDoctorAccountsClient();
  void client
    .mutation(api.doctorAccounts.logAccess, {
      serverSecret: getConvexDoctorApiSecret(),
      doctorId: asDoctorId(doctorId),
      accessCode,
      action,
    })
    .catch(() => {});
}

function asDoctorId(id: string): Id<"doctorAccounts"> {
  return id as Id<"doctorAccounts">;
}

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toPatientSnapshot(doc: ConvexDoctorDoc | null): PatientSnapshot | null {
  if (!doc?.profile) return null;
  return {
    accessCode: doc.accessCode,
    profile: doc.profile,
    glucoseReadings: doc.glucoseReadings ?? [],
    insulinLog: doc.insulinLog ?? [],
    foodLog: doc.foodLog ?? [],
    messages: doc.messages,
    alertPreferences: doc.alertPreferences,
    syncedAt: doc.syncedAt ?? new Date().toISOString(),
  };
}

if (isConvexDoctorConfigured()) {
  void (async () => {
    try {
      const client = createConvexDoctorHttpClient();
      await client.mutation(api.doctor.seedDemo, {
        serverSecret: getConvexDoctorIngestSecret(),
      });
    } catch (e) {
      console.warn("[doctor] Convex DEMO seed failed (ok until Convex is deployed):", e);
    }
  })();
}

// ─── Doctor account auth (Phase 1) ───────────────────────────────────────────

router.post("/auth/register", (req, res) => {
  void (async () => {
    try {
      if (!isConvexDoctorAccountsConfigured()) {
        res.status(503).json({ error: "Doctor accounts are not configured" });
        return;
      }
      const { email, passwordHash, displayName, title, firstName, lastName, institution } =
        req.body as {
          email?: string;
          passwordHash?: string;
          displayName?: string;
          title?: string;
          firstName?: string;
          lastName?: string;
          institution?: string;
        };
      if (!email?.trim() || !passwordHash || !displayName?.trim()) {
        res.status(400).json({ error: "email, passwordHash, and displayName are required" });
        return;
      }

      const client = createConvexDoctorAccountsClient();
      const result = await client.mutation(api.doctorAccounts.register, {
        serverSecret: getConvexDoctorApiSecret(),
        email,
        passwordHash,
        displayName,
        title,
        firstName,
        lastName,
        institution,
      });
      res.status(201).json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Registration failed";
      if (message.includes("already registered")) {
        res.status(409).json({ error: message });
        return;
      }
      console.error("[doctor] POST /auth/register", e);
      res.status(400).json({ error: message });
    }
  })();
});

router.post("/auth/login", (req, res) => {
  void (async () => {
    try {
      if (!isConvexDoctorAccountsConfigured()) {
        res.status(503).json({ error: "Doctor accounts are not configured" });
        return;
      }
      const { email, passwordHash } = req.body as {
        email?: string;
        passwordHash?: string;
      };
      if (!email?.trim() || !passwordHash) {
        res.status(400).json({ error: "email and passwordHash are required" });
        return;
      }

      const client = createConvexDoctorAccountsClient();
      const account = await client.query(api.doctorAccounts.login, {
        serverSecret: getConvexDoctorApiSecret(),
        email,
        passwordHash,
      });
      if (!account) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = createDoctorSessionToken();
      const expiresAt = Date.now() + DOCTOR_SESSION_TTL_MS;
      await client.mutation(api.doctorAccounts.createSession, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(account.doctorId),
        tokenHash: hashDoctorSessionToken(token),
        expiresAt,
      });

      res.json({
        token,
        expiresAt,
        doctor: account,
      });
    } catch (e) {
      console.error("[doctor] POST /auth/login", e);
      res.status(500).json({ error: "Doctor login failed" });
    }
  })();
});

router.post("/auth/logout", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const token = parseBearerToken(req);
      if (token) {
        const client = createConvexDoctorAccountsClient();
        await client.mutation(api.doctorAccounts.revokeSession, {
          serverSecret: getConvexDoctorApiSecret(),
          tokenHash: hashDoctorSessionToken(token),
        });
      }
      res.json({ success: true });
    } catch (e) {
      console.error("[doctor] POST /auth/logout", e);
      res.status(500).json({ error: "Logout failed" });
    }
  })();
});

router.get("/me", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const client = createConvexDoctorAccountsClient();
      const doctor = await client.query(api.doctorAccounts.getById, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
      });
      if (!doctor) {
        res.status(404).json({ error: "Doctor not found" });
        return;
      }
      res.json(doctor);
    } catch (e) {
      console.error("[doctor] GET /me", e);
      res.status(500).json({ error: "Doctor profile error" });
    }
  })();
});

router.patch("/me", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const { displayName, title, firstName, lastName, specialty, email, photoDataUri } =
        req.body as {
          displayName?: string;
          title?: string;
          firstName?: string;
          lastName?: string;
          specialty?: string;
          email?: string;
          photoDataUri?: string;
        };
      const client = createConvexDoctorAccountsClient();
      const updated = await client.mutation(api.doctorAccounts.updateProfile, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
        displayName,
        title,
        firstName,
        lastName,
        specialty,
        email,
        photoDataUri,
      });
      res.json(updated);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Update failed";
      if (message.includes("already registered")) {
        res.status(409).json({ error: message });
        return;
      }
      console.error("[doctor] PATCH /me", e);
      res.status(500).json({ error: "Could not update profile" });
    }
  })();
});

router.get("/me/patients", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const client = createConvexDoctorAccountsClient();
      const result = await client.query(api.doctorAccounts.listLinks, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
      });
      res.json(result);
    } catch (e) {
      console.error("[doctor] GET /me/patients", e);
      res.status(500).json({ error: "Failed to list linked patients" });
    }
  })();
});

router.post("/me/patients/link", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const { accessCode } = req.body as { accessCode?: string };
      if (!accessCode?.trim()) {
        res.status(400).json({ error: "accessCode is required" });
        return;
      }

      const client = createConvexDoctorAccountsClient();
      const link = await client.mutation(api.doctorAccounts.createLink, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
        accessCode,
      });
      res.status(link.alreadyLinked ? 200 : 201).json(link);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Link failed";
      if (message.includes("Invalid") || message.includes("unknown")) {
        res.status(404).json({ error: message });
        return;
      }
      console.error("[doctor] POST /me/patients/link", e);
      res.status(400).json({ error: message });
    }
  })();
});

router.delete("/me/patients/:accessCode", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const client = createConvexDoctorAccountsClient();
      const result = await client.mutation(api.doctorAccounts.revokeLink, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
        accessCode: routeParam(req.params.accessCode),
      });
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unlink failed";
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      console.error("[doctor] DELETE /me/patients/:accessCode", e);
      res.status(400).json({ error: message });
    }
  })();
});

// ─── Account-level portal PIN (quick unlock; follows the account across devices) ────────────

router.post("/me/pin", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const { pinHash } = req.body as { pinHash?: string };
      if (!pinHash || typeof pinHash !== "string") {
        res.status(400).json({ error: "pinHash is required" });
        return;
      }
      const client = createConvexDoctorAccountsClient();
      await client.mutation(api.doctorAccounts.setPin, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
        pinHash,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("[doctor] POST /me/pin", e);
      res.status(500).json({ error: "Could not save PIN" });
    }
  })();
});

router.post("/me/pin/verify", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const { pinHash } = req.body as { pinHash?: string };
      if (!pinHash || typeof pinHash !== "string") {
        res.status(400).json({ error: "pinHash is required" });
        return;
      }
      const client = createConvexDoctorAccountsClient();
      const result = await client.query(api.doctorAccounts.verifyPin, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
        pinHash,
      });
      res.json(result);
    } catch (e) {
      console.error("[doctor] POST /me/pin/verify", e);
      res.status(500).json({ error: "Could not verify PIN" });
    }
  })();
});

// ─── Doctor alerts (bell feed; created by the Convex scan cron + decision events) ───────────

router.get("/me/alerts", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const client = createConvexDoctorAccountsClient();
      const result = await client.query(api.doctorAlerts.list, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
      });
      res.json(result);
    } catch (e) {
      // Expected until the doctorAlerts module is deployed — the portal hides the bell on failure.
      res.status(503).json({ error: "Alerts not available yet" });
    }
  })();
});

router.post("/me/alerts/read", requireDoctorAuth, (req, res) => {
  void (async () => {
    try {
      const { doctorId } = req as DoctorAuthedRequest;
      const client = createConvexDoctorAccountsClient();
      await client.mutation(api.doctorAlerts.markAllRead, {
        serverSecret: getConvexDoctorApiSecret(),
        doctorId: asDoctorId(doctorId),
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(503).json({ error: "Alerts not available yet" });
    }
  })();
});

// ─── Legacy code-only login (deprecated; does not grant snapshot access) ─────

router.post("/login", (req, res) => {
  void (async () => {
    try {
      res.setHeader("Deprecation", "true");
      res.setHeader(
        "Link",
        '</api/doctor/auth/login>; rel="successor-version"',
      );

      const { accessCode } = req.body as { accessCode?: string };
      if (!accessCode || typeof accessCode !== "string" || accessCode.trim().length < 3) {
        res.status(401).json({ error: "Invalid access code" });
        return;
      }
      const code = normalizeDoctorAccessCode(accessCode);
      if (code.length < 3) {
        res.status(401).json({ error: "Invalid access code" });
        return;
      }

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const secret = getConvexDoctorIngestSecret();
        const doc = (await client.query(api.doctor.getState, {
          serverSecret: secret,
          accessCode: code,
        })) as ConvexDoctorDoc | null;
        const snapshot = toPatientSnapshot(doc);
        res.json({
          success: true,
          accessCode: code,
          patientName: snapshot?.profile?.childName ?? null,
          hasData: !!doc?.profile,
          deprecated: true,
          migration:
            "Use POST /api/doctor/auth/login, POST /api/doctor/me/patients/link, and Bearer auth on patient routes.",
        });
        return;
      }

      const snapshot = patientStore.get(code);
      res.json({
        success: true,
        accessCode: code,
        patientName: snapshot?.profile?.childName ?? null,
        hasData: !!snapshot,
        deprecated: true,
        migration:
          "Use POST /api/doctor/auth/login, POST /api/doctor/me/patients/link, and Bearer auth on patient routes.",
      });
    } catch (e) {
      console.error("[doctor] /login", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

router.post("/sync", (req, res) => {
  void (async () => {
    try {
      const body = req.body as PatientSnapshot;
      if (!body?.accessCode) {
        res.status(400).json({ error: "accessCode required" });
        return;
      }
      const code = body.accessCode.trim().toUpperCase();

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const secret = getConvexDoctorIngestSecret();
        const existingDoc = (await client.query(api.doctor.getState, {
          serverSecret: secret,
          accessCode: code,
        })) as ConvexDoctorDoc | null;
        const existing = existingDoc?.messages ?? [];
        const incomingIds = new Set((body.messages ?? []).map((m) => m.id));
        const serverOnlyMessages = existing.filter((m) => !incomingIds.has(m.id));
        const merged = [...(body.messages ?? []), ...serverOnlyMessages].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        await client.mutation(api.doctor.upsertFromSync, {
          serverSecret: secret,
          accessCode: code,
          profile: body.profile,
          glucoseReadings: body.glucoseReadings ?? [],
          insulinLog: body.insulinLog ?? [],
          foodLog: sanitizeFoodLog(body.foodLog ?? []),
          messages: merged,
          alertPreferences: body.alertPreferences,
          syncedAt: new Date().toISOString(),
        });

        // Return the merged thread + any pending proposal so the caregiver app pulls doctor
        // messages and treatment proposals down on its next sync.
        res.json({
          success: true,
          message: "Sync successful",
          messages: merged,
          therapyProposal: existingDoc?.therapyProposal ?? null,
          therapyDecision: existingDoc?.therapyDecision ?? null,
        });
        return;
      }

      const existing = messagesStore.get(code) ?? [];
      const incomingIds = new Set((body.messages ?? []).map((m) => m.id));
      const serverOnlyMessages = existing.filter((m) => !incomingIds.has(m.id));
      const merged = [...(body.messages ?? []), ...serverOnlyMessages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      messagesStore.set(code, merged);
      patientStore.set(code, { ...body, accessCode: code, messages: merged, syncedAt: new Date().toISOString() });

      const order = orderStore.get(code);
      res.json({
        success: true,
        message: "Sync successful",
        messages: merged,
        therapyProposal: order?.proposal ?? null,
        therapyDecision: order?.decision ?? null,
      });
    } catch (e) {
      console.error("[doctor] /sync", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

router.get(
  "/patient/:accessCode",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
  void (async () => {
    try {
      const code =
        (req as DoctorAuthedRequest).doctorAccessCode ??
        normalizeDoctorAccessCode(routeParam(req.params.accessCode));

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const secret = getConvexDoctorIngestSecret();
        const doc = (await client.query(api.doctor.getState, {
          serverSecret: secret,
          accessCode: code,
        })) as ConvexDoctorDoc | null;
        const snapshot = toPatientSnapshot(doc);
        if (!snapshot) {
          res.status(404).json({ error: "No patient data found for this access code" });
          return;
        }
        const messages = doc?.messages ?? snapshot.messages ?? [];
        // Freshness overlay: the snapshot only updates when the patient's phone pushes (every
        // 2 min while the app's dashboard is open), but the server-side CGM ingestion cron pulls
        // from Dexcom/Libre every minute into the durable store. Merge the last 24h of durable
        // readings so the portal shows current glucose even when the phone hasn't synced.
        let glucoseReadings = snapshot.glucoseReadings ?? [];
        try {
          if (isConvexDoctorAccountsConfigured()) {
            const accountsClient = createConvexDoctorAccountsClient();
            const fresh = (await accountsClient.query(api.doctorAccounts.getGlucoseHistory, {
              serverSecret: getConvexDoctorApiSecret(),
              accessCode: code,
              fromTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              toTimestamp: new Date().toISOString(),
            })) as { readings: { value: number; trend: string; timestamp: string }[] };
            if (fresh?.readings?.length) {
              // Dedupe to the minute — the phone and the ingestion pipeline can carry the same
              // provider reading with second-level timestamp jitter.
              const minuteKey = (t: string) => Math.floor(new Date(t).getTime() / 60_000);
              const seen = new Set(glucoseReadings.map((r) => minuteKey(r.timestamp)));
              const merged = [...glucoseReadings];
              for (const r of fresh.readings) {
                if (!seen.has(minuteKey(r.timestamp))) merged.push(r);
              }
              merged.sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
              );
              glucoseReadings = merged.slice(-600);
            }
          }
        } catch {
          // getGlucoseHistory not deployed yet (or transient error) — keep the snapshot readings.
        }
        logDoctorAccess((req as DoctorAuthedRequest).doctorId, code, "viewed");
        res.json({
          ...snapshot,
          glucoseReadings,
          messages,
          therapyProposal: doc?.therapyProposal ?? null,
          therapyDecision: doc?.therapyDecision ?? null,
          settingsHistory: doc?.settingsHistory ?? [],
          labA1c: doc?.labA1c ?? null,
        });
        return;
      }

      const snapshot = patientStore.get(code);
      if (!snapshot) {
        res.status(404).json({ error: "No patient data found for this access code" });
        return;
      }
      const messages = messagesStore.get(code) ?? snapshot.messages ?? [];
      const order = orderStore.get(code);
      res.json({
        ...snapshot,
        messages,
        therapyProposal: order?.proposal ?? null,
        therapyDecision: order?.decision ?? null,
      });
    } catch (e) {
      console.error("[doctor] GET /patient", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
  },
);

/**
 * Full CGM history for a linked patient over a time range, from the durable per-user reading
 * store (the sync snapshot only carries the most recent ~300 readings). Powers the portal's
 * treatment before/after comparison with real multi-day windows.
 */
router.get(
  "/patient/:accessCode/readings",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
    void (async () => {
      try {
        const code =
          (req as DoctorAuthedRequest).doctorAccessCode ??
          normalizeDoctorAccessCode(routeParam(req.params.accessCode));

        const fromMs = Date.parse(String(req.query.from ?? ""));
        const toMs = Date.parse(String(req.query.to ?? ""));
        if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
          res.status(400).json({ error: "from and to must be ISO timestamps with from < to" });
          return;
        }
        const MAX_SPAN_MS = 35 * 24 * 60 * 60 * 1000;
        if (toMs - fromMs > MAX_SPAN_MS) {
          res.status(400).json({ error: "Range too large (max 35 days)" });
          return;
        }

        const client = createConvexDoctorAccountsClient();
        const result = (await client.query(api.doctorAccounts.getGlucoseHistory, {
          serverSecret: getConvexDoctorApiSecret(),
          accessCode: code,
          fromTimestamp: new Date(fromMs).toISOString(),
          toTimestamp: new Date(toMs).toISOString(),
        })) as { readings: { value: number; trend: string; timestamp: string }[] };

        res.json({
          accessCode: code,
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          readings: result.readings ?? [],
        });
      } catch (e) {
        console.error("[doctor] GET /patient/:accessCode/readings", e);
        res.status(500).json({ error: "Could not load glucose history" });
      }
    })();
  },
);

/** Compliance access log for a linked patient (latest first, doctor names resolved). */
router.get(
  "/patient/:accessCode/access-log",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
    void (async () => {
      try {
        const code =
          (req as DoctorAuthedRequest).doctorAccessCode ??
          normalizeDoctorAccessCode(routeParam(req.params.accessCode));
        const client = createConvexDoctorAccountsClient();
        const result = await client.query(api.doctorAccounts.listAccessLog, {
          serverSecret: getConvexDoctorApiSecret(),
          accessCode: code,
        });
        res.json(result);
      } catch (e) {
        res.status(503).json({ error: "Access log not available yet" });
      }
    })();
  },
);

/** Record a lab-measured A1C (doctor-entered; shown against the CGM-estimated GMI). */
router.post(
  "/patient/:accessCode/lab-a1c",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
    void (async () => {
      try {
        const authed = req as DoctorAuthedRequest;
        const code =
          authed.doctorAccessCode ?? normalizeDoctorAccessCode(routeParam(req.params.accessCode));
        const { value, measuredAt } = req.body as { value?: number; measuredAt?: string };
        if (typeof value !== "number" || value < 3 || value > 20) {
          res.status(400).json({ error: "value must be an A1C percentage between 3 and 20" });
          return;
        }
        const measuredMs = Date.parse(measuredAt ?? "");
        if (Number.isNaN(measuredMs) || measuredMs > Date.now() + 24 * 60 * 60 * 1000) {
          res.status(400).json({ error: "measuredAt must be a valid past date" });
          return;
        }

        // Resolve the doctor's name server-side (same rule as proposals: never trust the client).
        let enteredByName = "Doctor";
        try {
          const accountsClient = createConvexDoctorAccountsClient();
          const doctor = await accountsClient.query(api.doctorAccounts.getById, {
            serverSecret: getConvexDoctorApiSecret(),
            doctorId: asDoctorId(authed.doctorId),
          });
          const formal = [doctor?.title, doctor?.lastName]
            .map((s) => s?.trim())
            .filter(Boolean)
            .join(" ");
          enteredByName = formal || doctor?.displayName?.trim() || enteredByName;
        } catch {
          /* keep fallback name */
        }

        const labA1c = {
          value: Math.round(value * 10) / 10,
          measuredAt: new Date(measuredMs).toISOString(),
          enteredByDoctorId: authed.doctorId,
          enteredByName,
          enteredAt: new Date().toISOString(),
        };
        const client = createConvexDoctorHttpClient();
        const saved = await client.mutation(api.doctor.setLabA1c, {
          serverSecret: getConvexDoctorIngestSecret(),
          accessCode: code,
          labA1c,
        });
        res.json(saved);
      } catch (e) {
        console.error("[doctor] POST /patient/:accessCode/lab-a1c", e);
        res.status(500).json({ error: "Could not save lab A1C" });
      }
    })();
  },
);

/**
 * "Glucose Guardian Assistant": answers the doctor's questions about THIS patient from the
 * patient's synced record (context gathered entirely server-side — the client sends only the
 * conversation). Auth + patient-link enforced, so the assistant is patient-scoped by construction.
 */
router.post(
  "/patient/:accessCode/assistant",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
    void (async () => {
      try {
        if (!isAssistantConfigured() || !isConvexDoctorConfigured()) {
          res.status(503).json({ error: "Assistant is not configured on this server" });
          return;
        }
        const authed = req as DoctorAuthedRequest;
        const code =
          authed.doctorAccessCode ?? normalizeDoctorAccessCode(routeParam(req.params.accessCode));

        const { messages } = req.body as {
          messages?: { role?: string; content?: string }[];
        };
        const turns = (Array.isArray(messages) ? messages : [])
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          )
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.trim() }));
        if (!turns.length || turns[turns.length - 1].role !== "user") {
          res.status(400).json({ error: "messages must end with a user question" });
          return;
        }

        // Formal name for the greeting-quality tone ("Dr. Rivera"), same rule as proposals.
        let doctorName = "Doctor";
        try {
          const accountsClient = createConvexDoctorAccountsClient();
          const doctor = await accountsClient.query(api.doctorAccounts.getById, {
            serverSecret: getConvexDoctorApiSecret(),
            doctorId: asDoctorId(authed.doctorId),
          });
          const formal = [doctor?.title, doctor?.lastName]
            .map((s) => s?.trim())
            .filter(Boolean)
            .join(" ");
          doctorName = formal || doctor?.displayName?.trim() || doctorName;
        } catch {
          /* keep fallback */
        }

        logDoctorAccess(authed.doctorId, code, "assistant_query");
        const reply = await answerDoctorQuestion({ accessCode: code, doctorName, messages: turns });
        res.json({ reply });
      } catch (e) {
        console.error("[doctor] POST /patient/:accessCode/assistant", e);
        res.status(500).json({ error: "Assistant had trouble answering. Try again." });
      }
    })();
  },
);

router.get(
  "/messages/:accessCode",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
  void (async () => {
    try {
      const code =
        (req as DoctorAuthedRequest).doctorAccessCode ??
        normalizeDoctorAccessCode(routeParam(req.params.accessCode));

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const secret = getConvexDoctorIngestSecret();
        const doc = (await client.query(api.doctor.getState, {
          serverSecret: secret,
          accessCode: code,
        })) as ConvexDoctorDoc | null;
        const messages = doc?.messages ?? [];
        res.json({ messages });
        return;
      }

      const messages = messagesStore.get(code) ?? [];
      res.json({ messages });
    } catch (e) {
      console.error("[doctor] GET /messages", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
  },
);

router.post(
  "/messages/:accessCode",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
  void (async () => {
    try {
      const code =
        (req as DoctorAuthedRequest).doctorAccessCode ??
        normalizeDoctorAccessCode(routeParam(req.params.accessCode));
      const { text } = req.body as { text?: string; sender?: "doctor" | "guardian" };
      if (!text?.trim()) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const message: DoctorMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        text: text.trim(),
        sender: "doctor",
        read: false,
      };

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const secret = getConvexDoctorIngestSecret();
        await client.mutation(api.doctor.appendMessage, {
          serverSecret: secret,
          accessCode: code,
          message,
        });
        res.json(message);
        return;
      }

      const existing = messagesStore.get(code) ?? [];
      existing.push(message);
      messagesStore.set(code, existing);

      const snapshot = patientStore.get(code);
      if (snapshot) {
        patientStore.set(code, { ...snapshot, messages: existing });
      }

      res.json(message);
    } catch (e) {
      console.error("[doctor] POST /messages", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
  },
);

// ─── Treatment proposals ("propose change") ─────────────────────────────────

// Doctor proposes a treatment-setting change. Stored server-side and surfaced to the caregiver
// app as an approval card on its next sync; it takes effect only after the caregiver confirms.
router.post(
  "/patient/:accessCode/orders",
  requireDoctorAuth,
  requireDoctorPatientLink(),
  (req, res) => {
  void (async () => {
    try {
      const authed = req as DoctorAuthedRequest;
      const code =
        authed.doctorAccessCode ??
        normalizeDoctorAccessCode(routeParam(req.params.accessCode));
      const { carbRatio, correctionFactor, targetGlucose, note } = req.body as {
        carbRatio?: number;
        correctionFactor?: number;
        targetGlucose?: number;
        note?: string;
      };

      const changes = { carbRatio, correctionFactor, targetGlucose };
      const hasChange = [carbRatio, correctionFactor, targetGlucose].some(
        (val) => typeof val === "number" && Number.isFinite(val),
      );
      if (!hasChange) {
        res.status(400).json({
          error: "At least one of carbRatio, correctionFactor, or targetGlucose is required",
        });
        return;
      }
      const rangeError = validateTherapyRanges(changes);
      if (rangeError) {
        res.status(400).json({ error: rangeError });
        return;
      }

      // Resolve the doctor's name for the caregiver-facing card. Never trust the client. Prefer a
      // formal "Dr. Lastname" byline; fall back to the full display name for legacy accounts that
      // predate structured names.
      let proposedByName = "Your care team";
      try {
        const accountsClient = createConvexDoctorAccountsClient();
        const doctor = await accountsClient.query(api.doctorAccounts.getById, {
          serverSecret: getConvexDoctorApiSecret(),
          doctorId: asDoctorId(authed.doctorId),
        });
        const formal = [doctor?.title, doctor?.lastName]
          .map((s) => s?.trim())
          .filter(Boolean)
          .join(" ");
        proposedByName = formal || doctor?.displayName?.trim() || proposedByName;
      } catch (e) {
        console.warn("[doctor] could not resolve proposing doctor name:", e);
      }

      const proposal: ServerTherapyProposal = {
        id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        proposedAt: new Date().toISOString(),
        proposedByDoctorId: authed.doctorId,
        proposedByName,
        note: (note ?? "").trim(),
        ...(typeof carbRatio === "number" ? { carbRatio } : {}),
        ...(typeof correctionFactor === "number" ? { correctionFactor } : {}),
        ...(typeof targetGlucose === "number" ? { targetGlucose } : {}),
      };

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        try {
          await client.mutation(api.doctor.proposeOrder, {
            serverSecret: getConvexDoctorIngestSecret(),
            accessCode: code,
            proposal,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          if (message.includes("PENDING_PROPOSAL_EXISTS")) {
            res.status(409).json({
              error: "A change is already awaiting caregiver confirmation.",
            });
            return;
          }
          throw e;
        }
        res.status(201).json(proposal);
        return;
      }

      // Legacy in-memory path (local dev without Convex).
      const order = orderStore.get(code) ?? { proposal: null, decision: null };
      if (order.proposal) {
        res.status(409).json({ error: "A change is already awaiting caregiver confirmation." });
        return;
      }
      order.proposal = proposal;
      order.decision = null;
      orderStore.set(code, order);
      res.status(201).json(proposal);
    } catch (e) {
      console.error("[doctor] POST /patient/:accessCode/orders", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
  },
);

// Caregiver app records its decision on the pending proposal. App-facing (gated by the access
// code in the body, like /sync) — not a doctor-authed route.
router.post("/order-decision", (req, res) => {
  void (async () => {
    try {
      const { accessCode, proposalId, status } = req.body as {
        accessCode?: string;
        proposalId?: string;
        status?: "approved" | "declined";
      };
      if (
        !accessCode?.trim() ||
        !proposalId?.trim() ||
        (status !== "approved" && status !== "declined")
      ) {
        res.status(400).json({
          error: "accessCode, proposalId, and status (approved|declined) are required",
        });
        return;
      }
      const code = normalizeDoctorAccessCode(accessCode);

      if (isConvexDoctorConfigured()) {
        const client = createConvexDoctorHttpClient();
        const result = await client.mutation(api.doctor.decideOrder, {
          serverSecret: getConvexDoctorIngestSecret(),
          accessCode: code,
          proposalId,
          status,
        });
        res.json({ success: true, ...result });
        return;
      }

      const order = orderStore.get(code);
      if (order?.proposal?.id === proposalId) {
        order.decision = { proposalId, status, decidedAt: new Date().toISOString() };
        order.proposal = null;
        orderStore.set(code, order);
        res.json({ success: true, applied: true, decision: order.decision });
        return;
      }
      res.json({
        success: true,
        applied: false,
        alreadyDecided: order?.decision?.proposalId === proposalId,
      });
    } catch (e) {
      console.error("[doctor] POST /order-decision", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

export default router;
