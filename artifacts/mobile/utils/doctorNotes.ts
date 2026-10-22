/**
 * Quick notes to the doctor: a starter message the family can edit, plus the matching numbers pulled
 * from the app. Pure so it is unit-tested; the screen is components/DoctorOfficePanel.tsx.
 * Plain words, no em dashes: this text goes out under the family's own name.
 */
import {
  DAY_MS,
  fmtDay,
  fmtRange,
  fmtTime,
  fmtWeekday,
  glucoseStats,
  inWindow,
  isOvernight,
  lowEpisodes,
  lowWindow,
  mealRows,
  type SummaryFood,
  type SummaryInsulin,
  type SummaryReading,
} from "./visitSummary";

export type NoteKind = "lows" | "refill" | "ratio" | "sick" | "custom";

export const NOTE_KINDS: { kind: NoteKind; title: string; icon: string; tint: string }[] = [
  { kind: "lows", title: "Lows overnight", icon: "moon", tint: "#FF5B57" },
  { kind: "refill", title: "Refill needed", icon: "package", tint: "#2F80FF" },
  { kind: "ratio", title: "Question about insulin settings", icon: "sliders", tint: "#FF9F1C" },
  { kind: "sick", title: "Sick day", icon: "thermometer", tint: "#1FD18A" },
  { kind: "custom", title: "Write my own", icon: "edit-3", tint: "#93A4BD" },
];

export interface NoteContext {
  patientName: string;
  doctorName?: string;
  now: number;
  /** At least the last 7 days. */
  readings: SummaryReading[];
  food: SummaryFood[];
  insulin: SummaryInsulin[];
  carbRatio: number;
  correctionFactor: number;
  targetGlucose: number;
  insulinTypes?: string[];
}

export interface NoteDetail {
  label: string;
  value: string;
  /** Color hint for the value on screen. */
  tone?: "low" | "high";
}

export interface DoctorNote {
  kind: NoteKind;
  title: string;
  subject: string;
  message: string;
  detailsTitle: string;
  details: NoteDetail[];
}

/** "Hi Dr. Mitchell," for "Dr. Sarah Mitchell"; "Hello," when it's a practice name or blank. */
export function greeting(doctorName?: string): string {
  const name = (doctorName ?? "").trim();
  const m = /^dr\.?\s+(.+)$/i.exec(name);
  if (!m) return "Hello,";
  const parts = m[1]!.trim().split(/\s+/);
  return `Hi Dr. ${parts[parts.length - 1]},`;
}

const settingsLine = (c: NoteContext): NoteDetail => ({
  label: "Carb ratio · Correction · Target",
  value: `1:${c.carbRatio} · 1:${c.correctionFactor} · ${c.targetGlucose}`,
});

