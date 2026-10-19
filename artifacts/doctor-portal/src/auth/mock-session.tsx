import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setDoctorSessionRejectedHandler, type DoctorProfile } from "@doctor-portal/api-client-react";
import { mockOrganizations, type MockOrganization } from "@/data/mock";
import { toast } from "@/hooks/use-toast";
import { clearDoctorSession, loadDoctorSession, storeDoctorSession } from "./doctor-auth";
import { DEMO_DOCTOR } from "@/demo/people";
import { resumeDemo, startDemo, stopDemo } from "@/demo/demo-mode";
import { hashPin, setAccountPin, verifyAccountPin } from "./pin-backend";

/**
 * Doctor session for the portal: sign-in first (backend doctor accounts, Bearer token) → mandatory
 * PIN lock. The PIN is account-level (stored server-side, see pin-backend) so it follows the doctor
 * to any clinic computer; a locally-cached hash mirrors it for instant/offline unlock and as the
 * fallback until the backend routes ship. Creating an account routes through the organization
 * picker inside the `authenticate` step (see MockAuthFlow) — returning doctors never see it. The
 * token/doctor live in doctor-auth (sessionStorage); org + cached PIN live on the device.
 */
export type SessionStep = "authenticate" | "set_pin" | "locked" | "ready";

interface SessionState {
  orgId?: string;
  /** Persisted at pick time so orgs from the server-side directory resolve after reload. */
  orgName?: string;
  orgDomains?: string[];
  /** Device-cached PIN hash — mirrors the account PIN for offline unlock and pre-deploy fallback. */
  pinHash?: string;
  /**
   * Whether the signed-in account has a server-side PIN. `undefined` means unknown (older backend
   * without the field) — then the device-cached `pinHash` governs, preserving legacy behavior.
   */
  accountHasPin?: boolean;
  doctor?: DoctorProfile;
  /** When the server session ends (epoch ms, from sign-in). */
  expiresAt?: number;
  /** Signed in to the demo (sample patients, answered in the browser; see src/demo). */
  demo?: boolean;
  locked: boolean;
  attempts: number;
}

export interface SessionActions {
  chooseOrg: (org: { id: string; name?: string; allowedDomains?: string[] }) => void;
  resetOrg: () => void;
  authenticate: (doctor: DoctorProfile, token: string, expiresAt: number) => void;
  /** Merge changes into the signed-in doctor (e.g. after a profile edit) and re-persist the session. */
  updateDoctor: (patch: Partial<DoctorProfile>) => void;
  setPin: (pin: string) => Promise<void>;
  lock: () => void;
  unlock: (pin: string) => Promise<boolean>;
  signOut: () => void;
  /** Open the demo: sample patients, no account. Leaving it is `signOut`. */
  startDemo: () => void;
}

export interface MockSessionValue {
  step: SessionStep;
  org?: MockOrganization;
  doctor?: DoctorProfile;
  canLock: boolean;
  attemptsLeft: number;
  /** In the demo (sample data, nothing real). */
  demo: boolean;
  actions: SessionActions;
}

const MAX_ATTEMPTS = 5;
const INACTIVITY_MS = 5 * 60 * 1000;
const DEVICE_KEY = "gg_doc_device";
const FLAGS_KEY = "gg_doc_session_flags";

function readJSON(store: Storage, key: string): Record<string, unknown> {
  try {
    return JSON.parse(store.getItem(key) || "{}");
  } catch {
    return {};
  }
}

/** Account PIN when known, else the device-cached hash (legacy / offline). */
function pinIsSet(s: SessionState): boolean {
  return s.accountHasPin ?? Boolean(s.pinHash);
}

function loadState(): SessionState {
  const device = readJSON(localStorage, DEVICE_KEY);
  const flags = readJSON(sessionStorage, FLAGS_KEY);
  if (resumeDemo()) {
    return {
      orgId: device.orgId as string | undefined,
      orgName: device.orgName as string | undefined,
      orgDomains: Array.isArray(device.orgDomains) ? (device.orgDomains as string[]) : undefined,
      pinHash: device.pinHash as string | undefined,
      doctor: DEMO_DOCTOR,
      demo: true,
      locked: false,
      attempts: 0,
    };
  }
  const session = loadDoctorSession();
  const flagHasPin =
    typeof flags.accountHasPin === "boolean" ? (flags.accountHasPin as boolean) : undefined;
  return {
    orgId: device.orgId as string | undefined,
    orgName: device.orgName as string | undefined,
    orgDomains: Array.isArray(device.orgDomains) ? (device.orgDomains as string[]) : undefined,
    pinHash: device.pinHash as string | undefined,
    accountHasPin: flagHasPin ?? session?.doctor?.hasPin,
    doctor: session?.doctor,
    expiresAt: session?.expiresAt || undefined,
    locked: Boolean(flags.locked),
    attempts: Number(flags.attempts) || 0,
  };
}

