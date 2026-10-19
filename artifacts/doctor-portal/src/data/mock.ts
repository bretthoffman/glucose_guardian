import type {
  PatientSnapshot,
  CGMReading,
  InsulinLogEntry,
  FoodLogEntry,
  DoctorMessage,
} from "@doctor-portal/api-client-react";
import type { DoctorProfile, Organization } from "@/auth/use-current-doctor";
import { ORGANIZATIONS, type DirectoryOrganization } from "./organizations";
import type {
  DoctorPatientListItem,
  PatientDetail,
  ProposeOrderInput,
  TherapyOrder,
} from "./contracts";
import { calculateA1C } from "@/lib/utils";

/**
 * DEV-ONLY mock data. Production builds (`import.meta.env.DEV === false`) never mock — the
 * data hooks fall through to the backend-pending path and no fake data can render. Set
 * `VITE_DISABLE_MOCK=true` to develop against the real backend instead.
 *
 * Nothing here is real patient data; it exists only to build and preview the UI before the
 * canonical backend ships its doctor functions.
 */
export const USE_MOCK_DATA =
  import.meta.env.DEV && import.meta.env.VITE_DISABLE_MOCK !== "true";

export const MOCK_DOCTOR: DoctorProfile = {
  id: "doc_mock_1",
  displayName: "Dr. Alex Rivera",
  email: "arivera@musc.example",
  role: "doctor",
  specialty: "Pediatric endocrinology",
};

export const MOCK_ORG: Organization = {
  id: "org_musc",
  name: "MUSC Health",
  slug: "musc",
};

/**
 * Organization directory entry. The directory itself is real data (curated U.S. health systems
 * in src/data/organizations.ts, plus the server-side CMS/NPPES directory) — only the name
 * `MockOrganization` is kept for compatibility with existing imports.
 */
export type MockOrganization = DirectoryOrganization;

export function mockOrganizations(): MockOrganization[] {
  return ORGANIZATIONS;
}

const HOUR = 60 * 60 * 1000;
const TRENDS = ["Flat", "FortyFiveUp", "SingleUp", "FortyFiveDown", "SingleDown"];

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function makeReadings(count: number, base: number, swing: number): CGMReading[] {
  const out: CGMReading[] = [];
  for (let i = 0; i < count; i++) {
    const value = Math.round(base + swing * Math.sin(i / 4) + ((i * 7) % 11) - 5);
    out.push({
      value: Math.max(45, value),
      trend: TRENDS[i % TRENDS.length],
      timestamp: iso(i * 15 * 60 * 1000),
    });
  }
  return out; // index 0 = most recent, matching panel expectations
}

interface PatientSpec {
  patientId: string;
  accessCode: string;
  childName: string;
  parentName: string;
  dateOfBirth: string;
  weightLbs: number;
  base: number;
  swing: number;
  carbRatio: number;
  correctionFactor: number;
  targetGlucose: number;
  canPrescribe: boolean;
  hasData: boolean;
  flags: DoctorPatientListItem["flags"];
  pending?: { values: TherapyOrder; };
}

