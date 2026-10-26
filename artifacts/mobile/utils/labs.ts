/**
 * Lab results helpers (pure, unit-tested): test names, formatting, the latest A1C, and how a lab
 * A1C compares with the app's estimate for the 90 days before it was drawn.
 */
export type LabTest = "a1c" | "tsh" | "celiac" | "glucose" | "other";
export type LabSource = "manual" | "photo" | "mychart";

export interface LabResult {
  id: string;
  test: LabTest | string;
  name: string;
  value?: number;
  valueText?: string;
  unit?: string;
  refRange?: string;
  /** YYYY-MM-DD, the day it was drawn. */
  takenOn: string;
  source: LabSource;
  externalId?: string;
  authorName?: string;
}

export const LAB_TEST_CHOICES: { test: LabTest; name: string; unit?: string }[] = [
  { test: "a1c", name: "A1C", unit: "%" },
  { test: "tsh", name: "Thyroid (TSH)", unit: "mIU/L" },
  { test: "celiac", name: "Celiac screen" },
  { test: "glucose", name: "Glucose (blood draw)", unit: "mg/dL" },
  { test: "other", name: "Other" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26" → "Oct 26, 2026". */
export function formatLabDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : d;
}

/** "7.8%" / "142 mg/dL" / "Negative". */
export function formatLabValue(r: Pick<LabResult, "value" | "valueText" | "unit">): string {
  if (r.value == null) return r.valueText ?? "";
  const unit = r.unit?.trim();
  if (!unit) return String(r.value);
  return unit === "%" ? `${r.value}%` : `${r.value} ${unit}`;
}

/** Newest first by the day drawn. */
export function sortLabs<T extends Pick<LabResult, "takenOn">>(labs: T[]): T[] {
  return [...labs].sort((a, b) => (a.takenOn < b.takenOn ? 1 : a.takenOn > b.takenOn ? -1 : 0));
}

/** A1C results, newest first. */
export function a1cResults<T extends Pick<LabResult, "test" | "value" | "takenOn">>(labs: T[]): T[] {
  return sortLabs(labs.filter((l) => l.test === "a1c" && l.value != null));
}

/** Change since the previous lab A1C, e.g. "Down 0.3 since Aug 17, 2026", or null. */
export function a1cChange(latest: Pick<LabResult, "value">, previous?: Pick<LabResult, "value" | "takenOn">): string | null {
  if (!previous || latest.value == null || previous.value == null) return null;
  const diff = Math.round((latest.value - previous.value) * 10) / 10;
  if (diff === 0) return `Same as ${formatLabDate(previous.takenOn)}`;
  return `${diff < 0 ? "Down" : "Up"} ${Math.abs(diff).toFixed(1)} since ${formatLabDate(previous.takenOn)}`;
}

/**
 * How the app's estimate for the 90 days before a lab compares with the lab. Within 0.5 is normal;
 * more than that is common too (red blood cell life differs person to person), so it's said plainly.
 */
export function estimateVsLab(lab: number, estimate: number): string {
  const diff = Math.round(Math.abs(lab - estimate) * 10) / 10;
  if (diff === 0) return `The app's estimate was ${estimate}%, the same as the lab.`;
  if (diff <= 0.5) return `The app's estimate was ${estimate}%, within ${diff.toFixed(1)} of the lab. That's a close match.`;
  return `The app's estimate was ${estimate}%, ${diff.toFixed(1)} ${estimate < lab ? "lower" : "higher"} than the lab. That gap is common and is worth mentioning to the doctor.`;
}

/**
 * A one-time lab glucose is judged against a range for people without diabetes (70 to 100), so the
 * lab flags almost any value high. Say so instead of alarming anyone.
 */
export function labGlucoseNote(): string {
  return "A single blood draw at the lab. The lab's normal range is for people without diabetes, so it's often marked high.";
}

/** Local calendar date → "YYYY-MM-DD". */
export function toLocalIsoDate(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

/** "10/26/2026", "Oct 26 2026", "2026-10-26" → "2026-10-26" (or null). */
export function parseLabDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) return iso(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![1]!.toLowerCase());
    if (mi >= 0) return iso(Number(m[3]), mi + 1, Number(m[2]));
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return toLocalIsoDate(dt);
}

export function newLabId(nowMs: number = Date.now()): string {
  return `lab_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
}
