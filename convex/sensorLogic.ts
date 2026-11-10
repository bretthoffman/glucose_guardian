/**
 * CGM sensor countdown rules (pure; the app imports this too). How long each sensor lasts, its grace
 * period and warm-up, where a sensor is in its life right now, the night-before reminder time, and
 * spotting the gap in readings that a sensor change leaves behind.
 */

export type SensorKind = "g7" | "g7_15" | "g6" | "libre14" | "libre15";

export interface SensorSpec {
  label: string;
  short: string;
  brand: "dexcom" | "libre";
  days: number;
  /** Dexcom G7 keeps reading for 12 hours after its days end. */
  graceHours: number;
  /** About how long before the first reading. G7 often finishes in about 25 minutes. */
  warmupMin: number;
}

export const SENSOR_SPECS: Record<SensorKind, SensorSpec> = {
  g7: { label: "Dexcom G7", short: "G7", brand: "dexcom", days: 10, graceHours: 12, warmupMin: 25 },
  g7_15: { label: "Dexcom G7 15 Day", short: "G7 15 Day", brand: "dexcom", days: 15, graceHours: 12, warmupMin: 60 },
  g6: { label: "Dexcom G6", short: "G6", brand: "dexcom", days: 10, graceHours: 0, warmupMin: 120 },
  libre14: { label: "FreeStyle Libre", short: "Libre", brand: "libre", days: 14, graceHours: 0, warmupMin: 60 },
  libre15: { label: "FreeStyle Libre Plus", short: "Libre Plus", brand: "libre", days: 15, graceHours: 0, warmupMin: 60 },
};

export const SENSOR_KINDS = Object.keys(SENSOR_SPECS) as SensorKind[];
export const SENSOR_SITES = ["Left arm", "Right arm", "Left belly", "Right belly", "Left hip", "Right hip", "Other"];
export const LOW_SUPPLY = 2;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function isSensorKind(k: string): k is SensorKind {
  return k in SENSOR_SPECS;
}

export type SensorPhase = "warmup" | "active" | "lastDay" | "grace" | "expired";

export interface SensorStatus {
  phase: SensorPhase;
  endsAt: number;
  /** When it stops reading for good (endsAt for sensors without a grace period). */
  stopsAt: number;
  /** Time left in the current phase's countdown: to the end, to the end of grace, or warm-up left. */
  msLeft: number;
  /** Share of the sensor's days already used, 0 to 1 (the grace period is its own countdown). */
  used: number;
}

/**
 * Where the sensor is now. `readingSinceStart` = a reading has come in since it was put on (so the
 * warm-up is over even if it finished early).
 */
export function sensorStatus(kind: SensorKind, startedAt: number, nowMs: number, readingSinceStart: boolean): SensorStatus {
  const spec = SENSOR_SPECS[kind];
  const endsAt = startedAt + spec.days * DAY;
  const stopsAt = endsAt + spec.graceHours * HOUR;
  const used = Math.min(1, Math.max(0, (nowMs - startedAt) / (endsAt - startedAt)));
  const warmEnd = startedAt + spec.warmupMin * 60_000;
  if (!readingSinceStart && nowMs < warmEnd && nowMs >= startedAt) {
    return { phase: "warmup", endsAt, stopsAt, msLeft: warmEnd - nowMs, used };
  }
  if (nowMs < endsAt - DAY) return { phase: "active", endsAt, stopsAt, msLeft: endsAt - nowMs, used };
  if (nowMs < endsAt) return { phase: "lastDay", endsAt, stopsAt, msLeft: endsAt - nowMs, used };
  if (nowMs < stopsAt) return { phase: "grace", endsAt, stopsAt, msLeft: stopsAt - nowMs, used: 1 };
  return { phase: "expired", endsAt, stopsAt, msLeft: 0, used: 1 };
}

/** "7d 23h", "5h", "45m" (for the small line under Dexcom). */
export function shortLeft(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** "7 days 23 hours", "5 hours", "45 minutes" (for the full card). */
export function longLeft(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d > 0) return h > 0 ? `${p(d, "day")} ${p(h, "hour")}` : p(d, "day");
  if (h > 0) return p(h, "hour");
  return p(Math.max(1, m), "minute");
}

/**
 * The night-before reminder: 8:00 PM local the evening before the day the sensor's days end, so
 * there's time to pack a spare. (12 hours before, in the odd case that's under 2 hours away from the
 * end.) Null if already past.
 * `tzOffsetMinutes` = minutes EAST of UTC (-Date#getTimezoneOffset()).
 */
export function reminderAt(endsAt: number, tzOffsetMinutes: number, nowMs: number): number | null {
  const local = new Date(endsAt + tzOffsetMinutes * 60_000);
  const dayBefore8pm = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1, 20, 0) - tzOffsetMinutes * 60_000;
  const at = endsAt - dayBefore8pm >= 2 * HOUR ? dayBefore8pm : endsAt - 12 * HOUR;
  return at > nowMs ? at : null;
}

