/**
 * Insulin pen / vial countdown — pure rules (unit-tested). A pen or vial is good for a fixed number
 * of days once opened (from its label; editable). Entries without a `form` are pens (every
 * countdown before vials existed). Days are counted by LOCAL calendar date, so "opened Oct 5,
 * good for 28 days" means change it by Nov 2, whatever time of day it was opened.
 *
 * This is a reminder about the pen's age only. It never estimates units left in a pen: the app
 * can't see priming shots or missed logs, and a wrong "units left" is worse than none.
 */

import { findInsulinByChipLabel, insulinPack, type InsulinForm } from "../constants/insulin";
import { formWord } from "./insulinForms";

export type PenEndReason = "used_up" | "lost" | "damaged" | "temperature" | "reached_limit" | "other";

export interface PenLike {
  id: string;
  insulinLabel: string;
  /** Pen or vial; missing = pen. */
  form?: InsulinForm;
  name?: string;
  /** YYYY-MM-DD, local. */
  openedOn: string;
  goodForDays: number;
  endedOn?: string;
  endReason?: PenEndReason;
}

export const DEFAULT_PEN_DAYS = 28;
export const MIN_PEN_DAYS = 1;
export const MAX_PEN_DAYS = 120;
/** Amber from this many days left (inclusive). */
export const PEN_SOON_DAYS = 3;

/** "Humalog · 100 u/mL" → "Humalog". */
export function insulinName(label: string): string {
  return label.split(" · ")[0]!.trim();
}

/**
 * Days it's good for once opened, from the label of that insulin's pen or vial (constants/insulin).
 * Unknown insulins, or a form the insulin isn't sold as, fall back to 28.
 */
export function defaultPenDays(insulinLabel: string, form: InsulinForm = "pen"): number {
  const opt = findInsulinByChipLabel(insulinLabel);
  return (opt && insulinPack(opt, form)?.days) ?? DEFAULT_PEN_DAYS;
}

/** Local calendar date → "YYYY-MM-DD". */
export function toLocalDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

