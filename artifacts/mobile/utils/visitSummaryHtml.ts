/**
 * The Visit Summary as printable HTML (expo-print turns it into the PDF). Page 1 is the overview a
 * doctor reads in a minute; the food and insulin log starts on a new page. Pure string building so
 * it is unit-tested. Every family-entered string (names, foods) goes through `esc`.
 */
import {
  fmtDay,
  fmtRange,
  fmtTime,
  fmtWeekday,
  hourLabel,
  localDayKey,
  readingsBetween,
  type MealRow,
  type SummaryReading,
  type PatternPoint,
  type VisitSummaryData,
} from "./visitSummary";

export interface VisitSummaryMeta {
  patientName: string;
  ageYears?: number | null;
  diabetesType?: "type1" | "type2" | "other";
  doctorName?: string;
  doctorInstitution?: string;
  carbRatio: number;
  correctionFactor: number;
  targetGlucose: number;
  generatedAt: number;
}

/** Parts of the PDF the family can switch off. The glucose overview is always included. */
export type SectionKey = "pattern" | "eachDay" | "averages" | "settings" | "meals" | "insulin" | "lows" | "sticks";

export const SECTIONS: { key: SectionKey; title: string; hint: string }[] = [
  { key: "pattern", title: "Daily pattern", hint: "Glucose by time of day, and when lows happen" },
  { key: "eachDay", title: "Each day", hint: "A bar per day: low, in range, high" },
  { key: "averages", title: "Insulin and food averages", hint: "Insulin, carbs, and foods per day" },
  { key: "settings", title: "Insulin settings", hint: "Carb ratio, correction, target, and changes" },
  { key: "meals", title: "Food log", hint: "Each day's glucose graph with every meal" },
  { key: "insulin", title: "Insulin log", hint: "Every dose with the glucose at that time" },
  { key: "lows", title: "Lows", hint: "Each low: when, how low, how long" },
  { key: "sticks", title: "Finger sticks", hint: "Meter checks next to the Dexcom reading" },
];

export type SectionChoices = Record<SectionKey, boolean>;
export const ALL_SECTIONS_ON: SectionChoices = { pattern: true, eachDay: true, averages: true, settings: true, meals: true, insulin: true, lows: true, sticks: true };

export interface VisitSummaryOptions {
  /** Which sections to include (missing keys count as on). */
  sections?: Partial<SectionChoices>;
  /** Long reports (over 30 days) list foods by how often they were eaten unless this is on. */
  includeEveryMeal?: boolean;
  /**
   * The Doctor Portal box at the top of page 1. With a code: the family's one-time 24-hour pass
   * (shown until a doctor uses it). Without one: just the demo invitation.
   */
  portal?: { code?: string | null; url: string };
}

/** Above this many days the food page shows the food summary instead of every meal (unless asked). */
export const EVERY_MEAL_MAX_DAYS = 30;

export function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const C = {
  vlow: "#991B1B",
  low: "#FF5B57",
  ok: "#1FD18A",
  okText: "#0E9F6E",
  high: "#FF9F1C",
  highText: "#D97706",
  vhigh: "#C2410C",
  ink: "#0E1A2B",
  sub: "#4C5C72",
  mute: "#8190A4",
  line: "#e1e6ef",
  blue: "#1F5FD6",
};

function glucoseColor(g: number | null): string {
  if (g == null) return C.mute;
  if (g < 70) return C.low;
  if (g <= 180) return C.okText;
  if (g <= 250) return C.highText;
  return C.vhigh;
}

const typeLabel = (t?: string) => (t === "type1" ? "Type 1" : t === "type2" ? "Type 2" : t ? "Diabetes" : "");

// ─── Charts ────────────────────────────────────────────────────────────────────────────────────

