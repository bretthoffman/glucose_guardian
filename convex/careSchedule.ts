/**
 * Lazy care-access schedule evaluation — the single source of truth for "may this member see the
 * patient's data RIGHT NOW". Pure TypeScript with no Convex imports so it is unit-testable and
 * importable by the mobile app for UI messaging (the server remains the enforcement boundary).
 *
 * Semantics:
 *  - "always"   → ok.
 *  - "disabled" → blocked until an admin re-enables (the "grandma between visits" state).
 *  - "window"   → one-time [startMs, endMs) grant; inert afterward until an admin sets a new one.
 *  - "weekly"   → recurring schedule (school hours) in the SETTER's timezone, captured as a fixed
 *                 UTC offset at setup time. Days are 0–6 (Sun–Sat); minutes are since local
 *                 midnight with startMinute < endMinute (same-day windows only, by design).
 */
export type CarePermissions = {
  viewReadings: boolean;
  viewLogs: boolean;
  log: boolean;
  useCalculator: boolean;
  chat: boolean;
};

export type CareAccess =
  | { mode: "always" }
  | { mode: "disabled" }
  | { mode: "window"; startMs: number; endMs: number }
  | {
      mode: "weekly";
      days: number[];
      startMinute: number;
      endMinute: number;
      tzOffsetMinutes: number;
    };

export type CareAccessState = "ok" | "before_window" | "outside_window" | "disabled";

export interface CareAccessEvaluation {
  state: CareAccessState;
  /** When a currently-blocked window/weekly grant next opens (ms epoch), when computable. */
  nextStartMs?: number;
}

const DAY_MIN = 24 * 60;

export function evaluateCareAccess(access: CareAccess, nowMs: number): CareAccessEvaluation {
  switch (access.mode) {
    case "always":
      return { state: "ok" };
    case "disabled":
      return { state: "disabled" };
    case "window": {
      if (nowMs < access.startMs) return { state: "before_window", nextStartMs: access.startMs };
      if (nowMs < access.endMs) return { state: "ok" };
      return { state: "outside_window" };
    }
    case "weekly": {
      const days = [...new Set(access.days)].filter((d) => d >= 0 && d <= 6);
      if (days.length === 0) return { state: "disabled" };
      // Shift to the setter's local clock, then read day/minutes in UTC space.
      const local = new Date(nowMs + access.tzOffsetMinutes * 60_000);
      const day = local.getUTCDay();
      const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
      if (days.includes(day) && minute >= access.startMinute && minute < access.endMinute) {
        return { state: "ok" };
      }
      // Next opening: scan the next 7 days (including today's later window).
      for (let ahead = 0; ahead <= 7; ahead++) {
        const candidateDay = (day + ahead) % 7;
        if (!days.includes(candidateDay)) continue;
        if (ahead === 0 && minute >= access.startMinute) continue; // today's window already passed/open-checked
        const minutesUntilMidnight = ahead === 0 ? 0 : DAY_MIN - minute + (ahead - 1) * DAY_MIN;
        const minutesUntilStart =
          ahead === 0 ? access.startMinute - minute : minutesUntilMidnight + access.startMinute;
        return { state: "outside_window", nextStartMs: nowMs + minutesUntilStart * 60_000 };
      }
      return { state: "outside_window" };
    }
  }
}

/** True when the member may access data right now. */
export function careAccessAllowed(access: CareAccess, nowMs: number): boolean {
  return evaluateCareAccess(access, nowMs).state === "ok";
}

export const FULL_CARE_PERMISSIONS: CarePermissions = {
  viewReadings: true,
  viewLogs: true,
  log: true,
  useCalculator: true,
  chat: true,
};

/** External-guardian default: view-only; admins grant more per code (the teacher case). */
export const VIEWER_CARE_PERMISSIONS: CarePermissions = {
  viewReadings: true,
  viewLogs: true,
  log: false,
  useCalculator: false,
  chat: false,
};