/** "YYYY-MM-DD" → local midnight, or null when malformed. */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** Whole calendar days from a to b (b later → positive). DST-safe. */
export function daysBetween(a: string, b: string): number {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  if (!da || !db) return 0;
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  if (!d) return date;
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" → "Oct 5". */
export function formatPenDate(date: string): string {
  const d = parseLocalDate(date);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : date;
}

export type PenTone = "ok" | "soon" | "today" | "over";

export interface PenStatus {
  daysLeft: number;
  /** Last day to use it (YYYY-MM-DD). */
  changeBy: string;
  tone: PenTone;
  /** Ring fill, 0–1 (share of the pen's days still left). */
  fraction: number;
  /** "13 days left" / "1 day left" / "Change today" / "Past 28 days". */
  label: string;
}

export function penStatus(pen: Pick<PenLike, "openedOn" | "goodForDays">, today: string): PenStatus {
  const days = Math.max(1, Math.round(pen.goodForDays));
  const changeBy = addDays(pen.openedOn, days);
  const daysLeft = daysBetween(today, changeBy);
  const tone: PenTone = daysLeft < 0 ? "over" : daysLeft === 0 ? "today" : daysLeft <= PEN_SOON_DAYS ? "soon" : "ok";
  const label =
    tone === "over" ? `Past ${days} days` : tone === "today" ? "Change today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  return { daysLeft, changeBy, tone, fraction: Math.max(0, Math.min(1, daysLeft / days)), label };
}

/** Open pens, the ones needing attention first. */
export function activePens<T extends PenLike>(pens: T[], today: string): T[] {
  return pens
    .filter((p) => !p.endedOn)
    .slice()
    .sort((a, b) => penStatus(a, today).daysLeft - penStatus(b, today).daysLeft);
}

/** Ended pens, most recently ended first. */
export function endedPens<T extends PenLike>(pens: T[]): T[] {
  return pens
    .filter((p) => !!p.endedOn)
    .slice()
    .sort((a, b) => (b.endedOn! < a.endedOn! ? -1 : b.endedOn! > a.endedOn! ? 1 : 0));
}

/** True when any open pen is within PEN_SOON_DAYS, due today, or overdue (the Insulin tab dot). */
export function penNeedsAttention(pens: PenLike[], today: string): boolean {
  return pens.some((p) => !p.endedOn && penStatus(p, today).tone !== "ok");
}

const sameName = (a?: string, b?: string) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Starting one of the same insulin, the same form (pen / vial) AND the same name (both blank counts
 * as the same) replaces the open one; a different name ("School" next to "Home") or the other form
 * is an extra one and replaces nothing.
 */
export function penBeingReplaced<T extends PenLike>(pens: T[], insulinLabel: string, name?: string, form?: InsulinForm): T | null {
  return (
    pens.find(
      (p) => !p.endedOn && p.insulinLabel === insulinLabel && formWord(p.form) === formWord(form) && sameName(p.name, name),
    ) ?? null
  );
}

export const PEN_END_REASONS: { key: Exclude<PenEndReason, "reached_limit">; label: string }[] = [
  { key: "used_up", label: "Used it all" },
  { key: "lost", label: "Lost or left somewhere" },
  { key: "damaged", label: "Damaged or dropped" },
  { key: "temperature", label: "Got too hot or cold" },
  { key: "other", label: "Other" },
];

export function penEndReasonLabel(reason: PenEndReason | undefined, goodForDays: number): string {
  if (reason === "reached_limit") return `Reached ${goodForDays} days`;
  return PEN_END_REASONS.find((r) => r.key === reason)?.label ?? "Ended";
}

/** "Lantus pen" / "Humalog vial" */
export function supplyName(pen: Pick<PenLike, "insulinLabel" | "form">): string {
  return `${insulinName(pen.insulinLabel)} ${formWord(pen.form)}`;
}

/** "Lantus pen · Home" / "Humalog vial" */
export function penTitle(pen: Pick<PenLike, "insulinLabel" | "name" | "form">): string {
  const n = supplyName(pen);
  return pen.name ? `${n} · ${pen.name}` : n;
}

export interface PenReminder {
  /** Stable per pen + kind, so rescheduling replaces rather than duplicates. */
  key: string;
  /** Local date it fires (at REMINDER_HOUR). */
  date: string;
  title: string;
  body: string;
}

export const REMINDER_HOUR = 9;

/**
 * The reminders for one open pen: 3 days before, the day before, and the change-by day — only the
 * ones still ahead (`nowDate`/`nowHour` = the device's current local date and hour).
 */
export function penReminders(pen: PenLike, nowDate: string, nowHour: number): PenReminder[] {
  if (pen.endedOn) return [];
  const { changeBy } = penStatus(pen, nowDate);
  const title = penTitle(pen);
  const word = formWord(pen.form);
  const out: PenReminder[] = [
    { key: `${pen.id}:3`, date: addDays(changeBy, -3), title: `${title}: 3 days left`, body: `Plan a new ${word} by ${formatPenDate(changeBy)}.` },
    { key: `${pen.id}:1`, date: addDays(changeBy, -1), title: `${title}: last day tomorrow`, body: `Have a new ${word} ready.` },
    { key: `${pen.id}:0`, date: changeBy, title: `Time to change the ${title}`, body: `It's been ${pen.goodForDays} days. Tap to start a new one.` },
  ];
  return out.filter((r) => {
    const d = daysBetween(nowDate, r.date);
    return d > 0 || (d === 0 && nowHour < REMINDER_HOUR);
  });
}

/** Pen ids: `pen_<ms>_<rand>` (the merge helpers read the creation time out of the id). */
export function newPenId(nowMs: number = Date.now()): string {
  return `pen_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Merge the cloud's pens with this device's. Cloud wins, except a local pen still waiting to sync
 * (`pendingSync`) — a fresh start, edit or end — which wins over its cloud copy until the server
 * acknowledges it. Local pens the cloud doesn't have are kept only while pending or under 2 minutes
 * old (so a delete elsewhere is respected).
 */
export function mergePens<T extends PenLike & { pendingSync?: boolean; timestamp?: string }>(
  cloud: T[],
  local: T[],
  nowMs: number = Date.now(),
): T[] {
  const pendingLocal = new Map(local.filter((p) => p.pendingSync).map((p) => [p.id, p]));
  const cloudIds = new Set(cloud.map((p) => p.id));
  const fromCloud = cloud.map((p) => pendingLocal.get(p.id) ?? p);
  const localOnly = local.filter((p) => {
    if (cloudIds.has(p.id)) return false;
    if (p.pendingSync) return true;
    const ms = Number(p.id.split("_")[1]);
    return Number.isFinite(ms) && nowMs - ms < 2 * 60 * 1000;
  });
  return [...fromCloud, ...localOnly];
}
