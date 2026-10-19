import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Bell, Clock, Download, Lock, Sliders, CheckCircle2 } from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import type { PatientDetail, TherapyOrder, TherapyOrderValues } from "@/data/contracts";
import { useProposeOrder } from "@/data/doctor-data";
import { TreatmentTrends } from "@/components/TreatmentTrends";
import {
  computeMetrics,
  detectPatterns,
  zonesFromSnapshot,
  STATUS_META,
} from "@/lib/glucose-metrics";

type FieldKey = "carbRatio" | "correctionFactor" | "targetGlucose";

const RANGES: Record<FieldKey, { min: number; max: number; label: string; unit: string }> = {
  carbRatio: { min: 3, max: 50, label: "carb ratio", unit: "g/u" },
  correctionFactor: { min: 10, max: 150, label: "correction factor", unit: "mg/dL per u" },
  targetGlucose: { min: 80, max: 180, label: "target glucose", unit: "mg/dL" },
};

function warnFor(key: FieldKey, raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return "Enter a number.";
  const r = RANGES[key];
  if (n < r.min || n > r.max) return `Unusual ${r.label} (typical ${r.min}–${r.max}). Double-check before sending.`;
  return null;
}

function num(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? undefined : n;
}

function ValueRow({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">
        {value ?? "--"} <span className="text-muted-foreground font-normal">{unit}</span>
      </span>
    </div>
  );
}

function PendingBanner({ order }: { order: TherapyOrder }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-amber-600 font-medium mb-2">
        <Clock className="w-4 h-4" />
        Pending caregiver confirmation
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Proposed by {order.proposedByName} on {formatDate(order.proposedAt)} at{" "}
        {formatTime(order.proposedAt)}. It takes effect only after the caregiver confirms it in
        the app.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ValueRow label="Carb ratio" value={order.carbRatio} unit="g/u" />
        <ValueRow label="Correction" value={order.correctionFactor} unit="mg/dL/u" />
        <ValueRow label="Target" value={order.targetGlucose} unit="mg/dL" />
      </div>
      {order.note && (
        <p className="text-sm text-foreground mt-3 italic">&ldquo;{order.note}&rdquo;</p>
      )}
    </div>
  );
}

// ── Current Settings tab (active orders + propose-a-change form) ─────────────

