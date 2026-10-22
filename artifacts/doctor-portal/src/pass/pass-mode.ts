import { customFetch, setRequestInterceptor, type DoctorProfile } from "@doctor-portal/api-client-react";
import { apiErrorInfo } from "@/auth/access-code";

/**
 * Doctor Portal pass: the one-time code from a family's Visit Summary PDF. It opens that one
 * patient, view only, for 24 hours from first use, with no account. While it's on, the portal's
 * own screens run unchanged: requests for the pass patient go to the api-server's /trial routes
 * with the code attached, and everything else (other patients, messages, settings changes) is
 * answered here with empty lists or "view only". The code lives in sessionStorage, so closing the
 * tab ends it.
 */
const KEY = "gg_portal_pass";
/** The pseudo access code for the pass patient in portal URLs (matches the api-server). */
export const PASS_ACCESS_CODE = "PASS";

export interface PassInfo {
  code: string;
  expiresAt: number;
  patientName: string;
}

export const PASS_VISITOR: DoctorProfile = {
  doctorId: "portal-pass",
  email: "",
  displayName: "Guest with a patient code",
  firstName: "Guest",
  lastName: "",
  specialty: "24-hour pass",
  institution: "Doctor Portal pass",
  hasPin: false,
} as DoctorProfile;

function read(): PassInfo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PassInfo;
    return p && typeof p.code === "string" && p.expiresAt > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function apiBase(): string {
  const base = import.meta.env?.VITE_API_BASE_URL;
  return base ? String(base).replace(/\/$/, "") : "";
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let onEnded: (() => void) | null = null;
/** Called when the server says the pass is over (its 24 hours ran out, or the family turned it off). */
export function setPassEndedHandler(handler: (() => void) | null): void {
  onEnded = handler;
}

async function passFetch(url: string, init: RequestInit & { method: string }): Promise<Response | null> {
  const pass = read();
  const u = new URL(url, window.location.origin);
  const path = u.pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/")) return null;
  const method = init.method.toUpperCase();
  if (!pass) {
    onEnded?.();
    return json(401, { error: "This Doctor Portal pass has ended." });
  }

  const patient = path.match(/^\/api\/doctor\/patient\/([^/]+)(\/.*)?$/);
  const isPassPatient = patient && decodeURIComponent(patient[1]!).toUpperCase() === PASS_ACCESS_CODE;
  if (isPassPatient && method === "GET") {
    const sub = patient[2] ?? "";
    const target = sub === "" ? "/patient" : sub === "/readings" || sub === "/logs" ? sub : null;
    if (target) {
      const res = await fetch(`${apiBase()}/api/doctor/trial${target}${u.search}`, {
        headers: { "X-Portal-Pass": pass.code, Accept: "application/json" },
      });
      if (res.status === 401) onEnded?.();
      return res;
    }
    if (sub === "/care-circle") return json(200, { members: [] });
    if (sub === "/caregiver-titles") return json(200, { titles: [] });
    if (sub === "/nurse-threads") return json(200, { threads: [] });
    if (sub === "/access-log") return json(200, { entries: [] });
    return json(404, { error: "Not available with a Doctor Portal pass" });
  }

  if (path === "/api/doctor/me" && method === "GET") return json(200, PASS_VISITOR);
  if (path === "/api/doctor/me/patients") {
    return json(200, {
      patients: [{ accessCode: PASS_ACCESS_CODE, displayName: pass.patientName, linkedAt: new Date().toISOString(), hasData: true }],
    });
  }
  if (path === "/api/doctor/me/alerts") return json(200, { alerts: [], unreadCount: 0 });
  if (path.startsWith("/api/doctor/messages/") && method === "GET") return json(200, { messages: [] });
  if (path === "/api/doctor/auth/logout" || path.startsWith("/api/doctor/me/pin")) return json(200, { ok: true, valid: true, hasPin: false });
  return json(403, {
    error: "View only. A Doctor Portal pass can't change settings or send messages. Get a license key to do that.",
  });
}

/** Check the code with the server (the first use starts the 24 hours). */
export async function openPass(raw: string): Promise<{ ok: true; pass: PassInfo } | { ok: false; message: string }> {
  const code = raw.trim();
  if (!code) return { ok: false, message: "Enter the code from the top of the Visit Summary." };
  try {
    const r = await customFetch<{ expiresAt: string; patientName: string }>("/api/doctor/trial/open", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return { ok: true, pass: { code, expiresAt: Date.parse(r.expiresAt), patientName: r.patientName } };
  } catch (e) {
    const { status, error } = apiErrorInfo(e);
    if (status === 429) return { ok: false, message: "Too many tries. Wait a minute and try again." };
    return { ok: false, message: error ?? "Couldn't check that code. Please try again." };
  }
}

export function startPass(pass: PassInfo): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pass));
  } catch {
    /* still works for this page load */
  }
  setRequestInterceptor(passFetch);
}

/** On page load: pick the pass back up if this tab had one that hasn't ended. */
export function resumePass(): PassInfo | null {
  const pass = read();
  if (pass) setRequestInterceptor(passFetch);
  else {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  return pass;
}

export function stopPass(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  setRequestInterceptor(null);
}
