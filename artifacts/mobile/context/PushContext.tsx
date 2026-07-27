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
export const ALERT_SOUND_OPTIONS: { file: string | undefined; label: string }[] = [
  { file: undefined, label: "Default" },
  { file: "chime.wav", label: "Chime" },
  { file: "bell.wav", label: "Bell" },
  { file: "pulse.wav", label: "Pulse" },
  { file: "soft.wav", label: "Soft" },
  { file: "urgent.wav", label: "Urgent" },
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
  const identityRef = useRef<MessagingIdentity>(messagingIdentity);
  useEffect(() => { identityRef.current = messagingIdentity; }, [messagingIdentity]);

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
          // Self-heal a pre-lock row: a locked identity with messages off gets corrected upstream.
          if (messagesLockedRef.current && !loaded.messages) {
            loaded.messages = true;
            void client.mutation(api.push.setPrefs, { token, prefs: loaded }).catch(() => {});
          }
          setPrefs(loaded);
        }
        if (remote?.sounds) setSounds(remote.sounds as AlertSounds);
        setRegistered(true);
      } catch {
        // Backend not reachable / not deployed yet — the app is fully usable, just without push.
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  const updatePrefs = useCallback(
    async (patch: Partial<PushPrefs>) => {
      // The lock wins over any attempt (UI is disabled too — this is the backstop).
      const next = { ...prefs, ...patch, ...(messagesLockedRef.current ? { messages: true } : {}) };
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

  // Expose the locked view so every consumer renders Message Alerts ON for locked identities.
  const effectivePrefs = messagesLocked ? { ...prefs, messages: true } : prefs;

  return (
    <PushContext.Provider value={{ pushToken, prefs: effectivePrefs, registered, messagesLocked, updatePrefs, sounds, updateSounds }}>
      {children}
    </PushContext.Provider>
  );
}

export function usePush(): PushContextType {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error("usePush must be used within a PushProvider");
  return ctx;
}
