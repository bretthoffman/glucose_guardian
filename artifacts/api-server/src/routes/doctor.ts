import { Router, type IRouter } from "express";

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

const patientStore = new Map<string, PatientSnapshot>();
const messagesStore = new Map<string, DoctorMessage[]>();

router.post("/login", (req, res) => {
  const { accessCode } = req.body as { accessCode?: string };
  if (!accessCode || typeof accessCode !== "string" || accessCode.trim().length < 3) {
    res.status(401).json({ error: "Invalid access code" });
    return;
  }
  const code = accessCode.trim().toUpperCase();
  const snapshot = patientStore.get(code);
  res.json({
    success: true,
    accessCode: code,
    patientName: snapshot?.profile?.childName ?? null,
    hasData: !!snapshot,
  });
});

router.post("/sync", (req, res) => {
  const body = req.body as PatientSnapshot;
  if (!body?.accessCode) {
    res.status(400).json({ error: "accessCode required" });
    return;
  }
  const code = body.accessCode.trim().toUpperCase();

  const existing = messagesStore.get(code) ?? [];
  const incomingIds = new Set((body.messages ?? []).map((m) => m.id));
  const serverOnlyMessages = existing.filter((m) => !incomingIds.has(m.id));
  const merged = [...(body.messages ?? []), ...serverOnlyMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  messagesStore.set(code, merged);
  patientStore.set(code, { ...body, accessCode: code, messages: merged, syncedAt: new Date().toISOString() });

  res.json({ success: true, message: "Sync successful" });
});

router.get("/patient/:accessCode", (req, res) => {
  const code = req.params.accessCode.trim().toUpperCase();
  const snapshot = patientStore.get(code);
  if (!snapshot) {
    res.status(404).json({ error: "No patient data found for this access code" });
    return;
  }
  const messages = messagesStore.get(code) ?? snapshot.messages ?? [];
  res.json({ ...snapshot, messages });
});

router.get("/messages/:accessCode", (req, res) => {
  const code = req.params.accessCode.trim().toUpperCase();
  const messages = messagesStore.get(code) ?? [];
  res.json({ messages });
});

router.post("/messages/:accessCode", (req, res) => {
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
  const existing = messagesStore.get(code) ?? [];
  existing.push(message);
  messagesStore.set(code, existing);

  const snapshot = patientStore.get(code);
  if (snapshot) {
    patientStore.set(code, { ...snapshot, messages: existing });
  }

  res.json(message);
});

export default router;