function CurrentSettingsTab({ detail }: { detail: PatientDetail }) {
  const active = detail.activeOrder;
  const [proposed, setProposed] = useState<TherapyOrder | undefined>(detail.proposedOrder);
  const [carbRatio, setCarbRatio] = useState(String(active?.carbRatio ?? ""));
  const [correctionFactor, setCorrectionFactor] = useState(String(active?.correctionFactor ?? ""));
  const [targetGlucose, setTargetGlucose] = useState(String(active?.targetGlucose ?? ""));
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const { mutate, isPending, error } = useProposeOrder();

  // Track server state: when the caregiver approves/declines in the app, the pending banner
  // clears (and the decision line below updates) on the next data refresh.
  useEffect(() => {
    setProposed(detail.proposedOrder);
  }, [detail.proposedOrder]);

  const hasPending = !!proposed;
  const warnings = {
    carbRatio: warnFor("carbRatio", carbRatio),
    correctionFactor: warnFor("correctionFactor", correctionFactor),
    targetGlucose: warnFor("targetGlucose", targetGlucose),
  };
  const changed =
    num(carbRatio) !== active?.carbRatio ||
    num(correctionFactor) !== active?.correctionFactor ||
    num(targetGlucose) !== active?.targetGlucose;
  const canSubmit = detail.canPrescribe && !hasPending && changed && note.trim().length > 0 && !isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const values: TherapyOrderValues = {
      carbRatio: num(carbRatio),
      correctionFactor: num(correctionFactor),
      targetGlucose: num(targetGlucose),
      insulinTypes: active?.insulinTypes,
      alertThresholds: active?.alertThresholds,
    };
    try {
      const order = await mutate({
        patientId: detail.patientId,
        baseVersion: active?.version ?? 0,
        values,
        note: note.trim(),
      });
      setProposed(order);
      setNote("");
      setFeedback("Change proposed — sent to the caregiver to confirm in the app.");
    } catch {
      /* error surfaced via `error` below */
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {feedback && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-3 flex items-center gap-2 text-success">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm">{feedback}</span>
        </div>
      )}

      {proposed && <PendingBanner order={proposed} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Active orders</span>
            {active && (
              <span className="text-xs font-normal text-muted-foreground">
                v{active.version} · acknowledged {active.acknowledgedAt ? formatDate(active.acknowledgedAt) : "—"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ValueRow label="Carb ratio" value={active?.carbRatio} unit="g/u" />
          <ValueRow label="Correction" value={active?.correctionFactor} unit="mg/dL/u" />
          <ValueRow label="Target" value={active?.targetGlucose} unit="mg/dL" />
        </CardContent>
      </Card>

      {!hasPending && detail.lastDecision && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {detail.lastDecision.status === "approved" ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              The caregiver approved your last proposed change on{" "}
              {formatDate(detail.lastDecision.decidedAt)} at {formatTime(detail.lastDecision.decidedAt)}.
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              The caregiver declined your last proposed change on{" "}
              {formatDate(detail.lastDecision.decidedAt)} at {formatTime(detail.lastDecision.decidedAt)}.
            </>
          )}
        </p>
      )}

      {!detail.canPrescribe ? (
        <div className="rounded-xl border border-border bg-secondary/30 p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            You can view these orders, but only the designated prescriber for this patient can
            change them.
          </p>
        </div>
      ) : hasPending ? (
        <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          A change is already awaiting caregiver confirmation. You can propose another once it's
          resolved.
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Propose a change</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 mb-5 flex items-start gap-2 text-amber-600">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Proposed changes are not applied automatically. The caregiver must confirm them in
                the Glucose Guardian app before they affect dosing.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  id="carbRatio"
                  label="Carb ratio (g/u)"
                  value={carbRatio}
                  onChange={setCarbRatio}
                  warning={warnings.carbRatio}
                />
                <Field
                  id="correctionFactor"
                  label="Correction (mg/dL per u)"
                  value={correctionFactor}
                  onChange={setCorrectionFactor}
                  warning={warnings.correctionFactor}
                />
                <Field
                  id="targetGlucose"
                  label="Target (mg/dL)"
                  value={targetGlucose}
                  onChange={setTargetGlucose}
                  warning={warnings.targetGlucose}
                />
              </div>

              <div>
                <Label htmlFor="note">Reason for change (required)</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Repeated post-dinner highs; tightening evening carb ratio."
                  className="mt-1.5"
                  rows={3}
                />
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="text-sm">{error.message}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Sends to the caregiver for confirmation. Nothing changes on the device until they
                  accept.
                </p>
                <Button type="submit" disabled={!canSubmit}>
                  {isPending ? "Proposing…" : "Propose change"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Alerts & Recommendations tab ─────────────────────────────────────────────

function AlertsRecommendationsTab({ detail }: { detail: PatientDetail }) {
  const snapshot = detail.snapshot;
  const zones = zonesFromSnapshot(snapshot);
  const patterns = detectPatterns(snapshot);
  const rows = [
    { label: "Urgent High", range: `> ${zones.urgentHigh} mg/dL`, dot: STATUS_META.urgentHigh.dot },
    { label: "High", range: `${zones.high}–${zones.urgentHigh} mg/dL`, dot: STATUS_META.high.dot },
    { label: "Target Range", range: `${zones.low}–${zones.high} mg/dL`, dot: STATUS_META.target.dot },
    { label: "Low", range: `${zones.urgentLow}–${zones.low} mg/dL`, dot: STATUS_META.low.dot },
    { label: "Urgent Low", range: `< ${zones.urgentLow} mg/dL`, dot: STATUS_META.urgentLow.dot },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl items-start">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Alert thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${r.dot}`} /> {r.label}
              </span>
              <span className="font-medium text-foreground">{r.range}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
            Alert levels come from the patient's app settings and drive the zones on every chart.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" /> Detected patterns & recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {patterns.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-foreground">
                {p.startsWith("No concerning") ? (
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                )}
                {p}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border">
            Heuristics over the synced readings — informational, not a diagnosis.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Export report ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function exportReport(detail: PatientDetail) {
  const s = detail.snapshot;
  const p = s.profile;
  const m = computeMetrics(s);
  const zones = zonesFromSnapshot(s);
  const patterns = detectPatterns(s);
  const active = detail.activeOrder;
  const history = detail.settingsHistory ?? [];
  const now = new Date();

  const historyRows = history.length
    ? [...history]
        .reverse()
        .map(
          (h) =>
            `<tr><td>${esc(formatDate(h.changedAt))}</td><td>${h.carbRatio ?? "—"} g/u</td><td>${h.correctionFactor ?? "—"} mg/dL</td><td>${h.targetGlucose ?? "—"} mg/dL</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No recorded changes yet.</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Treatment report — ${esc(p.childName)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px;font-size:14px;line-height:1.5}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .muted{color:#666;font-size:12px} table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;font-size:13px} th{color:#666;font-weight:600}
  .grid{display:flex;gap:24px;flex-wrap:wrap} .stat b{font-size:18px;display:block}
</style></head><body>
<h1>Treatment report — ${esc(p.childName)}</h1>
<p class="muted">Generated ${esc(formatDate(now.toISOString()))} at ${esc(formatTime(now.toISOString()))} · Patient ID ${esc(detail.accessCode)} · DOB ${esc(p.dateOfBirth ? formatDate(p.dateOfBirth) : "—")}${p.parentName ? ` · Caregiver ${esc(p.parentName)}` : ""}</p>
<h2>Current treatment settings</h2>
<table><tr><th>Carb ratio</th><th>Correction factor</th><th>Target glucose</th></tr>
<tr><td>${active?.carbRatio ?? "—"} g/u</td><td>${active?.correctionFactor ?? "—"} mg/dL per u</td><td>${active?.targetGlucose ?? "—"} mg/dL</td></tr></table>
<h2>Glucose summary (latest synced data)</h2>
<div class="grid">
  <div class="stat"><span class="muted">Average</span><b>${m.average ?? "—"} mg/dL</b></div>
  <div class="stat"><span class="muted">Est. A1C/GMI</span><b>${m.a1c ?? "—"}%</b></div>
  <div class="stat"><span class="muted">Time in range</span><b>${m.tir}%</b></div>
  <div class="stat"><span class="muted">Time high</span><b>${m.tar}%</b></div>
  <div class="stat"><span class="muted">Time low</span><b>${m.tbr}%</b></div>
</div>
<p class="muted">Target range ${zones.low}–${zones.high} mg/dL · thresholds from the patient's app.</p>
<h2>Settings change history</h2>
<table><tr><th>Date</th><th>Carb ratio</th><th>Correction</th><th>Target</th></tr>${historyRows}</table>
<h2>Detected patterns</h2>
<ul>${patterns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p class="muted">Treatment setting changes may take 24–48 hours to show full impact. Always monitor patient response and adjust as needed.</p>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script>
</body></html>`;

  const w = window.open("", "_blank", "noopener,width=840,height=920");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

// ── Panel shell ──────────────────────────────────────────────────────────────

const PANEL_TABS = [
  { id: "current", label: "Current Settings" },
  { id: "history", label: "History & Compare" },
  { id: "alerts", label: "Alerts & Recommendations" },
] as const;
type PanelTab = (typeof PANEL_TABS)[number]["id"];

export function TherapyOrdersPanel({ detail }: { detail: PatientDetail }) {
  const [tab, setTab] = useState<PanelTab>("history");

  return (
    <div className="space-y-5">
      <div data-tour="treatment">
        <h2 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <Sliders className="w-6 h-6 text-primary" />
          Treatment Settings
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Review carb ratios, insulin sensitivity, and targets over time. Compare changes and their
          impact on glucose trends.
        </p>
      </div>

      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-1">
          {PANEL_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => exportReport(detail)}
          className="flex items-center gap-1.5 text-sm text-primary hover:underline pb-2"
        >
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      {tab === "current" && <CurrentSettingsTab detail={detail} />}
      {tab === "history" && <TreatmentTrends detail={detail} onAddNew={() => setTab("current")} />}
      {tab === "alerts" && <AlertsRecommendationsTab detail={detail} />}

      <p className="text-xs text-muted-foreground text-center">
        Treatment setting changes may take 24–48 hours to show full impact. Always monitor patient
        response and adjust as needed.
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  warning,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  warning: string | null;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5"
      />
      {warning && (
        <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {warning}
        </p>
      )}
    </div>
  );
}
