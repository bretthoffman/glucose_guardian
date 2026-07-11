import OpenAI from "openai";
import { api } from "../../../convex/_generated/api.js";
import {
  createConvexDoctorAccountsClient,
  getConvexDoctorApiSecret,
} from "./convex-doctor-accounts.js";
import {
  createConvexDoctorHttpClient,
  getConvexDoctorIngestSecret,
} from "./convex-doctor.js";

/**
 * "Glucose Guardian Assistant" for the doctor portal: answers a clinician's questions about the
 * ONE patient they're viewing, from that patient's synced record only. All context is gathered
 * server-side (the client sends nothing but the conversation), so the assistant cannot see any
 * other patient. Uses the same OpenAI gateway as the app's food analysis and caregiver chat.
 */

const DAY = 86_400_000;
const HISTORY_DAYS = 90;
const CHUNK_DAYS = 14; // getGlucoseHistory caps at 5000 rows; 14 days ≈ 4032 at 5-min cadence

interface Reading {
  value: number;
  timestamp: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function isAssistantConfigured(): boolean {
  return !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

/** Full CGM history for the last 90 days, fetched in parallel index-friendly chunks, deduped. */
async function fetchReadings(accessCode: string): Promise<Reading[]> {
  const client = createConvexDoctorAccountsClient();
  const secret = getConvexDoctorApiSecret();
  const now = Date.now();
  const chunkCount = Math.ceil(HISTORY_DAYS / CHUNK_DAYS);
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => {
      const toMs = now - i * CHUNK_DAYS * DAY;
      const fromMs = toMs - CHUNK_DAYS * DAY;
      return client
        .query(api.doctorAccounts.getGlucoseHistory, {
          serverSecret: secret,
          accessCode,
          fromTimestamp: new Date(fromMs).toISOString(),
          toTimestamp: new Date(toMs).toISOString(),
        })
        .then((r) => (r as { readings: Reading[] }).readings ?? []);
    }),
  );
  const seen = new Set<string>();
  const out: Reading[] = [];
  for (const chunk of chunks) {
    for (const r of chunk) {
      if (!seen.has(r.timestamp)) {
        seen.add(r.timestamp);
        out.push(r);
      }
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

function windowStats(readings: Reading[], fromMs: number, low: number, high: number) {
  const inWin = readings.filter((r) => new Date(r.timestamp).getTime() >= fromMs);
  const n = inWin.length;
  if (!n) return null;
  const values = inWin.map((r) => r.value);
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const tir = values.filter((v) => v >= low && v <= high).length / n;
  const above = values.filter((v) => v > high).length / n;
  const below = values.filter((v) => v < low).length / n;
  const gmi = 3.31 + 0.02392 * avg;
  return {
    n,
    avg: Math.round(avg),
    min: Math.min(...values),
    max: Math.max(...values),
    tir: Math.round(tir * 100),
    above: Math.round(above * 100),
    below: Math.round(below * 100),
    gmi: Math.round(gmi * 10) / 10,
  };
}

function fmtDay(ts: string): string {
  return ts.slice(0, 10);
}

function shortTs(ts: string): string {
  return `${ts.slice(5, 10)} ${ts.slice(11, 16)}Z`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildContext(doc: any, readings: Reading[]): string {
  const p = doc?.profile ?? {};
  const prefs = doc?.alertPreferences ?? {};
  const low = prefs.lowThreshold ?? 70;
  const high = prefs.highThreshold ?? 180;
  const now = Date.now();

  const lines: string[] = [];
  const age = p.dateOfBirth
    ? Math.floor((now - new Date(p.dateOfBirth).getTime()) / (365.25 * DAY))
    : null;
  lines.push(
    `PATIENT: ${p.childName ?? "Unknown"}${age != null ? `, ${age} years old` : ""}, ${p.diabetesType ?? "diabetes"}${p.weightLbs ? `, ${p.weightLbs} lbs` : ""}. Caregiver: ${p.parentName ?? "—"}.`,
  );
  lines.push(
    `CURRENT SETTINGS: carb ratio 1u:${p.carbRatio ?? "—"}g, correction factor 1u:${p.correctionFactor ?? "—"} mg/dL, target ${p.targetGlucose ?? "—"} mg/dL. Alert range ${low}–${high} mg/dL (urgent <${prefs.urgentLowThreshold ?? 55} / >${prefs.urgentHighThreshold ?? 250}).`,
  );
  if (doc?.labA1c) {
    lines.push(
      `LAB A1C: ${doc.labA1c.value}% measured ${fmtDay(doc.labA1c.measuredAt)} (entered by ${doc.labA1c.enteredByName}).`,
    );
  }

  const hist: any[] = doc?.settingsHistory ?? [];
  if (hist.length) {
    lines.push("SETTINGS HISTORY (oldest→newest):");
    for (const h of hist.slice(-8)) {
      lines.push(
        `  ${fmtDay(h.changedAt)}: CR 1:${h.carbRatio ?? "—"}, CF 1:${h.correctionFactor ?? "—"}, target ${h.targetGlucose ?? "—"}`,
      );
    }
  }
  if (doc?.therapyProposal) {
    lines.push(
      `PENDING PROPOSAL (awaiting caregiver): by ${doc.therapyProposal.proposedByName} on ${fmtDay(doc.therapyProposal.proposedAt)} — CR ${doc.therapyProposal.carbRatio ?? "—"}, CF ${doc.therapyProposal.correctionFactor ?? "—"}, target ${doc.therapyProposal.targetGlucose ?? "—"}.`,
    );
  }
  if (doc?.therapyDecision) {
    lines.push(
      `LAST PROPOSAL DECISION: ${doc.therapyDecision.status} on ${fmtDay(doc.therapyDecision.decidedAt)}.`,
    );
  }

  // Glucose statistics over standard windows (from the durable CGM store).
  lines.push(`GLUCOSE STATS (target range ${low}–${high} mg/dL; GMI = estimated A1C):`);
  const windows: [string, number][] = [
    ["last 24h", 1],
    ["last 7 days", 7],
    ["last 14 days", 14],
    ["last 30 days", 30],
    ["last 90 days", 90],
  ];
  for (const [label, days] of windows) {
    const s = windowStats(readings, now - days * DAY, low, high);
    lines.push(
      s
        ? `  ${label}: avg ${s.avg} mg/dL, range ${s.min}–${s.max}, TIR ${s.tir}% (above ${s.above}%, below ${s.below}%), GMI ${s.gmi}%, ${s.n} readings`
        : `  ${label}: no readings`,
    );
  }

  // Per-day rows for day-level questions (UTC days).
  const byDay = new Map<string, number[]>();
  for (const r of readings) {
    if (new Date(r.timestamp).getTime() < now - 14 * DAY) continue;
    const k = fmtDay(r.timestamp);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r.value);
  }
  if (byDay.size) {
    lines.push("DAILY BREAKDOWN (UTC date: avg, TIR, readings):");
    for (const [k, vals] of [...byDay.entries()].sort()) {
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const tir = Math.round(
        (vals.filter((v) => v >= low && v <= high).length / vals.length) * 100,
      );
      lines.push(`  ${k}: avg ${avg}, TIR ${tir}%, ${vals.length} readings`);
    }
  }

  const insulin: any[] = [...(doc?.insulinLog ?? [])]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 15);
  if (insulin.length) {
    lines.push("RECENT INSULIN (newest first, UTC):");
    for (const l of insulin) {
      lines.push(
        `  ${shortTs(String(l.timestamp))}: ${l.units}u ${l.type ?? ""}${l.insulinType ? ` (${l.insulinType})` : ""}${l.note ? ` — ${String(l.note).slice(0, 40)}` : ""}`,
      );
    }
  }
  const meals: any[] = [...(doc?.foodLog ?? [])]
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 15);
  if (meals.length) {
    lines.push("RECENT MEALS (newest first, UTC):");
    for (const f of meals) {
      lines.push(
        `  ${shortTs(String(f.timestamp))}: "${String(f.foodName).slice(0, 60)}" ${f.estimatedCarbs}g carbs, ${f.insulinUnits ?? 0}u given`,
      );
    }
  }

  const first = readings[0]?.timestamp;
  const last = readings[readings.length - 1]?.timestamp;
  lines.push(
    `DATA COVERAGE: CGM store has ${readings.length} readings${first ? ` from ${shortTs(first)} to ${shortTs(last!)}` : ""} (90-day window). Insulin/meal logs come from the app's last sync: ${doc?.syncedAt ?? "never"}. Anything outside this coverage is unknown — say so rather than guessing.`,
  );
  return lines.join("\n");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildSystemPrompt(doctorName: string, patientName: string, context: string): string {
  return `You are "Glucose Guardian Assistant", a concise clinical data assistant embedded in a diabetes doctor portal. You are speaking with ${doctorName}, a clinician reviewing their patient ${patientName}. Answer questions using ONLY the patient data below — it is ${patientName}'s complete synced record available to this portal. Never invent or extrapolate values.

STYLE:
- Professional and brief: 1–5 plain sentences, or a short line-per-item list for multi-part answers.
- Plain text only — no markdown, no asterisks, no headers.
- Always include units (mg/dL, %, u, g) and state the period + reading count you used, e.g. "Over the last 30 days (2,410 readings), average glucose was 162 mg/dL."
- If the requested period exceeds the data coverage, say exactly what is covered and answer for that (e.g. "I only have 12 days of CGM history; over those 12 days…").
- If asked something the data cannot answer, say so plainly and suggest what could answer it.

SCOPE & SAFETY:
- You describe and summarize recorded data and trends. You do not diagnose, and you do not issue treatment orders or dosing instructions.
- If asked whether settings should change, describe what the data shows (e.g. post-meal excursions, TIR trend, lows) and point to the portal's Treatment Settings → History & Compare view for a before/after comparison. The clinician makes all decisions.
- Questions unrelated to this patient's diabetes data: politely decline and redirect ("I can only help with ${patientName}'s data in this portal.").

${context}`;
}

export async function answerDoctorQuestion(args: {
  accessCode: string;
  doctorName: string;
  messages: ChatTurn[];
}): Promise<string> {
  const ingestClient = createConvexDoctorHttpClient();
  const [doc, readings] = await Promise.all([
    ingestClient.query(api.doctor.getState, {
      serverSecret: getConvexDoctorIngestSecret(),
      accessCode: args.accessCode,
    }),
    fetchReadings(args.accessCode),
  ]);

  const patientName =
    (doc as { profile?: { childName?: string } } | null)?.profile?.childName ?? "this patient";
  const systemPrompt = buildSystemPrompt(
    args.doctorName,
    patientName,
    buildContext(doc, readings),
  );

  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    fetch: globalThis.fetch,
  });

  // Generous cap: gpt-5-class models spend completion tokens on internal reasoning before the
  // visible answer; too small a budget returns empty content (finish_reason "length").
  const completion = await openai.chat.completions.create({
    model: "openai/gpt-5.2",
    max_completion_tokens: 1600,
    messages: [
      { role: "system", content: systemPrompt },
      ...args.messages.slice(-12).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 2000),
      })),
    ],
  });

  return (
    completion.choices[0]?.message?.content?.trim() ||
    "I had trouble answering that — try rephrasing the question."
  );
}
