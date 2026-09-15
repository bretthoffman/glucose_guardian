import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";

/**
 * Global "Update ready — restart?" prompt. Renders nothing; mounted once in the root layout so it is
 * live on EVERY screen and for every session type.
 *
 * Why this exists: expo-updates' default `checkAutomatically: ON_LOAD` checks exactly once, at launch,
 * and applies whatever it downloaded on the NEXT launch. Nothing ever tells the user. So anyone who
 * keeps the app open — which is most caregivers, most of the day — sits on the old bundle
 * indefinitely, and the Profile panel's manual "Check for updates" was the only way out. Devices were
 * observed many updates behind for exactly this reason.
 *
 * Two halves, ONE prompt path:
 *  1. Launch: ON_LOAD downloads in the background; `useUpdates().isUpdatePending` flips true when it
 *     finishes, and we prompt right then. "Restart now" is instant — the bundle is already on disk.
 *  2. Open for hours: on every return to the foreground, and every POLL_MS while foregrounded, we
 *     check + fetch. A successful fetch flips the same flag → the same prompt. The poller never shows
 *     anything itself, and its failures are silent — that is background behavior. The Profile panel
 *     stays as the DIAGNOSTIC path, where errors are surfaced on purpose.
 *
 * "Later" snoozes until the next poll tick or foreground return — then it asks again, because an
 * un-applied update on a medical app is a problem worth a gentle nag. Restart is ALWAYS user-initiated:
 * we never `reloadAsync()` on our own, so the app can't restart under a caregiver mid-dose-entry.
 */

/** Foreground poll cadence. A check is one small manifest request to u.expo.dev. */
const POLL_MS = 10 * 60_000;
/**
 * First poll shortly after mount, NOT at 0 — the native ON_LOAD check is already in flight at launch,
 * and this catches the case where it failed (offline at launch, flaky network) without racing it.
 */
const FIRST_POLL_MS = 45_000;

// Off in Expo Go / a dev client, where there is nothing to update.
const ENABLED = Updates.isEnabled && !__DEV__;

export default function UpdatePrompt() {
  const { isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();

  // Interval/AppState callbacks close over stale renders, so the live values ride in refs.
  const pendingRef = useRef(isUpdatePending);
  const busyRef = useRef(false);
  const promptOpenRef = useRef(false);
  const snoozedRef = useRef(false);
  useEffect(() => {
    pendingRef.current = isUpdatePending;
  }, [isUpdatePending]);
  useEffect(() => {
    busyRef.current = isChecking || isDownloading;
  }, [isChecking, isDownloading]);

  const prompt = useCallback(() => {
    if (!pendingRef.current || promptOpenRef.current || snoozedRef.current) return;
    promptOpenRef.current = true;
    const dismiss = () => {
      promptOpenRef.current = false;
      snoozedRef.current = true;
    };
    Alert.alert(
      "Update ready",
      "A new version of Glucose Guardian has been downloaded. Restart to finish updating — it only takes a couple of seconds.",
      [
        { text: "Later", style: "cancel", onPress: dismiss },
        {
          text: "Restart now",
          onPress: () => {
            void Updates.reloadAsync().catch(() => {
              // Nothing to apply after all (or the reload was refused) — let a later tick re-evaluate.
              promptOpenRef.current = false;
            });
          },
        },
      ],
      // Android back-button dismissal must count as "Later", or the open-flag sticks and we never ask again.
      { cancelable: true, onDismiss: dismiss },
    );
  }, []);

  // Launch half: the native ON_LOAD download completing flips this. (Also fires after our own fetch.)
  useEffect(() => {
    if (isUpdatePending) prompt();
  }, [isUpdatePending, prompt]);

  // Open-for-hours half.
  const poll = useCallback(async () => {
    if (!ENABLED) return;
    // A new tick lifts the snooze: "Later" means later, not never.
    snoozedRef.current = false;
    if (busyRef.current) return; // a native check/download is mid-flight — don't pile on
    try {
      if (!pendingRef.current) {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          // The hook's flag updates on the next render; mark locally so this tick can prompt now.
          if (fetched.isNew) pendingRef.current = true;
        }
      }
    } catch {
      /* offline / transient — silent by design; the manual panel surfaces these on purpose */
    }
    prompt();
  }, [prompt]);

  useEffect(() => {
    if (!ENABLED) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let firstTimer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void poll(), POLL_MS);
    };
    // The app mounts in the foreground: schedule the delayed first poll, then the steady cadence.
    firstTimer = setTimeout(() => void poll(), FIRST_POLL_MS);
    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void poll(); // coming back from the background is the best moment to catch up
        start();
      } else {
        stop(); // no polling while backgrounded — iOS would suspend the timer anyway
      }
    });
    return () => {
      stop();
      if (firstTimer) clearTimeout(firstTimer);
      sub.remove();
    };
  }, [poll]);

  return null;
}