export function patternSvg(pattern: PatternPoint[]): string {
  if (pattern.length === 0) return `<div class="empty">Not enough readings yet to show a daily pattern.</div>`;
  const W = 680, H = 200, x0 = 40, y0 = 8, pw = W - x0 - 8, ph = H - y0 - 26;
  const G0 = 40, G1 = 320;
  const X = (h: number) => x0 + (pw * h) / 24;
  const Y = (g: number) => y0 + ph * (1 - (Math.min(G1, Math.max(G0, g)) - G0) / (G1 - G0));
  // Hourly points sit on the half hour; close the loop so midnight joins up.
  const pts = pattern.map((p) => ({ ...p, x: p.hour + 0.5 }));
  const first = pts[0]!, last = pts[pts.length - 1]!;
  if (first.hour === 0 && last.hour === 23) {
    pts.unshift({ ...last, x: last.x - 24 });
    pts.push({ ...first, x: first.x + 24 });
  }
  const line = (k: keyof PatternPoint) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p[k] as number).toFixed(1)}`).join(" ");
  const band = (a: keyof PatternPoint, b: keyof PatternPoint) => {
    const top = pts.map((p) => `${X(p.x).toFixed(1)},${Y(p[a] as number).toFixed(1)}`);
    const bot = [...pts].reverse().map((p) => `${X(p.x).toFixed(1)},${Y(p[b] as number).toFixed(1)}`);
    return [...top, ...bot].join(" ");
  };
  const grid = [54, 70, 180, 250]
    .map((g) => `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="#d9e0ea"/><text x="${x0 - 6}" y="${(Y(g) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${C.mute}">${g}</text>`)
    .join("");
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24]
    .map((h) => `<text x="${X(h).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.mute}">${hourLabel(h).replace(":00", "").replace(" AM", "a").replace(" PM", "p")}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
<defs><clipPath id="pc"><rect x="${x0}" y="0" width="${pw}" height="${H}"/></clipPath></defs>
<rect x="${x0}" y="${Y(180).toFixed(1)}" width="${pw}" height="${(Y(70) - Y(180)).toFixed(1)}" fill="#e6f8ef"/>${grid}
<g clip-path="url(#pc)"><polygon points="${band("p95", "p5")}" fill="#cfe0ff" opacity=".75"/><polygon points="${band("p75", "p25")}" fill="#86adff" opacity=".8"/>
<polyline points="${line("p50")}" fill="none" stroke="${C.blue}" stroke-width="2.5" stroke-linejoin="round"/></g>${ticks}</svg>
<div class="leg"><span><i style="background:${C.blue}"></i>Typical (median)</span><span><i style="background:#86adff"></i>Middle half of readings</span><span><i style="background:#cfe0ff"></i>Most readings (5th to 95th percentile)</span><span><i style="background:#e6f8ef"></i>Target 70 to 180</span></div>`;
}

export function dailyBarsSvg(data: VisitSummaryData): string {
  const days = data.perDay;
  const W = 680, H = 128, top = 6, barH = 96;
  const step = W / days.length;
  const bw = Math.max(2, Math.min(30, step * 0.68));
  const every = days.length <= 16 ? 1 : days.length <= 31 ? 3 : 10;
  let out = "";
  days.forEach((d, i) => {
    const x = i * step + (step - bw) / 2;
    if (d.inRange == null) {
      out += `<rect x="${x.toFixed(1)}" y="${top}" width="${bw.toFixed(1)}" height="${barH}" fill="#f1f4f9" rx="2"/>`;
    } else {
      let y = top;
      for (const [v, col] of [[d.high ?? 0, C.high], [d.inRange ?? 0, C.ok], [d.low ?? 0, C.low]] as const) {
        const h = (v / 100) * barH;
        if (h > 0) out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>`;
        y += h;
      }
    }
    if (i % every === 0 || i === days.length - 1) {
      const label = i === 0 || new Date(d.dayStart).getDate() === 1 ? fmtDay(d.dayStart) : String(new Date(d.dayStart).getDate());
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${top + barH + 16}" text-anchor="middle" font-size="9.5" fill="${C.mute}">${label}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${out}</svg>
<div class="leg"><span><i style="background:${C.high}"></i>Over 180</span><span><i style="background:${C.ok}"></i>70 to 180</span><span><i style="background:${C.low}"></i>Under 70</span><span><i style="background:#f1f4f9"></i>No sensor data</span></div>`;
}


/** Polyline points for readings, breaking the line where the sensor had a gap over 20 minutes. */
function linePaths(rows: SummaryReading[], X: (ms: number) => number, Y: (g: number) => number): string[] {
  const paths: string[] = [];
  let cur: string[] = [];
  let last = -Infinity;
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (t - last > 20 * 60_000 && cur.length) {
      paths.push(cur.join(" "));
      cur = [];
    }
    cur.push(`${X(t).toFixed(1)},${Y(r.glucose).toFixed(1)}`);
    last = t;
  }
  if (cur.length) paths.push(cur.join(" "));
  return paths;
}

/** One day's glucose with each meal numbered, so the rows below can point at it. */
export function dayStripSvg(dayStart: number, readings: SummaryReading[], meals: MealRow[]): string {
  const next = new Date(dayStart);
  next.setDate(next.getDate() + 1);
  const end = next.getTime();
  const rows = readingsBetween(readings, dayStart, end);
  const W = 680, H = 118, x0 = 30, y0 = 14, pw = W - x0 - 4, ph = H - y0 - 18, G0 = 40, G1 = 320;
  const X = (ms: number) => x0 + ((ms - dayStart) / (end - dayStart)) * pw;
  const Y = (g: number) => y0 + ph * (1 - (Math.min(G1, Math.max(G0, g)) - G0) / (G1 - G0));
  const grid = [70, 180, 250]
    .map((g) => `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="#e3e8f0"/><text x="${x0 - 4}" y="${(Y(g) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${C.mute}">${g}</text>`)
    .join("");
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21]
    .map((h) => `<text x="${X(dayStart + h * 3600_000).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8.5" fill="${C.mute}">${hourLabel(h).replace(" AM", "a").replace(" PM", "p")}</text>`)
    .join("");
  const ordered = [...meals].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const marks = ordered
    .map((m, i) => {
      const x = X(Date.parse(m.timestamp)).toFixed(1);
      return `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + ph}" stroke="#9aa6b8" stroke-dasharray="2 2"/><circle cx="${x}" cy="${y0 - 6}" r="6" fill="${C.blue}"/><text x="${x}" y="${y0 - 3}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${i + 1}</text>`;
    })
    .join("");
  const lines = linePaths(rows, X, Y)
    .map((pts) => `<polyline points="${pts}" fill="none" stroke="${C.blue}" stroke-width="1.8" stroke-linejoin="round"/>`)
    .join("");
  const lowDots = rows.filter((r) => r.glucose < 70).map((r) => `<circle cx="${X(Date.parse(r.timestamp)).toFixed(1)}" cy="${Y(r.glucose).toFixed(1)}" r="1.8" fill="${C.low}"/>`).join("");
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg"><rect x="${x0}" y="${Y(180).toFixed(1)}" width="${pw}" height="${(Y(70) - Y(180)).toFixed(1)}" fill="#e6f8ef"/>${grid}${marks}${lines}${lowDots}${ticks}${rows.length < 3 ? `<text x="${x0 + pw / 2}" y="${y0 + ph / 2}" text-anchor="middle" font-size="10" fill="${C.mute}">No sensor data this day</text>` : ""}</svg>`;
}

