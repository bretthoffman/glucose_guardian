import { setDoctorAuthToken } from "@doctor-portal/api-client-react";
import type { DoctorProfile } from "@doctor-portal/api-client-react";

/**
 * Doctor session persistence. The Bearer token from POST /api/doctor/auth/login is kept in
 * sessionStorage (short-lived doctor sessions) and registered with the API client so every
 * request carries `Authorization: Bearer <token>`.
 */
const TOKEN_KEY = "gg_doc_token";
const EXPIRES_KEY = "gg_doc_expires_at";
const DOCTOR_KEY = "gg_doc_doctor";

export interface StoredSession {
  token: string;
  expiresAt: number;
  doctor: DoctorProfile;
}

export function loadDoctorSession(): StoredSession | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const doctorRaw = sessionStorage.getItem(DOCTOR_KEY);
    const expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
    if (!token || !doctorRaw) return null;
    if (expiresAt && Date.now() > expiresAt) {
      clearDoctorSession();
      return null;
    }
    setDoctorAuthToken(token);
    return { token, expiresAt, doctor: JSON.parse(doctorRaw) as DoctorProfile };
  } catch {
    return null;
  }
}

export function storeDoctorSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, session.token);
    sessionStorage.setItem(EXPIRES_KEY, String(session.expiresAt));
    sessionStorage.setItem(DOCTOR_KEY, JSON.stringify(session.doctor));
  } catch {
    /* ignore storage failures */
  }
  setDoctorAuthToken(session.token);
}

export function clearDoctorSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
    sessionStorage.removeItem(DOCTOR_KEY);
  } catch {
    /* ignore */
  }
  setDoctorAuthToken(null);
}