function buildDetail(spec: PatientSpec): PatientDetail {
  const readings = spec.hasData ? makeReadings(48, spec.base, spec.swing) : [];
  const insulinLog: InsulinLogEntry[] = spec.hasData
    ? [
        { id: "i1", timestamp: iso(2 * HOUR), units: 4.5, type: "bolus", note: "Lunch" },
        { id: "i2", timestamp: iso(5 * HOUR), units: 1.2, type: "correction", note: "High at 220" },
        { id: "i3", timestamp: iso(9 * HOUR), units: 6, type: "bolus", note: "Breakfast" },
        { id: "i4", timestamp: iso(20 * HOUR), units: 11, type: "manual", note: "Basal" },
      ]
    : [];
  const foodLog: FoodLogEntry[] = spec.hasData
    ? [
        {
          id: "f1",
          timestamp: iso(2 * HOUR),
          foodName: "Turkey sandwich + apple",
          estimatedCarbs: 62,
          insulinUnits: 4.5,
          confidence: "high",
          fromPhoto: true,
        },
        {
          id: "f2",
          timestamp: iso(9 * HOUR),
          foodName: "Oatmeal with berries",
          estimatedCarbs: 40,
          insulinUnits: 2.8,
          confidence: "medium",
          fromPhoto: false,
        },
      ]
    : [];
  const messages: DoctorMessage[] = [
    {
      id: "m1",
      timestamp: iso(26 * HOUR),
      text: "Hi doctor, we've seen a few highs after dinner this week.",
      sender: "guardian",
      read: true,
    },
    {
      id: "m2",
      timestamp: iso(25 * HOUR),
      text: "Thanks for flagging — let's look at the evening carb ratio.",
      sender: "doctor",
      read: true,
    },
  ];

  const snapshot: PatientSnapshot = {
    accessCode: spec.accessCode,
    profile: {
      childName: spec.childName,
      parentName: spec.parentName,
      diabetesType: "type1",
      dateOfBirth: spec.dateOfBirth,
      weightLbs: spec.weightLbs,
      doctorName: MOCK_DOCTOR.displayName,
      insulinTypes: ["Humalog", "Lantus"],
      carbRatio: spec.carbRatio,
      targetGlucose: spec.targetGlucose,
      correctionFactor: spec.correctionFactor,
    },
    glucoseReadings: readings,
    insulinLog,
    foodLog,
    messages,
    alertPreferences: {
      lowThreshold: 70,
      highThreshold: 180,
      urgentLowThreshold: 55,
      urgentHighThreshold: 250,
    },
    syncedAt: spec.hasData ? iso(8 * 60 * 1000) : iso(6 * 24 * HOUR),
  };

  const activeOrder: TherapyOrder = {
    id: `order_${spec.patientId}_active`,
    patientId: spec.patientId,
    version: 3,
    status: "active",
    proposedByDoctorId: "doc_prior",
    proposedByName: "Dr. Jordan Prior",
    proposedAt: iso(30 * 24 * HOUR),
    acknowledgedAt: iso(30 * 24 * HOUR - HOUR),
    carbRatio: spec.carbRatio,
    correctionFactor: spec.correctionFactor,
    targetGlucose: spec.targetGlucose,
    insulinTypes: ["Humalog", "Lantus"],
    alertThresholds: { low: 70, high: 180, urgentLow: 55, urgentHigh: 250 },
  };

  return {
    patientId: spec.patientId,
    accessCode: spec.accessCode,
    snapshot,
    canPrescribe: spec.canPrescribe,
    activeOrder,
    proposedOrder: spec.pending?.values,
  };
}

const SPECS: PatientSpec[] = [
  {
    patientId: "pat_emma",
    accessCode: "EMMA01",
    childName: "Emma Carter",
    parentName: "Dana Carter",
    dateOfBirth: "2015-04-12",
    weightLbs: 72,
    base: 150,
    swing: 45,
    carbRatio: 15,
    correctionFactor: 50,
    targetGlucose: 120,
    canPrescribe: true,
    hasData: true,
    flags: ["pending_order"],
    pending: {
      values: {
        id: "order_pat_emma_proposed",
        patientId: "pat_emma",
        version: 4,
        status: "proposed",
        proposedByDoctorId: "doc_mock_1",
        proposedByName: "Dr. Alex Rivera",
        proposedAt: iso(3 * HOUR),
        note: "Tightening evening carb ratio after repeated post-dinner highs.",
        carbRatio: 12,
        correctionFactor: 50,
        targetGlucose: 120,
        insulinTypes: ["Humalog", "Lantus"],
        alertThresholds: { low: 70, high: 180, urgentLow: 55, urgentHigh: 250 },
      },
    },
  },
  {
    patientId: "pat_liam",
    accessCode: "LIAM02",
    childName: "Liam Nguyen",
    parentName: "Mai Nguyen",
    dateOfBirth: "2013-09-30",
    weightLbs: 95,
    base: 185,
    swing: 55,
    carbRatio: 10,
    correctionFactor: 45,
    targetGlucose: 120,
    canPrescribe: true,
    hasData: true,
    flags: ["high"],
  },
  {
    patientId: "pat_sofia",
    accessCode: "SOFIA3",
    childName: "Sofia Patel",
    parentName: "Ravi Patel",
    dateOfBirth: "2017-01-22",
    weightLbs: 48,
    base: 130,
    swing: 30,
    carbRatio: 20,
    correctionFactor: 60,
    targetGlucose: 130,
    canPrescribe: false,
    hasData: false,
    flags: ["no_recent_data"],
  },
];

const DETAILS: PatientDetail[] = SPECS.map(buildDetail);