function persist(s: SessionState): void {
  try {
    localStorage.setItem(
      DEVICE_KEY,
      JSON.stringify({
        orgId: s.orgId,
        orgName: s.orgName,
        orgDomains: s.orgDomains,
        pinHash: s.pinHash,
      }),
    );
    sessionStorage.setItem(
      FLAGS_KEY,
      JSON.stringify({ locked: s.locked, attempts: s.attempts, accountHasPin: s.accountHasPin }),
    );
  } catch {
    /* ignore */
  }
}

function deriveStep(s: SessionState): SessionStep {
  // Sign-in comes first; the org is picked inside the create-account path, not as a gate.
  if (!s.doctor) return "authenticate";
  if (s.demo) return "ready";
  if (s.locked && pinIsSet(s)) return "locked";
  // A 4-digit PIN is required — no skip. An account without one (new account, or a returning
  // doctor whose device-only PIN predates account PINs) is sent here to set one.
  if (!pinIsSet(s)) return "set_pin";
  return "ready";
}

/**
 * The state after a sign-out. The cached PIN hash and hasPin belong to the doctor leaving — never
 * leave them as a fallback for the next doctor on a shared clinic computer.
 */
function signedOut(prev: SessionState): SessionState {
  return {
    ...prev,
    doctor: undefined,
    expiresAt: undefined,
    demo: false,
    pinHash: undefined,
    accountHasPin: undefined,
    locked: false,
    attempts: 0,
  };
}

/** How often an open portal checks whether its session has run out. */
const EXPIRY_CHECK_MS = 60 * 1000;

const MockSessionContext = createContext<MockSessionValue | null>(null);
export { MockSessionContext };

