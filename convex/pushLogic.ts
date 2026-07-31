/**
 * Pure logic for backend-sent push notifications (see PREBUILD_PLAN_01 §2). Kept free of Convex so
 * the alert rules — which category a reading belongs to, whether a cooldown has elapsed, and the
 * exact copy — are unit-testable and live in one place.
 */

/**
 * The alert categories a user can independently toggle. High and Low are SPLIT (each with its own
 * sound); `riseFast`/`fallFast` are trend alerts. Legacy rows may still carry a `glucoseHighLow`
 * field — readers treat it as the default for both split values.
 */
export type PushCategory =
  | "glucoseUrgent"
  | "glucoseHigh"
  | "glucoseLow"
  | "riseFast"
  | "fallFast"
  | "careLog"
  | "messages"
  | "doctor";

export interface PushPrefs {
  glucoseUrgent: boolean;
  glucoseHigh: boolean;
  glucoseLow: boolean;
  riseFast: boolean;
  fallFast: boolean;
  careLog: boolean;
  messages: boolean;
  doctor: boolean;
}

/** New devices opt in to everything; users turn things off from the Alerts screen. */
export const DEFAULT_PUSH_PREFS: PushPrefs = {
  glucoseUrgent: true,
  glucoseHigh: true,
  glucoseLow: true,
  riseFast: true,
  fallFast: true,
  careLog: true,
  messages: true,
  doctor: true,
};

/**
 * Only `glucoseUrgent` may use iOS Critical Alerts. This mirrors exactly what we told Apple in the
 * entitlement request (2026-07-23): critical alerts are reserved for user-configured urgent glucose
 * thresholds, and everything else is a standard notification.
 */
export function isCriticalCategory(category: PushCategory): boolean {
  return category === "glucoseUrgent";
}

// ── glucose threshold classification ─────────────────────────────────────────────────────────

export type GlucoseAlertKind = "urgent_low" | "low" | "high" | "urgent_high";

export interface GlucoseThresholds {
  urgentLowThreshold?: number;
  lowThreshold?: number;
  highThreshold?: number;
  urgentHighThreshold?: number;
}

/** Fallbacks match the app's defaults so a profile with no saved thresholds still alerts sensibly. */
const DEFAULTS = { urgentLow: 55, low: 70, high: 180, urgentHigh: 250 };

/**
 * Which alert (if any) a reading triggers. Urgent bands win over their non-urgent counterparts, and
 * a reading inside the target range produces nothing.
 */
export function classifyGlucose(value: number, t: GlucoseThresholds): GlucoseAlertKind | null {
  const urgentLow = t.urgentLowThreshold ?? DEFAULTS.urgentLow;
  const low = t.lowThreshold ?? DEFAULTS.low;
  const high = t.highThreshold ?? DEFAULTS.high;
  const urgentHigh = t.urgentHighThreshold ?? DEFAULTS.urgentHigh;
  if (value <= urgentLow) return "urgent_low";
  if (value < low) return "low";
  if (value >= urgentHigh) return "urgent_high";
  if (value > high) return "high";
  return null;
}

/**
 * Which toggle a zone alert fires under. EXACTLY ONE category per reading — the bands are mutually
 * exclusive, so urgent-low never also fires the Low alert (it takes it over completely).
 * `urgent_high` deliberately routes to the HIGH category (its copy still says "very high"): only
 * urgent LOWS get the urgent category (and with it, the Critical Alerts eligibility).
 */
export function categoryForGlucose(kind: GlucoseAlertKind): PushCategory {
  if (kind === "urgent_low") return "glucoseUrgent";
  if (kind === "low") return "glucoseLow";
  return "glucoseHigh"; // high + urgent_high
}

// ── trend alerts (rising / falling fast) ─────────────────────────────────────────────────────

export type TrendAlertKind = "rise_fast" | "fall_fast";

/** Dexcom's "fast" band starts at 2 mg/dL/min (SingleUp/SingleDown); Double* is >3. */
export const TREND_FAST_MG_PER_MIN = 2;
/** Two readings further apart than this can't produce a trustworthy rate. */
export const TREND_MAX_GAP_MIN = 12;

/**
 * Trend alert for the newest reading. Prefers the sensor's own Dexcom trend arrow when the reading
 * carries one; otherwise computes mg/dL-per-minute from the previous reading. Null = no trend alert.
 */
export function classifyTrendAlert(params: {
  latest: { glucose: number; timestampMs: number };
  prev: { glucose: number; timestampMs: number } | null;
  dexcomTrend?: number | string | null;
}): TrendAlertKind | null {
  const t = params.dexcomTrend;
  if (t != null) {
    if (t === 1 || t === 2 || t === "DoubleUp" || t === "SingleUp") return "rise_fast";
    if (t === 6 || t === 7 || t === "SingleDown" || t === "DoubleDown") return "fall_fast";
    return null;
  }
  if (!params.prev) return null;
  const gapMin = (params.latest.timestampMs - params.prev.timestampMs) / 60_000;
  if (gapMin <= 0 || gapMin > TREND_MAX_GAP_MIN) return null;
  const rate = (params.latest.glucose - params.prev.glucose) / gapMin;
  if (rate >= TREND_FAST_MG_PER_MIN) return "rise_fast";
  if (rate <= -TREND_FAST_MG_PER_MIN) return "fall_fast";
  return null;
}