/** "Humalog · 100 u/mL" → "Humalog". */
const insulinName = (label: string) => label.split("·")[0]!.trim();

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function buildNote(kind: NoteKind, c: NoteContext): DoctorNote {
  const hi = greeting(c.doctorName);
  const name = c.patientName.trim() || "my child";
  const title = NOTE_KINDS.find((k) => k.kind === kind)!.title;
  const week = <T extends { timestamp: string }>(rows: T[], days = 7) => rows.filter((r) => inWindow(r.timestamp, c.now - days * DAY_MS, c.now + 1));

  if (kind === "lows") {
    const lows = lowEpisodes(week(c.readings)).filter((e) => isOvernight(e.start));
    const where = lowWindow(lows);
    const bedtime = week(c.readings).filter((r) => {
      const h = new Date(r.timestamp).getHours();
      return h >= 20 && h < 22;
    });
    const bedAvg = bedtime.length ? Math.round(bedtime.reduce((s, r) => s + r.glucose, 0) / bedtime.length) : null;
    const message =
      lows.length > 0
        ? `${hi} ${name} has had ${lows.length} low${lows.length === 1 ? "" : "s"} overnight in the last 7 nights${where ? `, mostly ${where}` : ""}. Should we change anything? The numbers are below.`
        : `${hi} I have a question about ${name}'s overnight numbers. There were no lows overnight in the last 7 nights, but `;
    return {
      kind,
      title,
      subject: `${name}: lows overnight`,
      message,
      detailsTitle: "From the app · last 7 nights",
      details: [
        ...[...lows].reverse().map((e) => ({ label: `${fmtWeekday(e.nadirAt)}, ${fmtTime(e.nadirAt)}`, value: `${e.nadir}`, tone: "low" as const })),
        ...(lows.length === 0 ? [{ label: "Overnight lows", value: "None" }] : []),
        ...(bedAvg != null ? [{ label: "Bedtime average (8 to 10 PM)", value: `${bedAvg} mg/dL` }] : []),
        settingsLine(c),
      ],
    };
  }

  if (kind === "refill") {
    const types = (c.insulinTypes ?? []).map(insulinName).filter(Boolean);
    const items = [...(types.length ? types : ["insulin"]), "pen needles", "Dexcom sensors"];
    const last14 = week(c.insulin, 14);
    const days = new Set(last14.map((e) => new Date(e.timestamp).toDateString())).size;
    const perDay = days ? Math.round((last14.reduce((s, e) => s + e.units, 0) / days) * 10) / 10 : null;
    return {
      kind,
      title,
      subject: `${name}: refill request`,
      message: `${hi} could we please get a refill for ${name}? We need ${joinList(items)}. Thank you!`,
      detailsTitle: "From the app · last 14 days",
      details: [
        ...(types.length ? [{ label: "Insulin", value: types.join(", ") }] : []),
        ...(perDay != null ? [{ label: "Insulin used", value: `${perDay} units per day` }] : []),
      ],
    };
  }

  if (kind === "ratio") {
    const meals = mealRows(week(c.food), c.readings).filter((m) => m.after != null);
    const over = meals.filter((m) => (m.after ?? 0) > 180).length;
    const message =
      meals.length > 0
        ? `${hi} I have a question about ${name}'s insulin settings. In the last 7 days, ${over} of ${meals.length} meals were over 180 two hours after eating. Should we change the carb ratio? The numbers are below.`
        : `${hi} I have a question about ${name}'s insulin settings. `;
    return {
      kind,
      title,
      subject: `${name}: question about insulin settings`,
      message,
      detailsTitle: "From the app · last 7 days",
      details: [
        settingsLine(c),
        ...meals.slice(0, 6).map((m) => ({
          label: `${fmtWeekday(m.timestamp)} · ${m.foodName} · ${Math.round(m.carbs)} g`,
          value: `${m.before ?? "?"} → ${m.after}`,
          tone: (m.after ?? 0) > 180 ? ("high" as const) : undefined,
        })),
      ],
    };
  }

  if (kind === "sick") {
    const dayStart = new Date(c.now);
    dayStart.setHours(0, 0, 0, 0);
    const today = c.readings.filter((r) => inWindow(r.timestamp, dayStart.getTime(), c.now + 1));
    const stats = glucoseStats(today);
    const latest = [...today].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    const vals = today.map((r) => r.glucose);
    const ins = c.insulin.filter((e) => inWindow(e.timestamp, dayStart.getTime(), c.now + 1));
    const carbs = c.food.filter((f) => inWindow(f.timestamp, dayStart.getTime(), c.now + 1));
    return {
      kind,
      title,
      subject: `${name}: sick day`,
      message: `${hi} ${name} is sick today. Today's numbers are below. What should we do with insulin and food?`,
      detailsTitle: "From the app · today",
      details: [
        ...(latest ? [{ label: `Latest (${fmtTime(latest.timestamp)})`, value: `${latest.glucose} mg/dL` }] : []),
        ...(stats
          ? [
              { label: "Today's range", value: `${Math.min(...vals)} to ${Math.max(...vals)} mg/dL` },
              { label: "Today's average", value: `${stats.mean} mg/dL` },
            ]
          : []),
        { label: "Insulin logged today", value: `${Math.round(ins.reduce((s, e) => s + e.units, 0) * 10) / 10} units` },
        { label: "Carbs logged today", value: `${Math.round(carbs.reduce((s, f) => s + f.estimatedCarbs, 0))} g` },
        settingsLine(c),
      ],
    };
  }

  const stats = glucoseStats(week(c.readings));
  return {
    kind,
    title,
    subject: `${name}: question for the doctor`,
    message: `${hi} `,
    detailsTitle: "From the app · last 7 days",
    details: [
      ...(stats
        ? [
            { label: "Time in range (70 to 180)", value: `${Math.round(stats.pct.inRange)}%` },
            { label: "Average", value: `${stats.mean} mg/dL` },
          ]
        : []),
      settingsLine(c),
    ],
  };
}

/** The full text that goes out: the family's message, the numbers, and a short footer. */
export function noteBody(message: string, note: Pick<DoctorNote, "detailsTitle" | "details">): string {
  const lines = note.details.map((d) => `• ${d.label}: ${d.value}`);
  return [
    message.trim(),
    ...(lines.length ? ["", `${note.detailsTitle}:`, ...lines] : []),
    "",
    "Sent from Glucose Guardian. Numbers are from our Dexcom and the app's logs.",
  ].join("\n");
}

/** The short email/message that goes with the Visit Summary PDF. */
export function visitSummaryMessage(
  data: import("./visitSummary").VisitSummaryData,
  patientName: string,
  doctorName?: string,
): { subject: string; message: string } {
  const name = patientName.trim() || "my child";
  const range = fmtRange(data.startMs, data.endMs);
  const s = data.stats;
  const lines: string[] = [];
  if (s) {
    lines.push(`• Time in range: ${Math.round(s.pct.inRange)}% (70 to 180)`);
    lines.push(`• Estimated A1C: ${s.gmi}%`);
    lines.push(`• Average glucose: ${s.mean} mg/dL`);
  }
  const overnight = data.lows.filter((l) => isOvernight(l.start)).length;
  lines.push(
    data.lows.length
      ? `• ${data.lows.length} low${data.lows.length === 1 ? "" : "s"}${overnight ? `, ${overnight} of them overnight` : ""}`
      : "• No lows",
  );
  for (const c of data.changes) lines.push(`• ${c.what} changed from ${c.from} to ${c.to} on ${fmtDay(c.timestamp)}`);
  return {
    subject: `${name} · Visit Summary ${range}`,
    message: [
      greeting(doctorName),
      "",
      `Attached is ${name}'s summary for the last ${data.days} days from Glucose Guardian, with every meal and the glucose before and after.`,
      "",
      ...lines,
      "",
      "Thank you!",
    ].join("\n"),
  };
}
