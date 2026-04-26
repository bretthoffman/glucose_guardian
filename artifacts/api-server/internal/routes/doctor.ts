import { Router, type IRouter } from "express";
import { api } from "../../../../convex/_generated/api.js";
import {
  createConvexDoctorHttpClient,
  getConvexDoctorIngestSecret,
  isConvexDoctorConfigured,
} from "../convex-doctor.js";

const router: IRouter = Router();

interface DoctorMessage {
  id: string;
  timestamp: string;
  text: string;
  sender: "doctor" | "guardian";
  read: boolean;
}

interface PatientSnapshot {
  accessCode: string;
  profile: {
    childName: string;
    parentName?: string;
    diabetesType: string;
    dateOfBirth: string;
    weightLbs?: number;
    doctorName?: string;
    insulinTypes?: string[];
    carbRatio?: number;
    targetGlucose?: number;
    correctionFactor?: number;
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
  syncedAt?: string;
};

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

router.post("/login", (req, res) => {
  void (async () => {
    try {
      const { accessCode } = req.body as { accessCode?: string };
      if (!accessCode || typeof accessCode !== "string" || accessCode.trim().length < 3) {
        res.status(401).json({ error: "Invalid access code" });
        return;
      }
      const code = accessCode.trim().toUpperCase();

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
        });
        return;
      }

      const snapshot = patientStore.get(code);
      res.json({
        success: true,
        accessCode: code,
        patientName: snapshot?.profile?.childName ?? null,
        hasData: !!snapshot,
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

        res.json({ success: true, message: "Sync successful" });
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

      res.json({ success: true, message: "Sync successful" });
    } catch (e) {
      console.error("[doctor] /sync", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

router.get("/patient/:accessCode", (req, res) => {
  void (async () => {
    try {
      const code = req.params.accessCode.trim().toUpperCase();

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
        res.json({ ...snapshot, messages });
        return;
      }

      const snapshot = patientStore.get(code);
      if (!snapshot) {
        res.status(404).json({ error: "No patient data found for this access code" });
        return;
      }
      const messages = messagesStore.get(code) ?? snapshot.messages ?? [];
      res.json({ ...snapshot, messages });
    } catch (e) {
      console.error("[doctor] GET /patient", e);
      res.status(500).json({ error: "Doctor service error" });
    }
  })();
});

router.get("/messages/:accessCode", (req, res) => {
  void (async () => {
    try {
      const code = req.params.accessCode.trim().toUpperCase();

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
});

router.post("/messages/:accessCode", (req, res) => {
  void (async () => {
    try {
      const code = req.params.accessCode.trim().toUpperCase();
      const { text, sender } = req.body as { text?: string; sender?: "doctor" | "guardian" };
      if (!text || !sender) {
        res.status(400).json({ error: "text and sender required" });
        return;
      }
      const message: DoctorMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        text,
        sender,
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
});

export default router;
