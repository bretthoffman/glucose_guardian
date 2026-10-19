import type { DoctorMessage, DoctorProfile } from "@doctor-portal/api-client-react";
import type { CaregiverTitleEntry } from "@/data/caregivers";
import type { AccessLogEntry, CareCircleMember, DoctorAlert, LabA1cInfo, NurseThread } from "@/data/doctor-data";
import { DEMO_DOCTOR, DEMO_PEOPLE, demoPerson, type DemoPerson } from "./people";
import { drawMealPhoto } from "./photo";
import { logsBetween, mealById, readingsBetween, summarize, urgentEpisodes } from "./simulate";

/**
 * The demo's stand-in for the api-server: answers the portal's requests from the sample patients,
 * entirely in the browser. Anything the visitor does (messages, titles, treatment changes, lab
 * A1C) lives in memory for this visit only — nothing is sent anywhere.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A moment `daysAgo` days back at a local hour (9.5 = 9:30 AM). */
function ago(daysAgo: number, hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const h = Math.floor(hour);
  d.setHours(h, Math.round((hour - h) * 60), 0, 0);
  return d.getTime();
}

const iso = (t: number) => new Date(t).toISOString();
const fullName = (p: DemoPerson) => `${p.firstName} ${p.lastName}`;

interface Proposal {
  id: string;
  proposedAt: string;
  proposedByDoctorId: string;
  proposedByName: string;
  note: string;
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}

interface PatientState {
  linked: boolean;
  linkedAt: number;
  settings: { carbRatio: number; correctionFactor: number; targetGlucose: number };
  settingsHistory: { changedAt: string; carbRatio?: number; correctionFactor?: number; targetGlucose?: number }[];
  proposal: Proposal | null;
  decision: { proposalId: string; status: "approved" | "declined"; decidedAt: string } | null;
  labA1c: LabA1cInfo | null;
  messages: DoctorMessage[];
  nurseMessages: Map<string, NurseThread["messages"]>;
  nurseReadAt: Map<string, number>;
  titles: CaregiverTitleEntry[];
  accessLog: AccessLogEntry[];
}

interface DemoState {
  doctor: DoctorProfile;
  alertsReadAt: number;
  extraAlerts: DoctorAlert[];
  patients: Map<string, PatientState>;
}

let state: DemoState | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const photos = new Map<string, Blob>();

function initialState(): DemoState {
  const patients = new Map<string, PatientState>();
  for (const p of DEMO_PEOPLE) {
    const current = p.settingsHistory[p.settingsHistory.length - 1]!;
    const nurseMessages = new Map<string, NurseThread["messages"]>();
    if (p.nurse) {
      nurseMessages.set(
        p.nurse.codeId,
        (p.nurseMessages ?? []).map((m, i) => ({
          id: `${p.code}-nurse-${i}`,
          text: m.text,
          fromDoctor: m.fromDoctor,
          senderName: m.fromDoctor ? DEMO_DOCTOR.displayName : p.nurse!.account,
          createdAt: ago(m.daysAgo, m.hour),
        })),
      );
    }
    const decisionDaysAgo = p.lastDecision?.daysAgo;
    patients.set(p.code, {
      linked: true,
      linkedAt: ago(p.settingsHistory[0]!.daysAgo + 20, 10),
      settings: { carbRatio: p.carbRatio, correctionFactor: p.correctionFactor, targetGlucose: p.targetGlucose },
      settingsHistory: p.settingsHistory.map((s) => ({
        changedAt: iso(ago(s.daysAgo, 11)),
        carbRatio: s.carbRatio,
        correctionFactor: s.correctionFactor,
        targetGlucose: s.targetGlucose,
      })),
      proposal: p.pendingProposal
        ? {
            id: `${p.code}-proposal`,
            proposedAt: iso(ago(p.pendingProposal.daysAgo, 9.5)),
            proposedByDoctorId: DEMO_DOCTOR.doctorId,
            proposedByName: DEMO_DOCTOR.displayName,
            note: p.pendingProposal.note,
            carbRatio: p.pendingProposal.carbRatio,
            correctionFactor: p.pendingProposal.correctionFactor,
            targetGlucose: p.pendingProposal.targetGlucose,
          }
        : null,
      decision:
        p.lastDecision && decisionDaysAgo != null
          ? { proposalId: `${p.code}-past`, status: p.lastDecision.status, decidedAt: iso(ago(decisionDaysAgo, 18)) }
          : null,
      labA1c: {
        value: p.labA1c.value,
        measuredAt: new Date(ago(p.labA1c.daysAgo, 9)).toISOString().slice(0, 10),
        enteredByName: DEMO_DOCTOR.displayName,
        enteredAt: iso(ago(p.labA1c.daysAgo - 1, 15)),
      },
      messages: p.messages.map((m, i) => ({
        id: `${p.code}-msg-${i}`,
        timestamp: iso(ago(m.daysAgo, m.hour)),
        text: m.text,
        sender: m.sender,
        read: true,
      })),
      nurseMessages,
      nurseReadAt: new Map(p.nurse ? [[p.nurse.codeId, ago(4, 16)]] : []),
      titles: p.circle
        .filter((m) => m.title)
        .map((m) => ({ name: m.name, title: m.title!, detail: m.titleDetail, updatedAt: ago(30, 12) })),
      accessLog: [
        { action: "linked", at: ago(p.settingsHistory[0]!.daysAgo + 20, 10), doctorName: DEMO_DOCTOR.displayName },
        ...(p.pendingProposal
          ? [{ action: "proposed_change", at: ago(p.pendingProposal.daysAgo, 9.5), doctorName: DEMO_DOCTOR.displayName }]
          : []),
        { action: "viewed", at: ago(2, 9.3), doctorName: DEMO_DOCTOR.displayName },
        { action: "viewed", at: ago(0, 8.1), doctorName: DEMO_DOCTOR.displayName },
      ],
    });
  }
  return { doctor: { ...DEMO_DOCTOR }, alertsReadAt: Date.now() - 12 * HOUR, extraAlerts: [], patients };
}

