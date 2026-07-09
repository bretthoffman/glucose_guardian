import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/**
 * Doctor alert engine: a 5-minute cron scans every linked patient for urgent lows/highs and
 * stale data (with per-kind cooldowns so doctors aren't spammed), and `doctor.decideOrder`
 * appends caregiver-decision alerts as they happen. The portal polls `list` for its bell badge;
 * when RESEND_API_KEY is configured, new alerts are also emailed to the doctor, and a Monday
 * cron sends a per-doctor weekly patient digest. Without the key, everything except email still
 * works — alerts land in the portal.
 */

function requireDoctorApiSecret(provided: string) {
  const expected = process.env.CONVEX_DOCTOR_API_SECRET;
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized doctor API");
  }
}

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const URGENT_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const STALE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ── Portal-facing ────────────────────────────────────────────────────────────

export const list = query({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const rows = await ctx.db
      .query("doctorAlerts")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", args.doctorId))
      .order("desc")
      .take(30);
    return {
      unreadCount: rows.filter((r) => !r.readAt).length,
      alerts: rows.map((r) => ({
        id: r._id,
        kind: r.kind,
        accessCode: r.accessCode,
        message: r.message,
        value: r.value,
        createdAt: r.createdAt,
        readAt: r.readAt,
      })),
    };
  },
});

export const markAllRead = mutation({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const rows = await ctx.db
      .query("doctorAlerts")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", args.doctorId))
      .order("desc")
      .take(200);
    const now = Date.now();
    for (const r of rows) {
      if (!r.readAt) await ctx.db.patch(r._id, { readAt: now });
    }
    return { ok: true as const };
  },
});

// ── Scan (cron every 5 minutes) ──────────────────────────────────────────────

type AlertKind = Doc<"doctorAlerts">["kind"];

export const scan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const links = (await ctx.db.query("doctorPatientLinks").collect()).filter(
      (l) => l.revokedAt == null,
    );
    const byCode = new Map<string, typeof links>();
    for (const l of links) {
      const arr = byCode.get(l.accessCode) ?? [];
      arr.push(l);
      byCode.set(l.accessCode, arr);
    }

    const created: Id<"doctorAlerts">[] = [];
    const now = Date.now();

    for (const [code, codeLinks] of byCode) {
      const state = await ctx.db
        .query("doctorPortalState")
        .withIndex("by_accessCode", (q) => q.eq("accessCode", code))
        .unique();
      const name = state?.profile?.childName ?? code;

      // Freshest known reading: durable ingestion store first, phone snapshot as fallback.
      let userId = codeLinks.find((l) => l.patientUserId)?.patientUserId ?? null;
      if (!userId) {
        const profile = await ctx.db
          .query("patientProfiles")
          .withIndex("by_doctorCode", (q) => q.eq("doctorCode", code))
          .first();
        userId = profile?.userId ?? null;
      }
      let latestValue: number | null = null;
      let latestMs: number | null = null;
      if (userId) {
        const row = await ctx.db
          .query("patientGlucoseReadings")
          .withIndex("by_user_time", (q) => q.eq("userId", userId))
          .order("desc")
          .first();
        if (row) {
          latestValue = row.glucose;
          latestMs = Date.parse(row.timestamp);
        }
      }
      const snap = state?.glucoseReadings;
      if (snap?.length) {
        const last = snap[snap.length - 1];
        const t = Date.parse(last.timestamp);
        if (latestMs == null || t > latestMs) {
          latestMs = t;
          latestValue = last.value;
        }
      }
      if (latestMs == null || Number.isNaN(latestMs)) continue;

      const prefs = state?.alertPreferences;
      const urgentLow = prefs?.urgentLowThreshold ?? 55;
      const urgentHigh = prefs?.urgentHighThreshold ?? 250;

      let kind: AlertKind | null = null;
      let message = "";
      let value: number | undefined;
      if (now - latestMs > STALE_AFTER_MS) {
        kind = "stale_data";
        message = `${name}: no CGM data for ${Math.round((now - latestMs) / 3_600_000)} hours`;
      } else if (latestValue != null && latestValue <= urgentLow) {
        kind = "urgent_low";
        value = latestValue;
        message = `${name}: URGENT LOW — ${latestValue} mg/dL`;
      } else if (latestValue != null && latestValue >= urgentHigh) {
        kind = "urgent_high";
        value = latestValue;
        message = `${name}: urgent high — ${latestValue} mg/dL`;
      }
      if (!kind) continue;

      const cooldown = kind === "stale_data" ? STALE_COOLDOWN_MS : URGENT_COOLDOWN_MS;
      for (const link of codeLinks) {
        const last = await ctx.db
          .query("doctorAlerts")
          .withIndex("by_doctor_code_kind", (q) =>
            q.eq("doctorId", link.doctorId).eq("accessCode", code).eq("kind", kind),
          )
          .order("desc")
          .first();
        if (last && now - last.createdAt < cooldown) continue;
        created.push(
          await ctx.db.insert("doctorAlerts", {
            doctorId: link.doctorId,
            accessCode: code,
            kind,
            message,
            value,
            createdAt: now,
          }),
        );
      }
    }
    return { created };
  },
});

// ── Email delivery (Resend; skipped silently when RESEND_API_KEY is unset) ──

const RESEND_URL = "https://api.resend.com/emails";
const FROM = () => process.env.RESEND_FROM ?? "Glucose Guardian <onboarding@resend.dev>";

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [to], subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const getForEmail = internalQuery({
  args: { ids: v.array(v.id("doctorAlerts")) },
  handler: async (ctx, args) => {
    const out: { id: Id<"doctorAlerts">; email: string; message: string; kind: string }[] = [];
    for (const id of args.ids) {
      const alert = await ctx.db.get(id);
      if (!alert || alert.emailedAt) continue;
      const doctor = await ctx.db.get(alert.doctorId);
      if (!doctor?.email) continue;
      out.push({ id, email: doctor.email, message: alert.message, kind: alert.kind });
    }
    return out;
  },
});

