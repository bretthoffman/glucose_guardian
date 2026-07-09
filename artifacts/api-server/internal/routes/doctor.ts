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
    type: "bolus" | "correction" | "manual";
    note?: string;
    foodLogId?: string;
  }[];
  foodLog: {
    id: string;
    timestamp: string;
    foodName: string;
    estimatedCarbs: number;
    insulinUnits: number;
    confidence: "high" | "medium" | "low";
    fromPhoto: boolean;
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
  syncedAt?: string;
};

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
          foodLog: body.foodLog ?? [],
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
        res.json({
          ...snapshot,
          messages,
          therapyProposal: doc?.therapyProposal ?? null,
          therapyDecision: doc?.therapyDecision ?? null,
          settingsHistory: doc?.settingsHistory ?? [],
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
