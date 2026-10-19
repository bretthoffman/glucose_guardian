import type { PatientSnapshot } from "@doctor-portal/api-client-react";

/**
 * Frontend data contracts. These mirror the canonical backend functions in
 * DOCTOR_PORTAL_CANONICAL_BACKEND_SPEC.md (§4) so the UI is drop-on-ready: when the real
 * Convex API lands, the hooks in doctor-data.ts swap their mock bodies for `useQuery`
 * calls returning exactly these shapes. Observation shapes are reused from the API client.
 */

/** A row from `doctorPatients.list`. */
export interface DoctorPatientListItem {
  patientId: string;
  accessCode: string;
  displayName: string;
  diabetesType?: string;
  a1cEstimate?: string;
  hasData: boolean;
  lastReadingValue?: number;
  lastReadingAt?: string;
  syncedAt?: string;
  flags: PatientFlag[];
}

export type PatientFlag =
  | "urgent_low"
  | "low"
  | "high"
  | "urgent_high"
  | "no_recent_data"
  | "pending_order";

export type TherapyOrderStatus = "proposed" | "acknowledged" | "active" | "superseded";

export interface AlertThresholds {
  low?: number;
  high?: number;
  urgentLow?: number;
  urgentHigh?: number;
}

/** Editable therapy settings — the server-owned source of truth (spec §3). */
export interface TherapyOrderValues {
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
  insulinTypes?: string[];
  alertThresholds?: AlertThresholds;
}

export interface TherapyOrder extends TherapyOrderValues {
  id: string;
  patientId: string;
  version: number;
  status: TherapyOrderStatus;
  proposedByDoctorId: string;
  proposedByName: string;
  proposedAt: string;
  note?: string;
  acknowledgedAt?: string;
}

/** `doctorPatients.get`: observations + current orders + this doctor's prescribe right. */
export interface PatientDetail {
  patientId: string;
  accessCode: string;
  /** Observations + profile; consumed directly by the existing panels. */
  snapshot: PatientSnapshot;
  /** Whether THIS doctor is the designated prescriber for THIS patient (spec §3). */
  canPrescribe: boolean;
  activeOrder?: TherapyOrder;
  /** A change awaiting caregiver confirmation, if any. */
  proposedOrder?: TherapyOrder;
  /** Outcome of the most recent proposal (present once the caregiver has decided). */
  lastDecision?: {
    proposalId: string;
    status: "approved" | "declined";
    decidedAt: string;
  };
  /** Chronological log of treatment-setting changes (oldest→newest), for trend comparison. */
  settingsHistory?: SettingsChange[];
  /** True when meals/insulin come from the server-side log (current) rather than the phone's sync. */
  logsFromServer?: boolean;
  /** "server" when the phone has never synced and the chart is built from server records. */
  source?: "phone" | "server";
}

export interface SettingsChange {
  changedAt: string;
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}

/** Result shape shared by the data hooks — mirrors TanStack/Convex query results. */
export interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface ProposeOrderInput {
  patientId: string;
  /** Optimistic concurrency: the active order version this change is based on (spec §4). */
  baseVersion: number;
  values: TherapyOrderValues;
  note: string;
}
