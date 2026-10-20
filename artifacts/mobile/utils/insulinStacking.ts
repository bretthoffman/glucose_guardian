/**
 * Insulin-stacking guard — pure logic (unit-tested in the root vitest run; React-free).
 *
 * "Insulin stacking" is taking a new dose while an earlier one is still actively lowering glucose;
 * rapid-acting insulin keeps working for up to ~4 hours, and overlapping doses can drive glucose
 * dangerously low (hypoglycemia). Clinical guidance (Joslin, hospital protocols) treats a repeat
 * fast-acting dose within ~3 hours as the stacking zone; this app warns when ANOTHER fast-acting
 * dose was logged within the last 2 hours — by anyone in the care circle, since `insulinLog`
 * is the circle's shared pool. Past 2 hours, logging goes through with no warning.
 *
 * Basal (long-acting) insulin is excluded on BOTH sides: a recent Lantus entry is not a stacking
 * trigger, and logging a basal dose alongside a mealtime bolus is normal therapy, not stacking.
 */
import { findInsulinByChipLabel, isBolusInsulin } from "../constants/insulin";

export const STACKING_WINDOW_MS = 2 * 60 * 60_000;
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

/** "45 min ago" / "1 hr ago" / "1 hr 20 min ago" / "just now". */
export function formatMinutesAgo(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} hr ago` : `${h} hr ${rest} min ago`;
}

/** Units for display: up to 2 decimals, trailing zeros dropped (2.5, 0.25, 4). */
function fmtUnits(u: number): string {
  return String(Math.round(u * 100) / 100);
}

export interface StackingWarningCopy {
  title: string;
  /** "4 u logged 45 min ago" */
  doseLine: string;
  /** "by Mom" when the author is known. */
  byLine?: string;
  /** "About 2.6 u is still working" — total insulin on board, same estimate the calculator uses. */
  activeLine?: string;
  message: string;
  footnote: string;
}

/**
 * The warning window's copy — short on purpose (education, not a lecture). `activeUnits` is the
 * insulin still working from every recent fast-acting dose (computeActiveInsulin().totalUnits).
 */
export function stackingWarning(recent: RecentDose, activeUnits?: number): StackingWarningCopy {
  const copy: StackingWarningCopy = {
    title: "Beware of insulin stacking",
    doseLine: `${fmtUnits(recent.units)} u logged ${formatMinutesAgo(recent.minutesAgo)}`,
    message: "Taking more now can add up and cause a low. Check the trend first and keep fast-acting sugar close.",
    footnote: "A reminder, not a rule. Always follow your doctor's instructions.",
  };
  if (recent.authorName) copy.byLine = `by ${recent.authorName}`;
  if (activeUnits != null && Number.isFinite(activeUnits) && activeUnits >= 0.1) {
    copy.activeLine = `About ${Math.round(activeUnits * 10) / 10} u is still working`;
  }
  return copy;
}