const demo = () => (state ??= initialState());

/** Forget everything from this visit (on leaving the demo). */
export function resetDemo(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  state = null;
}

function later(ms: number, run: () => void) {
  timers.push(setTimeout(run, ms));
}

// ─── responses ───────────────────────────────────────────────────────────────────────────────

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const notInDemo = (what = "That isn't available in the demo.") => json(404, { error: what });

function nurseTitled(ps: PatientState, name: string) {
  return ps.titles.some((t) => t.name === name && t.title === "school_nurse");
}

function circle(p: DemoPerson, ps: PatientState): CareCircleMember[] {
  return p.circle.map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    accounts: m.accounts ?? [],
    ...(m.kind === "caregiver_code" ? { lastUsedAt: ago(0, 7.5) } : {}),
    // A code is a doctor chat only while this doctor has it tagged School Nurse.
    messaging: m.kind === "caregiver_code" ? (nurseTitled(ps, m.name) ? "nurse" : null) : m.messaging,
  }));
}

function nurseThreads(p: DemoPerson, ps: PatientState): NurseThread[] {
  return p.circle
    .filter((m) => m.kind === "caregiver_code" && nurseTitled(ps, m.name))
    .map((m) => {
      const codeId = m.id.replace(/^code:/, "");
      const messages = ps.nurseMessages.get(codeId) ?? [];
      const readAt = ps.nurseReadAt.get(codeId) ?? 0;
      return {
        codeId,
        name: m.name,
        messages,
        unread: messages.filter((x) => !x.fromDoctor && x.createdAt > readAt).length,
      };
    });
}