function toListItem(d: PatientDetail, flags: DoctorPatientListItem["flags"]): DoctorPatientListItem {
  const latest = d.snapshot.glucoseReadings[0];
  return {
    patientId: d.patientId,
    accessCode: d.accessCode,
    displayName: d.snapshot.profile.childName,
    diabetesType: d.snapshot.profile.diabetesType,
    a1cEstimate: d.snapshot.glucoseReadings.length
      ? (calculateA1C(d.snapshot.glucoseReadings) ?? undefined)
      : undefined,
    hasData: d.snapshot.glucoseReadings.length > 0,
    lastReadingValue: latest?.value,
    lastReadingAt: latest?.timestamp,
    syncedAt: d.snapshot.syncedAt,
    flags,
  };
}

/** Patients linked at runtime by access code — auto-added, no patient approval. */
const linkedExtras: PatientDetail[] = [];

export function mockPatientList(): DoctorPatientListItem[] {
  const base = DETAILS.map((d) =>
    toListItem(d, SPECS.find((s) => s.patientId === d.patientId)!.flags),
  );
  const extra = linkedExtras.map((d) => toListItem(d, ["no_recent_data"]));
  return [...extra, ...base]; // newly linked patients appear on top
}

export function mockPatientDetail(accessCode: string): PatientDetail | undefined {
  return (
    DETAILS.find((d) => d.accessCode === accessCode) ??
    linkedExtras.find((d) => d.accessCode === accessCode)
  );
}

export function mockMessages(accessCode: string): DoctorMessage[] {
  return mockPatientDetail(accessCode)?.snapshot.messages ?? [];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mockProposeOrder(input: ProposeOrderInput): Promise<TherapyOrder> {
  await delay(600);
  const detail = DETAILS.find((d) => d.patientId === input.patientId);
  const current = detail?.activeOrder;
  if (current && current.version !== input.baseVersion) {
    throw new Error(
      "This patient's orders changed since you loaded them. Reload and try again.",
    );
  }
  const order: TherapyOrder = {
    id: `order_${input.patientId}_${Math.round(Math.random() * 1e6)}`,
    patientId: input.patientId,
    version: (current?.version ?? 0) + 1,
    status: "proposed",
    proposedByDoctorId: MOCK_DOCTOR.id,
    proposedByName: MOCK_DOCTOR.displayName,
    proposedAt: new Date().toISOString(),
    note: input.note,
    ...input.values,
  };
  if (detail) detail.proposedOrder = order; // reflect on reload
  return order;
}

export async function mockSendMessage(
  _accessCode: string,
  text: string,
): Promise<DoctorMessage> {
  await delay(300);
  return {
    id: `m_${Math.round(Math.random() * 1e9)}`,
    timestamp: new Date().toISOString(),
    text,
    sender: "doctor",
    read: true,
  };
}

function buildPendingDetail(accessCode: string): PatientDetail {
  const id = `pat_${accessCode.toLowerCase()}`;
  const snapshot: PatientSnapshot = {
    accessCode,
    profile: { childName: `New patient · ${accessCode}`, diabetesType: "type1", dateOfBirth: "" },
    glucoseReadings: [],
    insulinLog: [],
    foodLog: [],
    messages: [],
    alertPreferences: { lowThreshold: 70, highThreshold: 180, urgentLowThreshold: 55, urgentHighThreshold: 250 },
    syncedAt: iso(0),
  };
  return {
    patientId: id,
    accessCode,
    snapshot,
    canPrescribe: true,
    activeOrder: {
      id: `order_${id}_active`,
      patientId: id,
      version: 1,
      status: "active",
      proposedByDoctorId: MOCK_DOCTOR.id,
      proposedByName: MOCK_DOCTOR.displayName,
      proposedAt: iso(0),
      carbRatio: 15,
      correctionFactor: 50,
      targetGlucose: 120,
      insulinTypes: [],
      alertThresholds: { low: 70, high: 180, urgentLow: 55, urgentHigh: 250 },
    },
  };
}

/** Auto-link a patient by access code — adds them immediately, no approval request. */
export async function mockLinkPatient(accessCode: string): Promise<DoctorPatientListItem> {
  await delay(400);
  const code = accessCode.trim().toUpperCase();
  if (!code) throw new Error("Enter an access code.");
  if (
    DETAILS.some((d) => d.accessCode === code) ||
    linkedExtras.some((d) => d.accessCode === code)
  ) {
    throw new Error("That patient is already in your list.");
  }
  const detail = buildPendingDetail(code);
  linkedExtras.unshift(detail);
  return toListItem(detail, ["no_recent_data"]);
}
