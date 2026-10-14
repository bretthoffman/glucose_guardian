/**
 * Insulin-stacking guard — pure logic (unit-tested in the root vitest run; React-free).
 *
 * "Insulin stacking" is taking a new dose while an earlier one is still actively lowering glucose;
 * rapid-acting insulin keeps working for up to ~4 hours, and overlapping doses can drive glucose
 * dangerously low (hypoglycemia). Clinical guidance (Joslin, hospital protocols) treats a repeat
 * fast-acting dose within ~3 hours as the stacking zone; this app warns when ANOTHER fast-acting
 * dose was logged within the last 90 minutes — by anyone in the care circle, since `insulinLog`
 * is the circle's shared pool.
 *
 * Basal (long-acting) insulin is excluded on BOTH sides: a recent Lantus entry is not a stacking
 * trigger, and logging a basal dose alongside a mealtime bolus is normal therapy, not stacking.
 */
import { findInsulinByChipLabel, isBolusInsulin } from "../constants/insulin";

export const STACKING_WINDOW_MS = 90 * 60_000;
/** Small allowance for cross-device clock skew on "future" timestamps. */
const FUTURE_SKEW_MS = 60_000;

export type StackingEntry = {
  timestamp: string;
  units: number;
  type: "bolus" | "correction" | "manual" | "basal";
  insulinType?: string;
  authorName?: string;
};

/**
 * Fast-acting for stacking purposes: anything that is not basal by its own type, unless its insulin
 * label resolves to a known long-acting product. An unknown label counts as fast — the safe side is
 * to warn.
 */
export function isFastActingEntry(e: Pick<StackingEntry, "type" | "insulinType">): boolean {
  if (e.type === "basal") return false;
  if (e.insulinType) {
    const option = findInsulinByChipLabel(e.insulinType);
    if (option && !isBolusInsulin(option.type)) return false;
  }
  return true;
}

export type RecentDose = { units: number; minutesAgo: number; authorName?: string };

/** The NEWEST fast-acting dose within the window, or null. Entries beyond small clock skew in the future are ignored. */
export function findRecentFastActing(
  entries: readonly StackingEntry[],
  now: number = Date.now(),
  windowMs: number = STACKING_WINDOW_MS,
): RecentDose | null {
  let best: { at: number; e: StackingEntry } | null = null;
  for (const e of entries) {
    const at = new Date(e.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    if (at > now + FUTURE_SKEW_MS || now - at > windowMs) continue;
    if (!(e.units > 0) || !isFastActingEntry(e)) continue;
    if (!best || at > best.at) best = { at, e };
  }
  if (!best) return null;
  const result: RecentDose = {
    units: best.e.units,
    minutesAgo: Math.max(0, Math.round((now - best.at) / 60_000)),
  };
  if (best.e.authorName) result.authorName = best.e.authorName;
  return result;
}

/**
 * The confirmation copy. Wording grounded in published diabetes-education material: stacking =
 * overlapping doses while earlier insulin is still working; rapid-acting lasts up to ~4 h; the risk
 * is hypoglycemia; check insulin on board before adding more.
 */
export function stackingWarning(recent: RecentDose): { title: string; message: string } {
  const mins = recent.minutesAgo <= 1 ? "1 minute" : `${recent.minutesAgo} minutes`;
  const who = recent.authorName ? ` by ${recent.authorName}` : "";
  return {
    title: "Insulin may still be active",
    message:
      `${recent.units} u of insulin was logged${who} ${mins} ago. Rapid-acting insulin keeps lowering ` +
      `glucose for up to 4 hours after a dose. Taking more while an earlier dose is still working — ` +
      `"insulin stacking" — can cause severe low blood sugar (hypoglycemia). Check the insulin still ` +
      `active before adding more.\n\nAre you sure?`,
  };
}