function dateOfBirth(p: DemoPerson): string {
  const now = new Date();
  const [month, day] = p.birthday;
  const hadBirthday = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  const year = now.getFullYear() - p.age - (hadBirthday ? 0 : 1);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function snapshot(p: DemoPerson, ps: PatientState) {
  const now = Date.now();
  const recent = logsBetween(p, now - 3 * DAY, now);
  return {
    accessCode: p.code,
    profile: {
      childName: fullName(p),
      ...(p.parentName ? { parentName: p.parentName } : {}),
      diabetesType: p.diabetesType,
      dateOfBirth: dateOfBirth(p),
      weightLbs: p.weightLbs,
      doctorName: demo().doctor.displayName,
      insulinTypes: [p.rapid, p.basal.insulin],
      ...ps.settings,
      ...(p.doseSettingsByTime ? { doseSettingsByTime: p.doseSettingsByTime } : {}),
    },
    glucoseReadings: readingsBetween(p, now - DAY, now),
    insulinLog: recent.insulin.slice(0, 100),
    foodLog: recent.food.slice(0, 100),
    messages: ps.messages,
    alertPreferences: { lowThreshold: 70, highThreshold: 180, urgentLowThreshold: 55, urgentHighThreshold: 250 },
    syncedAt: iso(now - 2 * MIN),
    source: "phone",
    therapyProposal: ps.proposal,
    therapyDecision: ps.decision,
    settingsHistory: ps.settingsHistory,
    labA1c: ps.labA1c,
  };
}

function alerts() {
  const s = demo();
  const out: DoctorAlert[] = [...s.extraAlerts];
  for (const p of DEMO_PEOPLE) {
    if (!s.patients.get(p.code)?.linked) continue;
    for (const e of urgentEpisodes(p, 36).slice(-3)) {
      out.push({
        id: `${p.code}-${e.kind}-${e.t}`,
        kind: e.kind,
        accessCode: p.code,
        message:
          e.kind === "urgent_low"
            ? `${fullName(p)}: URGENT LOW — ${e.value} mg/dL`
            : `${fullName(p)}: urgent high — ${e.value} mg/dL`,
        value: e.value,
        createdAt: e.t,
      });
    }
  }
  const sorted = out
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25)
    .map((a) => (a.createdAt <= s.alertsReadAt ? { ...a, readAt: s.alertsReadAt } : a));
  return { alerts: sorted, unreadCount: sorted.filter((a) => a.readAt == null).length };
}

function assistantReply(p: DemoPerson, question: string): string {
  const s = summarize(p, 14);
  const q = question.toLowerCase();
  const parts: string[] = [];
  if (/low|hypo|drop/.test(q)) {
    parts.push(
      `${p.firstName} had ${s.lows} low${s.lows === 1 ? "" : "s"} (below 70 mg/dL) in the last 14 days, ${s.below}% of readings. ${s.overnightLows} started overnight (midnight to 6 AM).`,
    );
  }
  if (/high|spike|hyper/.test(q)) {
    parts.push(`${s.above}% of readings were above 180 mg/dL over the last 14 days.`);
  }
  if (!parts.length || /summar|overview|how|doing|trend|range|a1c|gmi/.test(q)) {
    parts.unshift(
      `Over the last 14 days, ${p.firstName} was in range (70–180 mg/dL) ${s.inRange}% of the time, below ${s.below}% and above ${s.above}%. Average glucose was ${s.avg} mg/dL (GMI ${s.gmi}%).`,
    );
  }
  parts.push(p.pattern);
  parts.push("Demo note: this answer is built from the sample data.");
  return parts.join("\n\n");
}

const GUARDIAN_REPLIES = [
  "Thank you, Dr. Lee! That makes sense. We'll try it this week.",
  "Got it. We'll keep an eye on it and let you know how it goes.",
  "Thanks for checking in. That's really helpful.",
];

// ─── routing ─────────────────────────────────────────────────────────────────────────────────

