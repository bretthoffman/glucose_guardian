/**
 * "Who's with the child right now?" for the chat assistant: the app's best guess, never a fact.
 *
 * It goes by whoever logged most recently (insulin, a meal, a finger stick), because that's who is
 * actually doing the care (Holly logs at school; Andrea is backup and rarely logs). Care Circle
 * schedules (a nurse's school-hours code, grandma's visit window) are the backup signal when nobody
 * else has logged lately. Pure, so it is unit-tested; the chat route turns it into plain guidance.
 */
import { careAccessAllowed, type CareAccess } from "../../../convex/careSchedule";

export interface CareLog {
  timestamp: string;
  /** What was logged, in plain words: "insulin", "a meal", "a finger stick". */
  what: string;
  authorName?: string;
  authorUserId?: string;
  authorCode?: string;
}

export interface CareHelper {
  /** The access code's label, e.g. "Holly (school nurse)": also the byline on that code's logs. */
  name: string;
  access: CareAccess;
  kind?: "caregiver" | "child";
}

export interface CareNow {
  /** The newest log in the last 12 hours, and whether the person chatting made it. */
  lastLog?: { by: string; byYou: boolean; minutesAgo: number; what: string };
  /** Helpers whose Care Circle schedule is open right now (school hours, a visit window). */
  scheduledNow: { name: string; until?: string }[];
}

const RECENT_MS = 12 * 60 * 60 * 1000;

function clock(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** When an open schedule closes, as the person setting it would read it ("2:30 PM"). */
function scheduleEnds(access: CareAccess): string | undefined {
  if (access.mode === "weekly") return clock(access.endMinute);
  if (access.mode === "window") {
    const d = new Date(access.endMs);
    return clock(d.getHours() * 60 + d.getMinutes());
  }
  return undefined;
}

export function buildCareNow(input: {
  logs: CareLog[];
  helpers: CareHelper[];
  me: { userId?: string | null; code?: string | null };
  nowMs: number;
}): CareNow {
  const { nowMs, me } = input;
  const newest = input.logs
    .map((l) => ({ l, t: new Date(l.timestamp).getTime() }))
    .filter(({ t }) => Number.isFinite(t) && t <= nowMs + 5 * 60_000 && nowMs - t <= RECENT_MS)
    .sort((a, b) => b.t - a.t)[0];

  let lastLog: CareNow["lastLog"];
  if (newest) {
    const { l, t } = newest;
    const byYou =
      (!!me.userId && l.authorUserId === me.userId) ||
      (!!me.code && !!l.authorCode && l.authorCode.toUpperCase() === me.code.toUpperCase()) ||
      (!l.authorUserId && !l.authorCode && !l.authorName); // an untagged entry is this phone's own
    lastLog = {
      by: l.authorName?.trim() || (byYou ? "you" : "someone in the care circle"),
      byYou,
      minutesAgo: Math.max(0, Math.round((nowMs - t) / 60_000)),
      what: l.what,
    };
  }

  const scheduledNow = input.helpers
    .filter((h) => h.kind !== "child" && (h.access.mode === "weekly" || h.access.mode === "window"))
    .filter((h) => careAccessAllowed(h.access, nowMs))
    .map((h) => ({ name: h.name, until: scheduleEnds(h.access) }));

  return { ...(lastLog ? { lastLog } : {}), scheduledNow };
}
