/**
 * The recheck timer after a treated low: one per phone, kept across restarts. The Glucose screen shows
 * the countdown (components/RecheckTimerCard) and a phone notification fires when it's time.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export interface RecheckTimer {
  startedAt: number;
  endsAt: number;
  minutes: number;
  childName: string;
  /** What was given ("4 glucose tabs"). */
  treatment: string;
  notificationId: string | null;
}

const KEY = "@gluco_guardian_recheck_timer";
/** A finished timer stays on screen this long so "Time to recheck" isn't missed, then clears itself. */
export const DONE_LINGER_MS = 30 * 60_000;

let current: RecheckTimer | null = null;
let loaded = false;
/** Bumped on every set, so a slow first load never overwrites a timer started meanwhile. */
let version = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Whether a timer is still worth showing at `nowMs`. */
export function timerIsLive(t: RecheckTimer | null, nowMs: number): t is RecheckTimer {
  return !!t && nowMs < t.endsAt + DONE_LINGER_MS;
}

/** "11:24" left, or null once it's time. */
export function timeLeftLabel(t: RecheckTimer, nowMs: number): string | null {
  const left = Math.ceil((t.endsAt - nowMs) / 1000);
  if (left <= 0) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Fraction of the wait already done, 0 to 1. */
export function timerProgress(t: RecheckTimer, nowMs: number): number {
  const span = t.endsAt - t.startedAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - t.startedAt) / span));
}

async function load() {
  if (loaded) return;
  loaded = true;
  const v = version;
  let saved: RecheckTimer | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as RecheckTimer) : null;
    saved = timerIsLive(t, Date.now()) ? t : null;
  } catch {
    saved = null;
  }
  if (v !== version) return;
  current = saved;
  emit();
}

export async function setRecheckTimer(t: RecheckTimer | null): Promise<void> {
  current = t;
  loaded = true;
  version++;
  emit();
  try {
    if (t) await AsyncStorage.setItem(KEY, JSON.stringify(t));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* the countdown still shows this session */
  }
}

export function getRecheckTimer(): RecheckTimer | null {
  return current;
}

export function useRecheckTimer(): RecheckTimer | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      void load();
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