// ─── Sections ──────────────────────────────────────────────────────────────────────────────────

function tirBar(data: VisitSummaryData): string {
  const s = data.stats;
  if (!s) return `<div class="empty">No glucose readings in this range.</div>`;
  const segs: [number, string, string][] = [
    [s.pct.veryHigh, C.vhigh, "Very high"],
    [s.pct.high, C.high, "High"],
    [s.pct.inRange, C.ok, "In range"],
    [s.pct.low, C.low, "Low"],
    [s.pct.veryLow, C.vlow, "Very low"],
  ];
  const bar = segs
    .filter(([v]) => v > 0)
    .map(([v, col]) => `<div style="width:${v}%;background:${col}">${v >= 8 ? `${Math.round(v)}%` : ""}</div>`)
    .join("");
  const leg = segs
    .filter(([v, , label]) => v > 0 || label === "In range" || label === "Low")
    .map(([v, col, label]) => `<span><i style="background:${col}"></i>${label} ${v < 1 && v > 0 ? "&lt;1" : Math.round(v)}%</span>`)
    .join("");
  return `<div class="tir">${bar}</div><div class="leg">${leg}</div>
<div class="tiny">Very high over 250 · High 181 to 250 · In range 70 to 180 · Low 54 to 69 · Very low under 54 (mg/dL)</div>`;
}

const dash = `<span class="na">·</span>`;

