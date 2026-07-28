import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { useAuth, type MessagingIdentity } from "@/context/AuthContext";
import {
  getExpoPushToken,
  getNotificationPermissionStatus,
  registerAndroidChannels,
} from "@/services/notifications";

/**
 * Per-category alert switches. These live on the SERVER (one row per device, in `pushTokens.prefs`)
 * because the backend is what decides whether to send a push — a device-local toggle would be
 * invisible to it. What's here is a mirror for instant UI feedback.
 */
export interface PushPrefs {
  glucoseUrgent: boolean;
  glucoseHighLow: boolean;
  careLog: boolean;
  messages: boolean;
  doctor: boolean;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  glucoseUrgent: true,
  glucoseHighLow: true,
  careLog: true,
  messages: true,
  doctor: true,
};

/** Per-device custom alert sounds (bundled filenames); a missing key = the system default sound. */
export interface AlertSounds {
  glucose?: string;
  urgent?: string;
  messages?: string;
}

/** The sounds shipped INSIDE the app (iOS offers no API to use the phone's ringtone bank). */
/**
 * The bundled alert-sound library (files ship in the app via the expo-notifications plugin —
 * iOS forbids using the phone's own tones). "alarms" are loud attention-grabbers for glucose
 * emergencies; "tones" are gentler picks for messages and everyday alerts. The licensed files
 * come from Mixkit's royalty-free SFX library (see assets/sounds/SOURCES.md).
 */
export const ALERT_SOUND_OPTIONS: {
  file: string | undefined;
  label: string;
  group: "default" | "alarms" | "tones";
}[] = [
  { file: undefined, label: "Default", group: "default" },
  // ── Alarms — insistent, hard to miss ──
  { file: "emergency.wav", label: "Emergency", group: "alarms" },
  { file: "critical.wav", label: "Critical", group: "alarms" },
  { file: "siren.wav", label: "Siren", group: "alarms" },
  { file: "redalert.wav", label: "Red Alert", group: "alarms" },
  { file: "warningbuzzer.wav", label: "Warning Buzzer", group: "alarms" },
  { file: "classicalarm.wav", label: "Classic Alarm", group: "alarms" },
  { file: "security.wav", label: "Security Alarm", group: "alarms" },
  { file: "alertalarm.wav", label: "Alert Alarm", group: "alarms" },
  { file: "urgentloop.wav", label: "Urgent Loop", group: "alarms" },
  { file: "alarmclock.wav", label: "Alarm Clock", group: "alarms" },
  { file: "battleship.wav", label: "Battleship", group: "alarms" },
  { file: "retroalarm.wav", label: "Retro Alarm", group: "alarms" },
  { file: "alarmtone.wav", label: "Alarm Tone", group: "alarms" },
  { file: "shortalarm.wav", label: "Short Alarm", group: "alarms" },
  { file: "urgent.wav", label: "Urgent", group: "alarms" },
  { file: "pulse.wav", label: "Pulse", group: "alarms" },
  // ── Tones — friendlier chimes and dings ──
  { file: "ding.wav", label: "Ding", group: "tones" },
  { file: "happybells.wav", label: "Happy Bells", group: "tones" },
  { file: "positive.wav", label: "Positive", group: "tones" },
  { file: "bright.wav", label: "Bright", group: "tones" },
  { file: "pop.wav", label: "Pop", group: "tones" },
  { file: "announce.wav", label: "Announce", group: "tones" },
  { file: "marimba.wav", label: "Marimba", group: "tones" },
  { file: "guitar.wav", label: "Guitar", group: "tones" },
  { file: "flute.wav", label: "Flute", group: "tones" },
  { file: "chime.wav", label: "Chime", group: "tones" },
  { file: "bell.wav", label: "Bell", group: "tones" },
  { file: "soft.wav", label: "Soft", group: "tones" },
];

interface PushContextType {
  /** This device's Expo push token, once registered. Null = push unavailable on this device. */
  pushToken: string | null;
  prefs: PushPrefs;
  /** True once we've registered with the backend (so the Alerts UI knows toggles will stick). */
  registered: boolean;
  /** Kid/caregiver sessions (codes + nurse accounts): Message Alerts are locked ON. */
  messagesLocked: boolean;
  updatePrefs: (patch: Partial<PushPrefs>) => Promise<void>;
  /** This device's chosen alert sounds by group (empty = defaults). */
  sounds: AlertSounds;
  updateSounds: (patch: AlertSounds) => Promise<void>;
  /**
   * Re-run device registration if it hasn't succeeded yet (no-op once registered). Call after
   * granting notification permission: the register effect only fires on identity changes, so a
   * first-run "sign in → then tap Allow" sequence otherwise stays unregistered until relaunch.
   */
  ensureRegistered: () => void;
}

const PushContext = createContext<PushContextType | null>(null);

/** The Convex args for whichever identity owns this device (guardian account or access code). */
function ownerArgs(identity: MessagingIdentity) {
  if (!identity) return null;
  if (identity.kind === "code") return { code: identity.code } as const;
  return { userId: identity.userId as Id<"users">, passwordHash: identity.passwordHash } as const;
}