/** "7:12 AM" on the clock of `tzOffsetMinutes` (the server has no local time of its own). */
export function clockAt(ms: number, tzOffsetMinutes: number): string {
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const GAP_MIN_MS = 20 * 60_000;
/** Only gaps this recent can be a new sensor worth asking about. */
export const GAP_LOOKBACK_MS = 6 * HOUR;

/**
 * The gap a sensor change leaves: readings stop, then start again 20+ minutes later. Asked about only
 * when it's likely a change (no countdown yet, or the sensor was within a day and a half of its end, or
 * past it) so a phone that briefly lost signal mid-sensor doesn't keep asking. Anyone can still tap
 * New sensor. Returns when readings stopped and started again, or null.
 */
export function newSensorGap(
  readingMs: number[],
  current: { kind: SensorKind; startedAt: number } | null,
  nowMs: number,
): { stoppedAt: number; resumedAt: number } | null {
  const ts = readingMs.filter((t) => Number.isFinite(t) && t <= nowMs + 60_000 && t >= nowMs - GAP_LOOKBACK_MS).sort((a, b) => a - b);
  for (let i = ts.length - 1; i > 0; i--) {
    const stoppedAt = ts[i - 1]!;
    const resumedAt = ts[i]!;
    if (resumedAt - stoppedAt < GAP_MIN_MS) continue;
    if (current) {
      if (resumedAt <= current.startedAt + HOUR) return null; // the gap belongs to the sensor already marked
      const s = SENSOR_SPECS[current.kind];
      const endsAt = current.startedAt + s.days * DAY;
      if (stoppedAt < endsAt - 36 * HOUR) return null; // mid-sensor: most likely signal loss
    }
    return { stoppedAt, resumedAt };
  }
  return null;
}

/** When a sensor found by its gap was most likely put on: its warm-up before readings resumed. */
export function startFromGap(kind: SensorKind, gap: { stoppedAt: number; resumedAt: number }): number {
  return Math.max(gap.stoppedAt, gap.resumedAt - SENSOR_SPECS[kind].warmupMin * 60_000);
}

/** The small line under "Dexcom" at the top of the Glucose screen, and how loud it should be. */
export function sensorBadge(status: SensorStatus | null): { text: string; tone: "muted" | "warn" | "danger" } | null {
  if (!status) return null;
  switch (status.phase) {
    case "warmup":
      return { text: `Warming up · ${shortLeft(status.msLeft)} left`, tone: "muted" };
    case "active":
      return { text: `Sensor · ${shortLeft(status.msLeft)} left`, tone: "muted" };
    case "lastDay":
      return { text: `Sensor ends in ${shortLeft(status.msLeft)}`, tone: "warn" };
    case "grace":
      return { text: `Grace period · ${shortLeft(status.msLeft)} left`, tone: "danger" };
    case "expired":
      return { text: "Sensor ended", tone: "danger" };
  }
}

/**
 * What a sensor's square barcode (GS1 DataMatrix) holds: product number (01), serial (21), made on
 * (11), expires (17), lot (10), and Dexcom's 4-digit pairing code (240). Scanners hand it over either
 * raw (fields split by the GS character, maybe a "]d2" prefix) or written out "(01)...(21)...".
 */
export interface SensorLabel {
  gtin?: string;
  serial?: string;
  lot?: string;
  madeOn?: string;
  expiresOn?: string;
  pairingCode?: string;
}

const FIXED_AI: Record<string, number> = { "01": 14, "11": 6, "17": 6 };
const VAR_AI = ["21", "10", "240"];

function gs1Date(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const dd = yymmdd.slice(4, 6) === "00" ? "01" : yymmdd.slice(4, 6);
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${dd}`;
}

export function parseSensorLabel(raw: string): SensorLabel | null {
  const out: SensorLabel = {};
  const put = (ai: string, v: string) => {
    const val = v.trim();
    if (!val) return;
    if (ai === "01" && /^\d{14}$/.test(val)) out.gtin = val;
    else if (ai === "21") out.serial = val.slice(0, 20);
    else if (ai === "10") out.lot = val.slice(0, 20);
    else if (ai === "11") out.madeOn = gs1Date(val);
    else if (ai === "17") out.expiresOn = gs1Date(val);
    else if (ai === "240") out.pairingCode = val.slice(0, 30);
  };
  const text = raw.trim();
  if (text.startsWith("(")) {
    for (const m of text.matchAll(/\((\d{2,4})\)([^(]*)/g)) put(m[1]!, m[2]!);
  } else {
    let s = text.replace(/^\][A-Za-z]\d/, "");
    while (s.length > 0) {
      if (s[0] === "\u001d") {
        s = s.slice(1);
        continue;
      }
      const two = s.slice(0, 2);
      const three = s.slice(0, 3);
      if (FIXED_AI[two]) {
        put(two, s.slice(2, 2 + FIXED_AI[two]!));
        s = s.slice(2 + FIXED_AI[two]!);
      } else if (VAR_AI.includes(three) || VAR_AI.includes(two)) {
        const ai = VAR_AI.includes(three) ? three : two;
        const rest = s.slice(ai.length);
        const end = rest.indexOf("\u001d");
        put(ai, end < 0 ? rest : rest.slice(0, end));
        s = end < 0 ? "" : rest.slice(end + 1);
      } else {
        break; // a field we don't know: stop rather than misread the rest
      }
    }
  }
  return out.gtin || out.serial ? out : null;
}

/** Product numbers we've confirmed from real sensors. Unknown ones: the app asks which sensor it is. */
export const SENSOR_GTINS: Record<string, SensorKind> = {
  "00386270003935": "g7", // Dexcom G7 (10 day), US applicator
};