function closestGlucose(readings: SummaryReading[], ts: string, withinMin: number): number | null {
  const t = Date.parse(ts);
  const near = readingsBetween(readings, t - withinMin * 60_000, t + withinMin * 60_000);
  if (!near.length) return null;
  return near.reduce((m, r) => (Math.abs(Date.parse(r.timestamp) - t) < Math.abs(Date.parse(m.timestamp) - t) ? r : m), near[0]!).glucose;
}

function groupByDay<T extends { timestamp: string }>(rows: T[]): T[][] {
  const byDay = new Map<string, T[]>();
  for (const r of rows) {
    const k = localDayKey(Date.parse(r.timestamp));
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  return [...byDay.values()];
}

function mealTable(rows: MealRow[], readings: SummaryReading[]): string {
  let body = "";
  for (const day of groupByDay(rows)) {
    const carbs = Math.round(day.reduce((s, r) => s + r.carbs, 0));
    const ins = Math.round(day.reduce((s, r) => s + r.insulin, 0) * 10) / 10;
    body += `<tr class="day"><td colspan="6">${esc(fmtWeekday(day[0]!.timestamp))}</td><td class="r">${carbs} g · ${ins} u</td></tr>`;
    const ordered = [...day].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const d = new Date(day[0]!.timestamp);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    body += `<tr class="striprow"><td colspan="7">${dayStripSvg(dayStart, readings, ordered)}</td></tr>`;
    ordered.forEach((r, i) => {
      const cam = r.fromPhoto ? ` <span class="cam">(photo)</span>` : "";
      const change = r.change == null ? dash : `${r.change >= 0 ? "+" : ""}${r.change}`;
      body += `<tr><td class="t"><span class="num">${i + 1}</span>${fmtTime(r.timestamp)}</td><td class="f">${esc(r.foodName)}${cam}</td><td class="r">${Math.round(r.carbs)} g</td><td class="r">${r.insulin ? `${Math.round(r.insulin * 10) / 10} u` : "0 u"}</td>`;
      body += `<td class="r" style="color:${glucoseColor(r.before)}">${r.before ?? dash}</td><td class="r b" style="color:${glucoseColor(r.after)}">${r.after ?? dash}</td><td class="r b">${change}</td></tr>`;
    });
  }
  return `<table class="log"><thead><tr><th>Time</th><th>Food</th><th class="r">Carbs</th><th class="r">Insulin</th><th class="r">Before</th><th class="r">2 hr after</th><th class="r">Change</th></tr></thead><tbody>${body}</tbody></table>`;
}

function foodSummaryTable(data: VisitSummaryData): string {
  if (data.groups.length === 0) return `<div class="empty">No food was logged more than once in this range.</div>`;
  const rows = data.groups
    .map((g) => `<tr><td class="f">${esc(g.name)}</td><td class="r">${g.times}</td><td class="r">${g.avgCarbs} g</td><td class="r b">${g.avgChange == null ? dash : `${g.avgChange >= 0 ? "+" : ""}${g.avgChange}`}</td></tr>`)
    .join("");
  return `<table class="log"><thead><tr><th>Food</th><th class="r">Times eaten</th><th class="r">Average carbs</th><th class="r">Average change 2 hr after</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const DOSE_TYPE: Record<string, string> = { bolus: "Rapid", correction: "Correction", manual: "Logged by hand", basal: "Long-acting" };

function insulinTable(data: VisitSummaryData): string {
  if (data.insulinRows.length === 0) return `<div class="empty">No insulin was logged in this range.</div>`;
  let body = "";
  for (const day of groupByDay(data.insulinRows)) {
    const total = Math.round(day.reduce((s, e) => s + e.units, 0) * 10) / 10;
    body += `<tr class="day"><td colspan="5">${esc(fmtWeekday(day[0]!.timestamp))}</td><td class="r">${total} u</td></tr>`;
    for (const e of day) {
      const g = closestGlucose(data.readings, e.timestamp, 10);
      const name = e.insulinType ? e.insulinType.split("·")[0]!.trim() : "";
      body += `<tr><td class="t">${fmtTime(e.timestamp)}</td><td class="r b">${Math.round(e.units * 100) / 100} u</td><td>${esc(DOSE_TYPE[e.type] ?? e.type)}</td><td>${esc(name) || dash}</td><td class="r" style="color:${glucoseColor(g)}">${g ?? dash}</td><td class="f">${e.note ? esc(e.note) : ""}</td></tr>`;
    }
  }
  return `<table class="log"><thead><tr><th>Time</th><th class="r">Dose</th><th>Type</th><th>Insulin</th><th class="r">Glucose then</th><th>Note</th></tr></thead><tbody>${body}</tbody></table>`;
}

function lowsTable(data: VisitSummaryData): string {
  if (data.lows.length === 0) return `<div class="empty">No lows (under 70) in this range.</div>`;
  const rows = [...data.lows]
    .reverse()
    .map((l) => {
      const mins = Math.round((Date.parse(l.end) - Date.parse(l.start)) / 60_000) + 5;
      const when = new Date(l.start).getHours() < 6 ? "Overnight" : "";
      return `<tr><td>${esc(fmtWeekday(l.start))}</td><td class="t">${fmtTime(l.start)}</td><td class="r b" style="color:${l.nadir < 54 ? C.vlow : C.low}">${l.nadir}</td><td class="t">${fmtTime(l.nadirAt)}</td><td class="r">about ${mins} min</td><td>${when}</td></tr>`;
    })
    .join("");
  return `<table class="log"><thead><tr><th>Day</th><th>Started</th><th class="r">Lowest</th><th>At</th><th class="r">Lasted</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STICK_REASON: Record<string, string> = {
  seemed_off: "Dexcom seemed off",
  symptoms: "Had symptoms",
  before_dosing: "Before dosing",
  new_sensor: "New sensor",
  routine: "Routine check",
};

function sticksTable(data: VisitSummaryData): string {
  if (data.stickRows.length === 0) return `<div class="empty">No finger sticks were logged in this range.</div>`;
  const rows = data.stickRows
    .map((f) => {
      const diff = f.cgmGlucose != null ? f.cgmGlucose - f.glucose : null;
      const note = [f.reason ? STICK_REASON[f.reason] ?? f.reason : "", f.note ?? ""].filter(Boolean).join(" · ");
      return `<tr><td>${esc(fmtWeekday(f.timestamp))}</td><td class="t">${fmtTime(f.timestamp)}</td><td class="r b" style="color:${glucoseColor(f.glucose)}">${f.glucose}</td><td class="r">${f.cgmGlucose ?? dash}</td><td class="r">${diff == null ? dash : `${diff >= 0 ? "+" : ""}${diff}`}</td><td class="f">${esc(note)}</td></tr>`;
    })
    .join("");
  const avg = data.sticks.avgDiff != null ? `<div class="tiny">On average the Dexcom was ${data.sticks.avgDiff} mg/dL off from the meter.</div>` : "";
  return `<table class="log"><thead><tr><th>Day</th><th>Time</th><th class="r">Meter</th><th class="r">Dexcom</th><th class="r">Dexcom minus meter</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>${avg}`;
}

function portalBox(meta: VisitSummaryMeta, portal?: VisitSummaryOptions["portal"]): string {
  if (!portal) return "";
  const host = esc(portal.url.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  const first = esc(meta.patientName.split(/\s+/)[0] || meta.patientName);
  return portal.code
    ? `<div class="portal"><div class="pl"><b>See ${first}'s live data in the Glucose Guardian Doctor Portal</b><span>Go to <u>${host}</u>, choose <b>Use a patient code</b>, and enter the code. It opens ${first}'s glucose, meals, and insulin, view only, for 24 hours. No account needed.</span><span class="pd">Just looking? Choose <b>Try the demo</b> on the same page.</span></div><div class="pc"><small>ONE-TIME CODE</small><b>${esc(portal.code)}</b><small>Works for 24 hours from first use</small></div></div>`
    : `<div class="portal"><div class="pl"><b>Follow patients like ${first} live in the Glucose Guardian Doctor Portal</b><span>Glucose, meals, insulin, and messages with the family in one place. See it at <u>${host}</u> and choose <b>Try the demo</b>.</span></div></div>`;
}

// ─── Document ──────────────────────────────────────────────────────────────────────────────────

export function visitSummaryFileName(meta: Pick<VisitSummaryMeta, "patientName" | "generatedAt">): string {
  const d = new Date(meta.generatedAt);
  const name = meta.patientName.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "Patient";
  return `${name}_Visit_Summary_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.pdf`;
}

export function buildVisitSummaryHtml(data: VisitSummaryData, meta: VisitSummaryMeta, opts: VisitSummaryOptions = {}): string {
  const on = { ...ALL_SECTIONS_ON, ...(opts.sections ?? {}) };
  const s = data.stats;
  const range = fmtRange(data.startMs, data.endMs);
  const who = [`${data.days} days`, typeLabel(meta.diabetesType), meta.ageYears != null ? `Age ${meta.ageYears}` : ""].filter(Boolean).join(" · ");
  const prepared = meta.doctorName
    ? `Prepared for ${esc(meta.doctorName)}${meta.doctorInstitution ? `<br>${esc(meta.doctorInstitution)}` : ""}`
    : "";
  const findings = [data.lowPattern, data.peak].filter(Boolean) as string[];
  const lowsLine = data.lows.length
    ? `${data.lows.length} low${data.lows.length === 1 ? "" : "s"} (under 70), lowest ${Math.min(...data.lows.map((l) => l.nadir))} mg/dL.`
    : "No lows (under 70) in this range.";
  const care = data.care;
  const careRows = [
    ["Total insulin", care.totalInsulin != null ? `${care.totalInsulin} units` : "Not logged"],
    ...(care.bolusPerDay != null ? [["Rapid-acting doses", `${care.bolusPerDay} units in ${care.bolusDosesPerDay} doses`]] : []),
    ...(care.basalPerDay != null ? [["Long-acting (basal)", `${care.basalPerDay} units`]] : []),
    ["Carbs logged", care.carbsPerDay != null ? `${care.carbsPerDay} g` : "Not logged"],
    ["Foods logged", care.foodsPerDay != null ? `${care.foodsPerDay} per day` : "Not logged"],
  ];
  const careNote =
    care.insulinDays || care.foodDays
      ? `<div class="tiny">Averages are per day that had logs (insulin: ${care.insulinDays} of ${data.days} days, food: ${care.foodDays} of ${data.days} days).</div>`
      : "";
  const settingsRows = [
    ["Carb ratio", `1:${meta.carbRatio} g`],
    ["Correction factor", `1:${meta.correctionFactor} mg/dL`],
    ["Target", `${meta.targetGlucose} mg/dL`],
    ...data.changes.map((c) => [`${fmtDay(c.timestamp)} · ${c.what.toLowerCase()} ${c.from} → ${c.to}`, `by ${c.by}`]),
  ];
  const table = (rows: string[][]) => `<table class="kv">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>`;
  const averagesHtml = `<div><h3>Insulin and food (daily average)</h3>${table(careRows)}${careNote}</div>`;
  const settingsHtml = `<div><h3>Current settings${data.changes.length ? " and changes" : ""}</h3>${table(settingsRows)}</div>`;
  const twoCol =
    on.averages && on.settings
      ? `<div class="two">${averagesHtml}${settingsHtml}</div>`
      : on.averages
        ? averagesHtml
        : on.settings
          ? settingsHtml
          : "";

  // ── Logs pages ──
  const everyMeal = data.days <= EVERY_MEAL_MAX_DAYS || !!opts.includeEveryMeal;
  const oldestMeal = data.meals.length ? data.meals[data.meals.length - 1]!.timestamp : null;
  const coverage =
    oldestMeal && Date.parse(oldestMeal) > data.startMs + 2 * 86_400_000 && data.meals.length >= 150
      ? `<div class="tiny">The app keeps the most recent 200 meals, so food data here starts ${esc(fmtDay(oldestMeal))}.</div>`
      : "";
  const rises = data.rises.length
    ? `<div class="tops">${data.rises
        .map((r) => `<div><b>${esc(r.foodName)}</b><span>${esc(fmtDay(r.timestamp))} · ${Math.round(r.carbs)} g · ${r.before} → ${r.after}</span><em>+${r.change}</em></div>`)
        .join("")}</div>`
    : `<div class="empty">Not enough glucose readings around meals to compare.</div>`;
  const mealsHtml =
    data.meals.length === 0
      ? `<h3>Food log</h3><div class="empty">No food was logged in this range.</div>`
      : `<h3>Biggest rises after meals</h3>${rises}
<div class="sumrow"><span>Per day: <b>${care.carbsPerDay ?? 0} g carbs</b> · <b>${care.foodsPerDay ?? 0} foods logged</b></span>${data.over180 != null ? `<span>Meals over 180 two hours later: <b>${data.over180}%</b></span>` : ""}</div>
${everyMeal
  ? `<h3>Every meal, newest first (${data.meals.length})</h3>${mealTable(data.meals, data.readings)}
<div class="tiny">Each day's graph shows that day's glucose; numbered markers match the numbered meals under it, and the green band is 70 to 180. Before = reading just before eating. 2 hr after = reading closest to 2 hours later. A dot means there was no reading at that time.</div>`
  : `<h3>Foods eaten most often</h3>${foodSummaryTable(data)}<div class="tiny">${data.meals.length} meals were logged. This long report lists foods by how often they were eaten. Turn on "Include every meal" to list each one.</div>`}
${coverage}`;
  const logParts = [
    on.meals ? mealsHtml : "",
    on.insulin ? `<h3>Insulin log (${data.insulinRows.length} doses)</h3>${insulinTable(data)}` : "",
    on.lows ? `<h3>Lows (${data.lows.length})</h3>${lowsTable(data)}` : "",
    on.sticks ? `<h3>Finger sticks (${data.stickRows.length})</h3>${sticksTable(data)}` : "",
  ].filter(Boolean);
  const logTitle = on.meals && on.insulin ? "Food and Insulin Log" : on.meals ? "Food Log" : on.insulin ? "Insulin Log" : "Logs";
  const logsPage = logParts.length
    ? `<div class="page">
<div class="top"><div><h2>${logTitle}</h2><div class="sub">${esc(meta.patientName)} · ${esc(range)}</div></div><div class="brand"><b>GLUCOSE GUARDIAN</b>${prepared}</div></div>
${logParts.join("\n")}
<div class="ft"><span>Carbs, insulin, and finger sticks are what the family logged in Glucose Guardian. Glucose from Dexcom.</span><span>Estimates only. Does not replace medical advice.</span></div>
</div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(meta.patientName)} Visit Summary</title><style>
@page{size:letter;margin:0.45in}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:${C.ink};font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:10px;border-bottom:3px solid ${C.blue};border-image:linear-gradient(90deg,#14C8F0,#2F86FF,#3A5BFF) 1}
h1{margin:0;font-size:22px;letter-spacing:-.01em}h2{margin:0;font-size:18px}
.sub{color:${C.sub};font-size:12.5px;margin-top:3px}
.brand{text-align:right;font-size:10.5px;color:${C.sub};line-height:1.4}.brand b{display:block;font-size:12px;letter-spacing:.12em;color:${C.blue}}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 2px;font-size:10.5px;color:${C.sub}}.meta b{display:block;color:${C.ink};font-size:12.5px}
h3{margin:14px 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:${C.blue};break-after:avoid;page-break-after:avoid}
.kpis{display:grid;grid-template-columns:2.4fr 1fr 1fr 1fr;gap:8px}
.k{border:1px solid ${C.line};border-radius:9px;padding:9px 11px;break-inside:avoid}.k b{font-size:20px;display:block}.k span{font-size:10.5px;color:${C.sub}}
.tir{display:flex;height:18px;border-radius:5px;overflow:hidden;margin:5px 0}.tir div{display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:#fff}
.leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:9.5px;color:${C.sub};margin-top:3px}.leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0}
.tiny{font-size:9.5px;color:${C.mute};margin-top:4px;line-height:1.4}
.flag{background:#FFF1F0;border-left:3px solid ${C.low};padding:7px 10px;font-size:11.5px;border-radius:4px;margin-top:8px;line-height:1.45}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
table{width:100%;border-collapse:collapse}
.kv td{padding:4px 0;border-bottom:1px solid #eef1f6;font-size:11.5px}.kv td:last-child{text-align:right;font-weight:600}
.empty{color:${C.mute};font-style:italic;padding:8px 0}
.page{break-before:page;page-break-before:always}
.tops{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tops div{border:1px solid ${C.line};border-radius:9px;padding:9px 11px;position:relative}
.tops b{display:block;font-size:12px;padding-right:44px}.tops span{font-size:10.5px;color:${C.sub}}.tops em{position:absolute;right:10px;top:9px;font-style:normal;font-weight:800;color:${C.vhigh};font-size:14px}
.sumrow{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:${C.sub};margin-top:8px;padding:7px 10px;background:#F6F8FC;border-radius:7px}.sumrow b{color:${C.ink}}
table.log th{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:${C.sub};text-align:left;padding:5px 4px 5px 0;border-bottom:2px solid ${C.line}}
table.log td{font-size:11px;padding:4px 6px 4px 0;border-bottom:1px solid #eef1f6;vertical-align:middle}
table.log tr{break-inside:avoid;page-break-inside:avoid}table.log thead{display:table-header-group}
table.log tr.day td{background:#EEF3FF;font-weight:700;color:${C.blue};padding:4px 6px;border:none}
.r{text-align:right!important}.b{font-weight:700}.t{white-space:nowrap;width:74px}.f{word-break:break-word}
.na{color:#c3cad6}.cam{font-size:9px;color:${C.mute}}
.striprow td{padding:2px 0 4px!important;border:none!important}.num{display:inline-block;width:15px;height:15px;border-radius:50%;background:#1F5FD6;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:15px;margin-right:5px}
.portal{display:flex;gap:14px;align-items:center;margin:12px 0 2px;padding:11px 14px;border-radius:10px;background:#EEF4FF;border:1.5px solid #2F80FF}
.portal .pl{flex:1}.portal .pl>b{display:block;font-size:12.5px;color:${C.ink};margin-bottom:3px}.portal .pl span b{color:${C.ink}}.portal .pl span{display:block;font-size:10.5px;color:${C.sub};line-height:1.45}.portal .pd{margin-top:3px}
.portal .pc{text-align:center;padding:8px 12px;border-radius:8px;background:#fff;border:1px dashed #2F80FF;min-width:150px}.portal .pc small{display:block;font-size:8.5px;letter-spacing:.08em;color:${C.sub}}.portal .pc b{display:block;font-size:19px;letter-spacing:.06em;color:${C.blue};font-family:Menlo,Consolas,monospace;margin:3px 0}
.ft{margin-top:14px;font-size:9.5px;color:${C.mute};border-top:1px solid ${C.line};padding-top:6px;display:flex;justify-content:space-between;gap:12px}
</style></head><body>
<div class="top"><div><h1>${esc(meta.patientName)} · Visit Summary</h1><div class="sub">${esc(range)} · ${esc(who)}</div></div>
<div class="brand"><b>GLUCOSE GUARDIAN</b>${prepared}</div></div>
<div class="meta"><div>CGM<b>Dexcom</b></div><div>Sensor wear<b>${data.sensorWear}%</b></div><div>Readings<b>${(s?.count ?? 0).toLocaleString("en-US")}</b></div><div>Finger sticks vs CGM<b>${data.sticks.checks ? `${data.sticks.checks} check${data.sticks.checks === 1 ? "" : "s"}${data.sticks.avgDiff != null ? ` · avg ${data.sticks.avgDiff} off` : ""}` : "None logged"}</b></div></div>

${portalBox(meta, opts.portal)}
<h3>Glucose at a glance</h3>
<div class="kpis">
 <div class="k"><span>Time in range</span>${tirBar(data)}</div>
 <div class="k"><b>${s ? `${s.gmi}%` : "·"}</b><span>Estimated A1C (GMI)</span></div>
 <div class="k"><b>${s ? s.mean : "·"}</b><span>Average mg/dL</span></div>
 <div class="k"><b>${s ? `${s.cv}%` : "·"}</b><span>Variability (CV)${s ? (s.cv <= 36 ? ", stable" : ", swings a lot") : ""}</span></div>
</div>
${on.pattern ? `
<h3>Daily pattern by time of day</h3>
${patternSvg(data.pattern)}
<div class="flag"><b>Lows:</b> ${esc(lowsLine)}${findings.length ? ` ${findings.map(esc).join(" ")}` : ""}</div>` : ""}
${twoCol}
${on.eachDay ? `
<h3>Each day</h3>
${dailyBarsSvg(data)}` : ""}

<div class="ft"><span>Generated ${esc(fmtDay(meta.generatedAt))}, ${new Date(meta.generatedAt).getFullYear()} at ${esc(fmtTime(meta.generatedAt))} by Glucose Guardian from Dexcom data and family logs.</span><span>Estimates only. Does not replace medical advice.</span></div>
${logsPage}
</body></html>`;
}