export function DoctorSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(loadState);

  // Always-current snapshot so the async PIN actions can read the latest doctor/pinHash without
  // being re-created (and re-subscribing the idle timer) on every state change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    persist(state);
  }, [state]);

  const update = useCallback(
    (patch: Partial<SessionState>) => setState((prev) => ({ ...prev, ...patch })),
    [],
  );

  const lock = useCallback(() => setState((prev) => ({ ...prev, locked: true })), []);

  const signOut = useCallback(() => {
    if (stateRef.current.demo) stopDemo();
    clearDoctorSession();
    setState(signedOut);
  }, []);

  // The session ended without the doctor signing out (it expired, or the server rejected it), so
  // say why on the way to the sign-in screen.
  const endLapsedSession = useCallback(() => {
    if (!stateRef.current.doctor) return;
    signOut();
    toast({
      title: "You've been signed out",
      description: "Your session ended. Sign in again to continue.",
      // Longer than the default: the doctor may not be looking when it happens.
      duration: 15_000,
    });
  }, [signOut]);

  const actions = useMemo<SessionActions>(
    () => ({
      chooseOrg: (org) =>
        update({ orgId: org.id, orgName: org.name, orgDomains: org.allowedDomains }),
      resetOrg: () => update({ orgId: undefined, orgName: undefined, orgDomains: undefined }),
      authenticate: (doctor, token, expiresAt) => {
        storeDoctorSession({ token, expiresAt, doctor });
        update({
          doctor,
          expiresAt: expiresAt || undefined,
          accountHasPin: doctor.hasPin,
          locked: false,
          attempts: 0,
        });
      },
      updateDoctor: (patch) =>
        setState((prev) => {
          if (!prev.doctor) return prev;
          const doctor = { ...prev.doctor, ...patch };
          const s = loadDoctorSession();
          if (s) storeDoctorSession({ token: s.token, expiresAt: s.expiresAt, doctor });
          return { ...prev, doctor };
        }),
      setPin: async (pin) => {
        const pinHash = hashPin(pin);
        // Persist to the account so the PIN follows the doctor to any device. Best-effort: if the
        // backend route isn't live yet we still cache locally so this device works today.
        const persisted = await setAccountPin(pinHash);
        // The session can end while that request is out (e.g. the server rejected it) — then there's
        // no one to set a PIN for.
        setState((prev) =>
          prev.doctor
            ? { ...prev, pinHash, accountHasPin: persisted ? true : prev.accountHasPin, locked: false }
            : prev,
        );
      },
      lock,
      unlock: async (pin) => {
        const pinHash = hashPin(pin);
        const cached = stateRef.current.pinHash;
        // Prefer the account PIN; fall back to the device cache when the server can't answer
        // (route missing, offline, or no server PIN yet).
        const server = await verifyAccountPin(pinHash);
        const ok = server ?? (!!cached && cached === pinHash);
        // If the session ended while verifying (the server rejected it), leave the signed-out state
        // alone — in particular, don't write this doctor's PIN hash back for the next one.
        if (ok) {
          // Cache the verified hash so subsequent unlocks work instantly/offline on this device.
          setState((prev) => (prev.doctor ? { ...prev, pinHash, locked: false, attempts: 0 } : prev));
          return true;
        }
        setState((prev) => {
          if (!prev.doctor) return prev;
          const attempts = prev.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            clearDoctorSession();
            return signedOut(prev);
          }
          return { ...prev, attempts };
        });
        return false;
      },
      signOut,
      startDemo: () => {
        clearDoctorSession();
        startDemo();
        setState((prev) => ({
          ...prev,
          doctor: DEMO_DOCTOR,
          demo: true,
          expiresAt: undefined,
          locked: false,
          attempts: 0,
        }));
      },
    }),
    [update, lock, signOut],
  );

  // The demo has no PIN to unlock with, so it never locks.
  const canLock = !state.demo && pinIsSet(state) && Boolean(state.doctor);

  useEffect(() => {
    if (!canLock) return;
    let timer = window.setTimeout(lock, INACTIVITY_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, INACTIVITY_MS);
    };
    const events: (keyof WindowEventMap)[] = ["click", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [canLock, lock]);

  // Signing out — by the doctor, after too many PIN attempts, or when the session lapses — drops
  // every cached query (patient charts, logs, messages, meal photos) so none of it can show for
  // whoever signs in next on this computer. This runs once the sign-in screen has replaced the
  // app, so nothing is still subscribed to refetch. Locking keeps the cache: the same doctor returns.
  const queryClient = useQueryClient();
  const signedInAs = state.doctor ? (state.doctor.doctorId ?? "") : null;
  const lastSignedInAs = useRef(signedInAs);
  useEffect(() => {
    if (lastSignedInAs.current !== null && lastSignedInAs.current !== signedInAs) queryClient.clear();
    lastSignedInAs.current = signedInAs;
  }, [signedInAs, queryClient]);

  // A request sent with this session's token came back 401: the server no longer accepts it.
  useEffect(() => {
    setDoctorSessionRejectedHandler(endLapsedSession);
    return () => setDoctorSessionRejectedHandler(null);
  }, [endLapsedSession]);

  // Sessions have a fixed lifetime. End it here too once it's past, rather than leaving an open
  // tab (even a locked one) sitting on cached data while every request fails.
  const signedIn = Boolean(state.doctor);
  const { expiresAt } = state;
  useEffect(() => {
    if (!signedIn || !expiresAt) return;
    const check = () => {
      if (Date.now() >= expiresAt) endLapsedSession();
    };
    check();
    const timer = window.setInterval(check, EXPIRY_CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [signedIn, expiresAt, endLapsedSession]);

  const value = useMemo<MockSessionValue>(() => {
    // Prefer the org identity captured at pick time (covers server-directory orgs that aren't in
    // the bundled list); fall back to the curated list for devices stored before orgName existed.
    const fromList = mockOrganizations().find((o) => o.id === state.orgId);
    // The demo always shows its sample clinic, never this device's organization.
    const org: MockOrganization | undefined = state.demo
      ? { id: "demo-clinic", name: DEMO_DOCTOR.institution, slug: "demo-clinic", allowedDomains: [] }
      : state.orgId
      ? (fromList ??
        (state.orgName
          ? {
              id: state.orgId,
              name: state.orgName,
              slug: state.orgId,
              allowedDomains: state.orgDomains ?? [],
            }
          : undefined))
      : undefined;
    return {
      step: deriveStep(state),
      org,
      doctor: state.doctor,
      canLock,
      attemptsLeft: MAX_ATTEMPTS - state.attempts,
      demo: Boolean(state.demo),
      actions,
    };
  }, [state, canLock, actions]);

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

/** Whether the portal is showing the demo (sample patients). False outside the session provider. */
export function useIsDemo(): boolean {
  return useContext(MockSessionContext)?.demo ?? false;
}

export function useDoctorSession(): MockSessionValue {
  const value = useContext(MockSessionContext);
  if (!value) throw new Error("useDoctorSession must be used within DoctorSessionProvider");
  return value;
}