export const markEmailed = internalMutation({
  args: { ids: v.array(v.id("doctorAlerts")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      await ctx.db.patch(id, { emailedAt: now });
    }
  },
});

/** Cron entrypoint: scan for new alert conditions, then email whatever was created. */
export const scanAndNotify = internalAction({
  args: {},
  handler: async (ctx) => {
    const { created } = await ctx.runMutation(internal.doctorAlerts.scan, {});
    if (!created.length || !process.env.RESEND_API_KEY) return;

    const rows = await ctx.runQuery(internal.doctorAlerts.getForEmail, { ids: created });
    const byEmail = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byEmail.get(r.email) ?? [];
      arr.push(r);
      byEmail.set(r.email, arr);
    }
    const sent: Id<"doctorAlerts">[] = [];
    for (const [email, alerts] of byEmail) {
      const urgent = alerts.some((a) => a.kind === "urgent_low" || a.kind === "urgent_high");
      const subject = `${urgent ? "⚠ " : ""}Glucose Guardian: ${alerts.length} patient alert${alerts.length === 1 ? "" : "s"}`;
      const html = `<p>New alerts from your Glucose Guardian portal:</p><ul>${alerts
        .map((a) => `<li>${a.message}</li>`)
        .join("")}</ul><p style="color:#666;font-size:12px">Open the doctor portal to review. You receive these because alert emails are enabled for your account's deployment.</p>`;
      if (await sendEmail(email, subject, html)) {
        sent.push(...alerts.map((a) => a.id));
      }
    }
    if (sent.length) await ctx.runMutation(internal.doctorAlerts.markEmailed, { ids: sent });
  },
});

// ── Weekly digest (Mondays; requires RESEND_API_KEY) ─────────────────────────

export const digestData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const doctors = await ctx.db.query("doctorAccounts").collect();
    const out: {
      email: string;
      displayName: string;
      patients: {
        name: string;
        code: string;
        avg: number | null;
        tir: number | null;
        latest: string;
        changes: number;
        pending: boolean;
      }[];
    }[] = [];
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const doctor of doctors) {
      const links = (
        await ctx.db
          .query("doctorPatientLinks")
          .withIndex("by_doctorId", (q) => q.eq("doctorId", doctor._id))
          .collect()
      ).filter((l) => l.revokedAt == null);
      if (!links.length) continue;

      const patients = [];
      for (const link of links) {
        const state = await ctx.db
          .query("doctorPortalState")
          .withIndex("by_accessCode", (q) => q.eq("accessCode", link.accessCode))
          .unique();
        const name = state?.profile?.childName ?? link.displayName ?? link.accessCode;

        let readings: { value: number; timestamp: string }[] = [];
        if (link.patientUserId) {
          const rows = await ctx.db
            .query("patientGlucoseReadings")
            .withIndex("by_user_time", (q) =>
              q.eq("userId", link.patientUserId!).gte("timestamp", weekAgoIso),
            )
            .take(2100);
          readings = rows.map((r) => ({ value: r.glucose, timestamp: r.timestamp }));
        }
        if (!readings.length && state?.glucoseReadings?.length) {
          readings = state.glucoseReadings.filter((r) => r.timestamp >= weekAgoIso);
        }

        const low = state?.alertPreferences?.lowThreshold ?? 70;
        const high = state?.alertPreferences?.highThreshold ?? 180;
        const n = readings.length;
        const avg = n ? Math.round(readings.reduce((a, r) => a + r.value, 0) / n) : null;
        const tir = n
          ? Math.round(
              (readings.filter((r) => r.value >= low && r.value <= high).length / n) * 100,
            )
          : null;
        const newest = n ? readings[n - 1] : undefined;
        const latest = newest
          ? `${newest.value} mg/dL (${Math.round((Date.now() - Date.parse(newest.timestamp)) / 3_600_000)}h ago)`
          : "no data";
        const changes = (state?.settingsHistory ?? []).filter(
          (c) => c.changedAt >= weekAgoIso,
        ).length;

        patients.push({
          name,
          code: link.accessCode,
          avg,
          tir,
          latest,
          changes,
          pending: !!state?.therapyProposal,
        });
      }
      out.push({ email: doctor.email, displayName: doctor.displayName, patients });
    }
    return out;
  },
});

export const weeklyDigest = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.RESEND_API_KEY) return;
    const doctors = await ctx.runQuery(internal.doctorAlerts.digestData, {});
    for (const d of doctors) {
      if (!d.patients.length) continue;
      const rows = d.patients
        .map(
          (p) =>
            `<tr><td>${p.name}</td><td>${p.avg != null ? `${p.avg} mg/dL` : "—"}</td><td>${p.tir != null ? `${p.tir}%` : "—"}</td><td>${p.latest}</td><td>${p.changes || "—"}</td><td>${p.pending ? "Yes" : "—"}</td></tr>`,
        )
        .join("");
      const html = `<p>Hi ${d.displayName},</p><p>Your weekly patient summary:</p>
<table border="0" cellpadding="6" style="border-collapse:collapse;font-size:13px">
<tr style="color:#666;text-align:left"><th>Patient</th><th>Avg (7d)</th><th>Time in range</th><th>Latest reading</th><th>Setting changes</th><th>Pending proposal</th></tr>
${rows}</table>
<p style="color:#666;font-size:12px">Open the doctor portal for full trends and comparisons.</p>`;
      await sendEmail(d.email, "Your weekly Glucose Guardian patient summary", html);
    }
  },
});