export function categoryForTrend(kind: TrendAlertKind): PushCategory {
  return kind === "rise_fast" ? "riseFast" : "fallFast";
}

export function trendCopy(params: { kind: TrendAlertKind; value: number; patientName: string }): PushMessageCopy {
  const { kind, value, patientName } = params;
  if (kind === "rise_fast") {
    return {
      title: `📈 ${patientName}'s glucose is rising fast`,
      body: `${value} mg/dL and climbing quickly — keep an eye on it.`,
    };
  }
  return {
    title: `📉 ${patientName}'s glucose is falling fast`,
    body: `${value} mg/dL and dropping quickly — check in soon.`,
  };
}

// ── copy ─────────────────────────────────────────────────────────────────────────────────────

export interface PushMessageCopy {
  title: string;
  body: string;
}

export function glucoseCopy(params: {
  kind: GlucoseAlertKind;
  value: number;
  patientName: string;
  trendLabel?: string;
}): PushMessageCopy {
  const { kind, value, patientName, trendLabel } = params;
  const trend = trendLabel && trendLabel.toLowerCase() !== "stable" ? ` and ${trendLabel.toLowerCase()}` : "";
  switch (kind) {
    case "urgent_low":
      return {
        title: `🚨 ${patientName}'s glucose is critically low`,
        body: `${value} mg/dL${trend} — needs fast-acting carbs now.`,
      };
    case "low":
      return {
        title: `⚠️ ${patientName}'s glucose is low`,
        body: `${value} mg/dL${trend} — check in and treat if needed.`,
      };
    case "urgent_high":
      return {
        title: `🚨 ${patientName}'s glucose is very high`,
        body: `${value} mg/dL${trend} — check ketones and follow your care plan.`,
      };
    case "high":
      return {
        title: `⚠️ ${patientName}'s glucose is high`,
        body: `${value} mg/dL${trend} — monitor and correct if appropriate.`,
      };
  }
}

export function careLogCopy(params: {
  authorName: string;
  patientName: string;
  kind: "food" | "insulin";
  units?: number;
  carbs?: number;
  foodName?: string;
}): PushMessageCopy {
  const { authorName, patientName, kind, units, carbs, foodName } = params;
  if (kind === "insulin") {
    return {
      title: `${authorName} logged insulin for ${patientName}`,
      body: `${units ?? 0}u just now — open the app to see the details.`,
    };
  }
  const what = foodName?.trim() ? foodName.trim() : "a meal";
  return {
    title: `${authorName} logged a meal for ${patientName}`,
    body: `${what}${carbs != null ? ` · ${carbs}g carbs` : ""} — open the app to see the details.`,
  };
}

export function messageCopy(params: { senderName: string; text: string }): PushMessageCopy {
  const preview = params.text.trim();
  return {
    title: `New message from ${params.senderName}`,
    body: preview.length > 140 ? `${preview.slice(0, 137)}…` : preview || "Tap to read.",
  };
}

// ── Expo push payload ────────────────────────────────────────────────────────────────────────

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts up to 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** "default" or a bundled sound filename (e.g. "chime.wav"); critical objects carry the same. */
  sound: string | { critical: true; name: string; volume: number };
  priority: "high" | "normal";
  channelId?: string;
  data?: Record<string, unknown>;
  interruptionLevel?: "active" | "critical" | "timeSensitive";
}

/**
 * Build the Expo payload. Urgent glucose asks for the critical sound + `critical` interruption level;
 * iOS only honors those once the Critical Alerts entitlement is granted, and silently downgrades to a
 * normal alert until then — so this is safe to ship before Apple approves.
 */
/** Per-device custom alert sounds by group; a missing entry means the system default sound.
 *  `glucose` is the legacy shared High&Low slot — readers fall back to it for the split slots. */
export interface AlertSoundPrefs {
  glucose?: string;
  glucoseHigh?: string;
  glucoseLow?: string;
  riseFast?: string;
  fallFast?: string;
  urgent?: string;
  messages?: string;
}

/** Which sound-pref slot a push category plays from (null = always the default sound). */
export function soundKeyForCategory(category: PushCategory): keyof AlertSoundPrefs | null {
  switch (category) {
    case "glucoseUrgent":
      return "urgent";
    case "glucoseHigh":
      return "glucoseHigh";
    case "glucoseLow":
      return "glucoseLow";
    case "riseFast":
      return "riseFast";
    case "fallFast":
      return "fallFast";
    case "messages":
    case "doctor":
      return "messages";
    default:
      return null;
  }
}

export function buildExpoMessage(params: {
  token: string;
  category: PushCategory;
  copy: PushMessageCopy;
  data?: Record<string, unknown>;
  /** Bundled sound filename chosen by THIS device (e.g. "chime.wav"); absent = default. */
  soundFile?: string;
}): ExpoPushMessage {
  const critical = isCriticalCategory(params.category);
  const soundName = params.soundFile ?? "default";
  return {
    to: params.token,
    title: params.copy.title,
    body: params.copy.body,
    sound: critical ? { critical: true, name: soundName, volume: 1 } : soundName,
    priority: "high",
    channelId: critical ? "glucose-urgent" : "default",
    interruptionLevel: critical ? "critical" : "active",
    data: { category: params.category, ...(params.data ?? {}) },
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