function identityKey(identity: MessagingIdentity): string | null {
  if (!identity) return null;
  return identity.kind === "code" ? `code:${identity.code}` : `user:${identity.userId}`;
}

export function PushProvider({ children }: { children: React.ReactNode }) {
  const { messagingIdentity, caregiverSession, profile } = useAuth();
  const key = identityKey(messagingIdentity);

  // Message Alerts are LOCKED ON for every kid/caregiver access-code session and for caregiver
  // (nurse) email accounts — a caregiver must never silently miss guardian messages.
  const messagesLocked = caregiverSession || profile?.accountRole === "caregiver";
  const messagesLockedRef = useRef(messagesLocked);
  useEffect(() => { messagesLockedRef.current = messagesLocked; }, [messagesLocked]);

  const [pushToken, setPushToken] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [sounds, setSounds] = useState<AlertSounds>({});
  const [registered, setRegistered] = useState(false);
  const registeredRef = useRef(false);
  useEffect(() => { registeredRef.current = registered; }, [registered]);
  /** Bumped by ensureRegistered() to re-run the register effect after a permission grant. */
  const [regTick, setRegTick] = useState(0);
  const identityRef = useRef<MessagingIdentity>(messagingIdentity);
  useEffect(() => { identityRef.current = messagingIdentity; }, [messagingIdentity]);

  const ensureRegistered = useCallback(() => {
    if (!registeredRef.current) setRegTick((t) => t + 1);
  }, []);

  // Register this device against the current identity whenever that identity changes. The token is
  // stable per install, so re-registering just re-points the existing row to whoever is signed in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRegistered(false);
      const args = ownerArgs(identityRef.current);
      if (!args) {
        setPushToken(null);
        return;
      }
      const perm = await getNotificationPermissionStatus();
      if (!perm.granted) return; // the dashboard prompt handles asking; nothing to register yet
      await registerAndroidChannels();
      const token = await getExpoPushToken();
      if (cancelled || !token) return;
      setPushToken(token);
      try {
        const client = createConvexAuthClient();
        await client.mutation(api.push.registerToken, {
          ...args,
          token,
          platform: Platform.OS,
        });
        const remote = await client.query(api.push.getPrefs, { token });
        if (cancelled) return;
        if (remote?.prefs) {
          const loaded = { ...(remote.prefs as PushPrefs) };
          // Self-heal older rows: locked identities force messages ON, and doctor always mirrors
          // messages (its standalone toggle is gone — one switch drives both categories).
          const needsHeal =
            (messagesLockedRef.current && !loaded.messages) || loaded.doctor !== (messagesLockedRef.current || loaded.messages);
          if (messagesLockedRef.current) loaded.messages = true;
          loaded.doctor = loaded.messages;
          if (needsHeal) void client.mutation(api.push.setPrefs, { token, prefs: loaded }).catch(() => {});
          setPrefs(loaded);
        }
        if (remote?.sounds) setSounds(remote.sounds as AlertSounds);
        setRegistered(true);
      } catch {
        // Backend not reachable / not deployed yet — the app is fully usable, just without push.
      }
    })();
    return () => { cancelled = true; };
  }, [key, regTick]);

  const updatePrefs = useCallback(
    async (patch: Partial<PushPrefs>) => {
      // The lock wins over any attempt (UI is disabled too — this is the backstop). The doctor
      // category has no toggle of its own — it always mirrors Message Alerts.
      const next = { ...prefs, ...patch, ...(messagesLockedRef.current ? { messages: true } : {}) };
      next.doctor = next.messages;
      setPrefs(next); // optimistic so the switch doesn't lag
      if (!pushToken) return;
      try {
        await createConvexAuthClient().mutation(api.push.setPrefs, { token: pushToken, prefs: next });
      } catch {
        setPrefs(prefs); // roll back on failure so the UI never lies about what the server knows
      }
    },
    [prefs, pushToken],
  );

  const updateSounds = useCallback(
    async (patch: AlertSounds) => {
      const next = { ...sounds, ...patch };
      // Drop cleared keys so "Default" truly unsets rather than storing undefined.
      (Object.keys(next) as (keyof AlertSounds)[]).forEach((k) => {
        if (next[k] == null) delete next[k];
      });
      setSounds(next); // optimistic
      if (!pushToken) return;
      try {
        await createConvexAuthClient().mutation(api.push.setSounds, { token: pushToken, sounds: next });
      } catch {
        setSounds(sounds); // roll back so the UI matches what the server knows
      }
    },
    [sounds, pushToken],
  );

  // Expose the locked view so every consumer renders Message Alerts ON for locked identities;
  // doctor mirrors messages unconditionally (they are one switch in the UI).
  const base = messagesLocked ? { ...prefs, messages: true } : { ...prefs };
  const effectivePrefs = { ...base, doctor: base.messages };

  return (
    <PushContext.Provider value={{ pushToken, prefs: effectivePrefs, registered, messagesLocked, updatePrefs, sounds, updateSounds, ensureRegistered }}>
      {children}
    </PushContext.Provider>
  );
}

export function usePush(): PushContextType {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error("usePush must be used within a PushProvider");
  return ctx;
}