async function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>) {
  const s = demo();
  const now = Date.now();

  if (path === "/api/doctor/me") {
    if (method === "PATCH") {
      s.doctor = { ...s.doctor, ...(body as Partial<DoctorProfile>), doctorId: DEMO_DOCTOR.doctorId };
    }
    return json(200, s.doctor);
  }
  if (path === "/api/doctor/me/patients") {
    return json(200, {
      patients: DEMO_PEOPLE.filter((p) => s.patients.get(p.code)!.linked).map((p) => ({
        accessCode: p.code,
        displayName: fullName(p),
        linkedAt: s.patients.get(p.code)!.linkedAt,
        hasData: true,
        syncedAt: iso(now - 2 * MIN),
      })),
    });
  }
  if (path === "/api/doctor/me/patients/link") {
    return json(403, { error: "In the demo, the sample patients are already linked." });
  }
  const unlink = path.match(/^\/api\/doctor\/me\/patients\/([^/]+)$/);
  if (unlink && method === "DELETE") {
    const ps = s.patients.get(decodeURIComponent(unlink[1]!).toUpperCase());
    if (ps) ps.linked = false;
    return json(200, { ok: true });
  }
  if (path === "/api/doctor/me/alerts") return json(200, alerts());
  if (path === "/api/doctor/me/alerts/read") {
    s.alertsReadAt = now;
    return json(200, { ok: true });
  }
  if (path === "/api/doctor/auth/logout" || path.startsWith("/api/doctor/me/pin")) {
    return json(200, { ok: true, valid: true, hasPin: false });
  }

  const messagesRoute = path.match(/^\/api\/doctor\/messages\/([^/]+)$/);
  const patientRoute = path.match(/^\/api\/doctor\/patient\/([^/]+)(\/.*)?$/);
  const code = decodeURIComponent((messagesRoute ?? patientRoute)?.[1] ?? "").toUpperCase();
  const p = demoPerson(code);
  const ps = p ? s.patients.get(p.code) : undefined;
  if (!p || !ps || !ps.linked) return json(403, { error: "No access to this patient" });

  if (messagesRoute) {
    if (method === "POST") {
      const text = String(body.text ?? "").trim();
      if (!text) return json(400, { error: "text is required" });
      const sent: DoctorMessage = { id: `${p.code}-msg-${now}`, timestamp: iso(now), text, sender: "doctor", read: false };
      ps.messages = [...ps.messages, sent];
      later(7000, () => {
        sent.read = true;
        ps.messages = [
          ...ps.messages,
          {
            id: `${p.code}-msg-${Date.now()}`,
            timestamp: iso(Date.now()),
            text: GUARDIAN_REPLIES[ps.messages.length % GUARDIAN_REPLIES.length]!,
            sender: "guardian",
            read: false,
          },
        ];
      });
      return json(201, sent);
    }
    return json(200, { messages: ps.messages });
  }

  const sub = patientRoute?.[2] ?? "";
  if (sub === "") {
    if (!ps.accessLog.some((a) => a.action === "viewed" && now - a.at < 30 * MIN)) {
      ps.accessLog = [...ps.accessLog, { action: "viewed", at: now, doctorName: s.doctor.displayName }];
    }
    return json(200, snapshot(p, ps));
  }
  if (sub === "/readings") {
    return json(200, {
      accessCode: p.code,
      readings: readingsBetween(p, Date.parse(query.get("from") ?? ""), Date.parse(query.get("to") ?? "")),
    });
  }
  if (sub === "/logs") {
    const from = Date.parse(query.get("from") ?? "");
    const to = Date.parse(query.get("to") ?? "");
    return json(200, { accessCode: p.code, from: iso(from), to: iso(to), ...logsBetween(p, from, to) });
  }
  const photo = sub.match(/^\/food-photos\/(.+)$/);
  if (photo) {
    const meal = mealById(p, decodeURIComponent(photo[1]!));
    if (!meal?.fromPhoto) return notInDemo("No photo for this meal");
    let image = photos.get(meal.id);
    if (!image) {
      image = await drawMealPhoto(meal.food.name, meal.id);
      photos.set(meal.id, image);
    }
    return new Response(image, { status: 200, headers: { "content-type": "image/png" } });
  }
  if (sub === "/care-circle") return json(200, { members: circle(p, ps) });
  if (sub === "/caregiver-titles") {
    if (method === "PUT") {
      const name = String(body.name ?? "").trim();
      const others = ps.titles.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
      ps.titles = body.title
        ? [
            ...others,
            {
              name,
              title: body.title as CaregiverTitleEntry["title"],
              detail: typeof body.detail === "string" && body.detail.trim() ? body.detail.trim() : undefined,
              updatedAt: now,
            },
          ]
        : others;
    }
    return json(200, { titles: ps.titles });
  }
  if (sub === "/nurse-threads") return json(200, { threads: nurseThreads(p, ps) });
  const nurse = sub.match(/^\/nurse-threads\/([^/]+)\/(messages|read)$/);
  if (nurse) {
    const codeId = decodeURIComponent(nurse[1]!);
    const thread = nurseThreads(p, ps).find((t) => t.codeId === codeId);
    if (!thread) return json(403, { error: "Only caregivers tagged as School Nurse can be messaged." });
    if (nurse[2] === "read") {
      ps.nurseReadAt.set(codeId, now);
      return json(200, { ok: true });
    }
    const text = String(body.text ?? "").trim();
    if (!text) return json(400, { error: "text is required" });
    const list = ps.nurseMessages.get(codeId) ?? [];
    ps.nurseMessages.set(codeId, [
      ...list,
      { id: `${codeId}-${now}`, text, fromDoctor: true, senderName: s.doctor.displayName, createdAt: now },
    ]);
    const nurseName = p.nurse?.codeId === codeId ? p.nurse.account : thread.name;
    later(6000, () => {
      const at = Date.now();
      ps.nurseMessages.set(codeId, [
        ...(ps.nurseMessages.get(codeId) ?? []),
        {
          id: `${codeId}-${at}`,
          text: `Thanks, ${s.doctor.displayName}. I'll keep an eye on it at school and log anything unusual.`,
          fromDoctor: false,
          senderName: nurseName,
          createdAt: at,
        },
      ]);
      s.extraAlerts = [
        { id: `${p.code}-nurse-${at}`, kind: "nurse_message", accessCode: p.code, message: `New message from ${nurseName}`, createdAt: at },
        ...s.extraAlerts,
      ];
    });
    return json(201, { ok: true });
  }
  if (sub === "/orders" && method === "POST") {
    if (ps.proposal) return json(409, { error: "A change is already awaiting caregiver confirmation." });
    const proposal: Proposal = {
      id: `${p.code}-proposal-${now}`,
      proposedAt: iso(now),
      proposedByDoctorId: s.doctor.doctorId,
      proposedByName: s.doctor.displayName,
      note: String(body.note ?? ""),
      ...(typeof body.carbRatio === "number" ? { carbRatio: body.carbRatio } : {}),
      ...(typeof body.correctionFactor === "number" ? { correctionFactor: body.correctionFactor } : {}),
      ...(typeof body.targetGlucose === "number" ? { targetGlucose: body.targetGlucose } : {}),
    };
    ps.proposal = proposal;
    ps.accessLog = [...ps.accessLog, { action: "proposed_change", at: now, doctorName: s.doctor.displayName }];
    // The family reviews it in the app and approves; the new settings take effect.
    later(20000, () => {
      if (ps.proposal?.id !== proposal.id) return;
      const at = Date.now();
      ps.settings = {
        carbRatio: proposal.carbRatio ?? ps.settings.carbRatio,
        correctionFactor: proposal.correctionFactor ?? ps.settings.correctionFactor,
        targetGlucose: proposal.targetGlucose ?? ps.settings.targetGlucose,
      };
      ps.settingsHistory = [...ps.settingsHistory, { changedAt: iso(at), ...ps.settings }];
      ps.decision = { proposalId: proposal.id, status: "approved", decidedAt: iso(at) };
      ps.proposal = null;
      const approver = p.circle.find((m) => m.kind === "owner" || m.kind === "patient")?.name ?? "The family";
      s.extraAlerts = [
        {
          id: `${p.code}-approved-${at}`,
          kind: "decision_approved",
          accessCode: p.code,
          message:
            approver === fullName(p)
              ? `${approver} approved your treatment change`
              : `${fullName(p)}: ${approver} approved your treatment change`,
          createdAt: at,
        },
        ...s.extraAlerts,
      ];
    });
    return json(201, proposal);
  }
  if (sub === "/lab-a1c" && method === "POST") {
    const value = Number(body.value);
    const measuredAt = String(body.measuredAt ?? "");
    if (!(value >= 3 && value <= 20) || Number.isNaN(Date.parse(measuredAt)) || Date.parse(measuredAt) > now) {
      return json(400, { error: "Enter an A1C between 3 and 20% with a valid past date." });
    }
    ps.labA1c = { value, measuredAt, enteredByName: s.doctor.displayName, enteredAt: iso(now) };
    ps.accessLog = [...ps.accessLog, { action: "recorded_lab_a1c", at: now, doctorName: s.doctor.displayName }];
    return json(201, ps.labA1c);
  }
  if (sub === "/access-log") {
    return json(200, { entries: [...ps.accessLog].sort((a, b) => b.at - a.at) });
  }
  if (sub === "/assistant" && method === "POST") {
    const messages = Array.isArray(body.messages) ? (body.messages as { role: string; content: string }[]) : [];
    const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    ps.accessLog = [...ps.accessLog, { action: "assistant_query", at: now, doctorName: s.doctor.displayName }];
    return json(200, { reply: assistantReply(p, question) });
  }
  return notInDemo();
}

/** The portal's request hook while the demo is on: every API call is answered here. */
export async function demoFetch(url: string, init: RequestInit & { method: string }): Promise<Response> {
  const u = new URL(url, window.location.origin);
  let body: Record<string, unknown> = {};
  if (typeof init.body === "string" && init.body) {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  // A little latency, so loading states look like the real portal.
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 160));
  if (!u.pathname.startsWith("/api/")) return notInDemo();
  return await route(init.method.toUpperCase(), u.pathname.replace(/\/+$/, ""), u.searchParams, body);
}
