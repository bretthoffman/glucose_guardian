import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock,
  Minus,
  Plus,
  Syringe,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CGMReading, PatientSnapshot } from "@doctor-portal/api-client-react";
import type { PatientDetail, SettingsChange } from "@/data/contracts";
import { computeMetrics, zonesFromSnapshot, type GlucoseZones } from "@/lib/glucose-metrics";
import { useGlucoseHistory } from "@/data/doctor-data";
import { formatDate, formatTime } from "@/lib/utils";

const DAY = 86_400_000;
const ts = (r: { timestamp: string }) => new Date(r.timestamp).getTime();

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const rangeText = (fromMs: number, toMs: number) =>
  `${shortDate(fromMs)} – ${shortDate(toMs)}, ${new Date(toMs).getFullYear()}`;

interface Win {
  fromMs: number;
  toMs: number;
}

interface PeriodStats {
  readings: CGMReading[];
  avg: number | null;
  tir: number;
  tar: number;
  tbr: number;
  insulinTotal: number | null;
  insulinDaily: number | null;
}

function readingsIn(all: CGMReading[], win: Win): CGMReading[] {
  return all.filter((r) => {
    const t = ts(r);
    return t >= win.fromMs && t < win.toMs;
  });
}

function periodStats(snapshot: PatientSnapshot, readings: CGMReading[], win: Win): PeriodStats {
  const m = computeMetrics({ ...snapshot, glucoseReadings: readings });
  const logs = snapshot.insulinLog ?? [];
  const earliest = logs.length ? Math.min(...logs.map((l) => Date.parse(l.timestamp))) : null;
  let insulinTotal: number | null = null;
  let insulinDaily: number | null = null;
  // Only report insulin when the log's coverage reaches this window (the sync keeps ~100 entries).
  if (earliest != null && earliest <= win.toMs) {
    const inWin = logs.filter((l) => {
      const t = Date.parse(l.timestamp);
      return t >= win.fromMs && t < win.toMs;
    });
    insulinTotal = Math.round(inWin.reduce((a, l) => a + l.units, 0) * 10) / 10;
    insulinDaily = Math.round((insulinTotal / ((win.toMs - win.fromMs) / DAY)) * 10) / 10;
  }
  return {
    readings,
    avg: readings.length ? m.average : null,
    tir: m.tir,
    tar: m.tar,
    tbr: m.tbr,
    insulinTotal,
    insulinDaily,
  };
}

// ── Key-differences / insights ───────────────────────────────────────────────

interface DiffRow {
  label: string;
  delta: number;
  unit: string;
  /** true = improvement (green), false = worse (red), null = neutral */
  better: boolean | null;
}

function buildDiffs(cur: PeriodStats, cmp: PeriodStats, zones: GlucoseZones): DiffRow[] {
  const mid = (zones.low + zones.high) / 2;
  const rows: DiffRow[] = [];
  if (cur.avg != null && cmp.avg != null) {
    const d = cur.avg - cmp.avg;
    rows.push({
      label: "Avg Glucose",
      delta: d,
      unit: " mg/dL",
      better: d === 0 ? null : Math.abs(cur.avg - mid) < Math.abs(cmp.avg - mid),
    });
  }
  const dTir = cur.tir - cmp.tir;
  rows.push({ label: "Time in Range", delta: dTir, unit: "%", better: dTir === 0 ? null : dTir > 0 });
  const dTar = cur.tar - cmp.tar;
  rows.push({
    label: `Highs (>${zones.high} mg/dL)`,
    delta: dTar,
    unit: "%",
    better: dTar === 0 ? null : dTar < 0,
  });
  const dTbr = cur.tbr - cmp.tbr;
  rows.push({
    label: `Lows (<${zones.low} mg/dL)`,
    delta: dTbr,
    unit: "%",
    better: dTbr === 0 ? null : dTbr < 0,
  });
  if (cur.insulinTotal != null && cmp.insulinTotal != null) {
    const d = Math.round((cur.insulinTotal - cmp.insulinTotal) * 10) / 10;
    rows.push({ label: "Total Insulin", delta: d, unit: "u", better: d === 0 ? null : d < 0 });
  }
  return rows;
}

interface Insight {
  icon: typeof TrendingUp;
  tone: "good" | "bad" | "neutral";
  title: string;
  stat: string;
  sub: string[];
}

function buildInsights(cur: PeriodStats, cmp: PeriodStats, zones: GlucoseZones): Insight[] {
  const out: Insight[] = [];
  const dTbr = cur.tbr - cmp.tbr;
  if (dTbr >= 3) {
    out.push({
      icon: AlertTriangle,
      tone: "bad",
      title: "More Lows",
      stat: `+${dTbr}% time below ${zones.low} mg/dL`,
      sub: [`${cmp.tbr}% → ${cur.tbr}%`, "Watch for hypoglycemia"],
    });
  }
  if (cur.avg != null && cmp.avg != null && Math.abs(cur.avg - cmp.avg) >= 5) {
    const d = cur.avg - cmp.avg;
    const pct = Math.round((Math.abs(d) / cmp.avg) * 1000) / 10;
    const improved = d < 0 ? cmp.avg > (zones.low + zones.high) / 2 : cmp.avg < (zones.low + zones.high) / 2;
    out.push({
      icon: improved ? TrendingUp : TrendingDown,
      tone: improved ? "good" : "bad",
      title: improved ? "Improved Control" : "Higher Average",
      stat: `Average glucose ${d < 0 ? "improved" : "rose"} by ${Math.abs(d)} mg/dL (${pct}%)`,
      sub: [d < 0 ? "Lower overall glucose levels" : "Review dosing with the caregiver"],
    });
  }
  const dTir = cur.tir - cmp.tir;
  if (Math.abs(dTir) >= 3) {
    out.push({
      icon: Clock,
      tone: dTir > 0 ? "good" : "bad",
      title: dTir > 0 ? "Better Time in Range" : "Less Time in Range",
      stat: `${Math.abs(dTir)}% ${dTir > 0 ? "more" : "less"} time in target range`,
      sub: [`${cur.tir}% vs ${cmp.tir}%`, Math.abs(dTir) >= 10 ? "Significant change" : "Modest change"],
    });
  }
  const dTar = cur.tar - cmp.tar;
  if (Math.abs(dTar) >= 3) {
    out.push({
      icon: dTar < 0 ? ArrowDown : ArrowUp,
      tone: dTar < 0 ? "good" : "bad",
      title: dTar < 0 ? "Fewer Highs" : "More Highs",
      stat: `${Math.abs(dTar)}% ${dTar < 0 ? "reduction" : "increase"} in high readings`,
      sub: [`Above ${zones.high} mg/dL`, dTar < 0 ? "Better peak control" : "Peaks need attention"],
    });
  }
  if (dTbr <= -3) {
    out.push({
      icon: TrendingUp,
      tone: "good",
      title: "Fewer Lows",
      stat: `${Math.abs(dTbr)}% less time below ${zones.low} mg/dL`,
      sub: [`${cmp.tbr}% → ${cur.tbr}%`],
    });
  }
  if (cur.insulinTotal != null && cmp.insulinTotal != null) {
    const d = Math.round((cur.insulinTotal - cmp.insulinTotal) * 10) / 10;
    if (Math.abs(d) >= 1) {
      out.push({
        icon: Syringe,
        tone: d < 0 ? "good" : "neutral",
        title: d < 0 ? "Lower Insulin Need" : "Higher Insulin Use",
        stat: `Using ${Math.abs(d)}u ${d < 0 ? "less" : "more"} total insulin`,
        sub: [d < 0 ? "Improved insulin efficiency" : "Higher daily average"],
      });
    }
  }
  if (!out.length) {
    out.push({
      icon: Minus,
      tone: "neutral",
      title: "No Major Change",
      stat: "Trends are similar between these periods",
      sub: ["Keep monitoring"],
    });
  }
  return out.slice(0, 4);
}

// ── Overlay comparison chart ─────────────────────────────────────────────────

interface OverlayRow {
  i: number;
  t: string;
  cur: number | null;
  cmp: number | null;
  cmpT: string;
}

function buildOverlay(
  curWin: Win,
  cmpWin: Win,
  curReadings: CGMReading[],
  cmpReadings: CGMReading[],
  rangeDays: number,
): { rows: OverlayRow[]; dayTicks: number[] } {
  const bucketMin = rangeDays <= 1 ? 10 : rangeDays <= 3 ? 20 : 30;
  const bucketMs = bucketMin * 60_000;
  const buckets = Math.max(1, Math.ceil((curWin.toMs - curWin.fromMs) / bucketMs));

  const sum = { cur: new Array<number>(buckets).fill(0), cmp: new Array<number>(buckets).fill(0) };
  const cnt = { cur: new Array<number>(buckets).fill(0), cmp: new Array<number>(buckets).fill(0) };
  for (const r of curReadings) {
    const i = Math.min(buckets - 1, Math.floor((ts(r) - curWin.fromMs) / bucketMs));
    if (i >= 0) {
      sum.cur[i] += r.value;
      cnt.cur[i]++;
    }
  }
  for (const r of cmpReadings) {
    const i = Math.min(buckets - 1, Math.floor((ts(r) - cmpWin.fromMs) / bucketMs));
    if (i >= 0) {
      sum.cmp[i] += r.value;
      cnt.cmp[i]++;
    }
  }

  const rows: OverlayRow[] = [];
  const dayTicks: number[] = [];
  let lastDay = "";
  for (let i = 0; i < buckets; i++) {
    const curMs = curWin.fromMs + i * bucketMs;
    const day = shortDate(curMs);
    if (day !== lastDay) {
      dayTicks.push(i);
      lastDay = day;
    }
    rows.push({
      i,
      t: `${day} · ${formatTime(new Date(curMs).toISOString())}`,
      cmpT: `${shortDate(cmpWin.fromMs + i * bucketMs)} · ${formatTime(new Date(cmpWin.fromMs + i * bucketMs).toISOString())}`,
      cur: cnt.cur[i] ? Math.round(sum.cur[i] / cnt.cur[i]) : null,
      cmp: cnt.cmp[i] ? Math.round(sum.cmp[i] / cnt.cmp[i]) : null,
    });
  }
  return { rows, dayTicks };
}

const CURRENT_COLOR = "#3B82F6";
const COMPARE_COLOR = "#F59E0B";

function OverlayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; payload: OverlayRow }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-xl text-xs space-y-1">
      {row.cur != null && (
        <p>
          <span style={{ color: CURRENT_COLOR }}>■</span>{" "}
          <span className="text-muted-foreground">{row.t}:</span>{" "}
          <span className="font-bold text-foreground">{row.cur} mg/dL</span>
        </p>
      )}
      {row.cmp != null && (
        <p>
          <span style={{ color: COMPARE_COLOR }}>■</span>{" "}
          <span className="text-muted-foreground">{row.cmpT}:</span>{" "}
          <span className="font-bold text-foreground">{row.cmp} mg/dL</span>
        </p>
      )}
    </div>
  );
}

// ── Small building blocks ────────────────────────────────────────────────────

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-display font-bold text-foreground leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function vals(c: SettingsChange | { carbRatio?: number; correctionFactor?: number; targetGlucose?: number }) {
  return [
    c.carbRatio != null ? `${c.carbRatio}g/u` : "—",
    c.correctionFactor != null ? `${c.correctionFactor} mg/dL` : "—",
    c.targetGlucose != null ? `${c.targetGlucose} mg/dL` : "—",
  ];
}

// ── Main component ───────────────────────────────────────────────────────────

export function TreatmentTrends({
  detail,
  onAddNew,
}: {
  detail: PatientDetail;
  onAddNew?: () => void;
}) {
  const snapshot = detail.snapshot;
  const zones = zonesFromSnapshot(snapshot);
  const active = detail.activeOrder;
  const history = useMemo(() => detail.settingsHistory ?? [], [detail.settingsHistory]);

  const snapReadings = useMemo(
    () => [...(snapshot.glucoseReadings ?? [])].sort((a, b) => ts(a) - ts(b)),
    [snapshot.glucoseReadings],
  );
  const latestMs = snapReadings.length
    ? ts(snapReadings[snapReadings.length - 1])
    : Math.floor(Date.now() / 300_000) * 300_000;

  const [rangeDays, setRangeDays] = useState(7);
  const [cmpIdx, setCmpIdx] = useState(0);

  const currentWin: Win = useMemo(
    () => ({ fromMs: latestMs - rangeDays * DAY, toMs: latestMs }),
    [latestMs, rangeDays],
  );

  // Compare-to options: one per prior settings period (newest first), plus the generic
  // "previous N days" immediately before the current window.
  const cmpOptions = useMemo(() => {
    const opts: { label: string; win: Win; carbRatio?: number; histIdx?: number }[] = [];
    for (let i = history.length - 2; i >= 0; i--) {
      const start = Date.parse(history[i].changedAt);
      const end = Date.parse(history[i + 1].changedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 30 * 60_000) continue;
      const fromMs = Math.max(start, end - rangeDays * DAY);
      opts.push({
        label: `${rangeText(fromMs, end)}${history[i].carbRatio != null ? ` · ${history[i].carbRatio}g/u` : ""}`,
        win: { fromMs, toMs: end },
        carbRatio: history[i].carbRatio,
        histIdx: i,
      });
    }
    opts.push({
      label: `Previous ${rangeDays} days (${rangeText(currentWin.fromMs - rangeDays * DAY, currentWin.fromMs)})`,
      win: { fromMs: currentWin.fromMs - rangeDays * DAY, toMs: currentWin.fromMs },
      carbRatio: history.length >= 2 ? history[history.length - 2].carbRatio : undefined,
    });
    return opts;
  }, [history, rangeDays, currentWin.fromMs]);

  const sel = cmpOptions[Math.min(cmpIdx, cmpOptions.length - 1)];

  const curServer = useGlucoseHistory(detail.accessCode, currentWin.fromMs, currentWin.toMs);
  const cmpServer = useGlucoseHistory(detail.accessCode, sel.win.fromMs, sel.win.toMs);

  const curReadings = curServer.readings?.length
    ? curServer.readings
    : readingsIn(snapReadings, currentWin);
  const cmpReadings = cmpServer.readings?.length
    ? cmpServer.readings
    : readingsIn(snapReadings, sel.win);

  const cur = useMemo(
    () => periodStats(snapshot, curReadings, currentWin),
    [snapshot, curReadings, currentWin],
  );
  const cmp = useMemo(
    () => periodStats(snapshot, cmpReadings, sel.win),
    [snapshot, cmpReadings, sel.win],
  );

  const currentRatio = history[history.length - 1]?.carbRatio ?? active?.carbRatio;
  const diffs = useMemo(() => buildDiffs(cur, cmp, zones), [cur, cmp, zones]);
  const insights = useMemo(() => buildInsights(cur, cmp, zones), [cur, cmp, zones]);

  const overlay = useMemo(
    () => buildOverlay(currentWin, sel.win, curReadings, cmpReadings, rangeDays),
    [currentWin, sel.win, curReadings, cmpReadings, rangeDays],
  );
  const peak = Math.max(
    zones.urgentHigh + 20,
    ...overlay.rows.map((r) => Math.max(r.cur ?? 0, r.cmp ?? 0)),
  );
  const yMax = Math.ceil((peak + 10) / 50) * 50;

  // Left-rail history list (newest first). Fall back to a single "current" row until the
  // settings-history backend is deployed and entries accrue.
  const railEntries: SettingsChange[] = history.length
    ? [...history].reverse()
    : [
        {
          changedAt: active?.proposedAt ?? snapshot.syncedAt,
          carbRatio: active?.carbRatio,
          correctionFactor: active?.correctionFactor,
          targetGlucose: active?.targetGlucose,
        },
      ];
  const selectedHistIdx = sel.histIdx;

  const hasComparableData = curReadings.length > 0 || cmpReadings.length > 0;
  const loadingHistory = curServer.isLoading || cmpServer.isLoading;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
      {/* ── Left rail: change history + active orders ── */}
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Treatment Changes History</p>
          </div>
          <div className="space-y-2">
            {railEntries.map((entry, revIdx) => {
              const i = history.length ? history.length - 1 - revIdx : 0;
              const isCurrent = revIdx === 0;
              const isCompared = !isCurrent && selectedHistIdx === i;
              const clickable = !isCurrent && history.length >= 2;
              const optIdx = cmpOptions.findIndex((o) => o.histIdx === i);
              const [carb, corr, target] = vals(entry);
              return (
                <button
                  key={`${entry.changedAt}-${i}`}
                  disabled={!clickable || optIdx < 0}
                  onClick={() => optIdx >= 0 && setCmpIdx(optIdx)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    isCurrent
                      ? "border-primary/60 bg-primary/5"
                      : isCompared
                        ? "border-amber-500/60 bg-amber-500/5"
                        : "border-border hover:border-primary/30"
                  } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                  title={clickable ? "Compare against this period" : undefined}
                >
                  {isCurrent && (
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">
                        Current
                      </span>
                      <span className="w-2 h-2 rounded-full bg-success" />
                    </div>
                  )}
                  {isCompared && (
                    <p className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold mb-1">
                      Comparing
                    </p>
                  )}
                  <p className="text-sm font-medium text-foreground">{formatDate(entry.changedAt)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {carb} · {corr} · {target}
                  </p>
                </button>
              );
            })}
          </div>
          <button
            onClick={onAddNew}
            className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 text-primary text-sm font-medium py-2 hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add New Setting
          </button>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-sm font-semibold text-foreground mb-3">Current Active Orders</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Carb ratio</span>
              <span className="font-medium text-foreground">
                {active?.carbRatio != null ? `${active.carbRatio} g/u` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Correction</span>
              <span className="font-medium text-foreground">
                {active?.correctionFactor != null ? `${active.correctionFactor} mg/dL per u` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Target</span>
              <span className="font-medium text-foreground">
                {active?.targetGlucose != null ? `${active.targetGlucose} mg/dL` : "—"}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border">
            Updated {formatDate(railEntries[0].changedAt)} · {formatTime(railEntries[0].changedAt)}
          </p>
        </div>
      </div>

      {/* ── Right: comparison ── */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-display font-bold text-foreground">Compare Glucose Trends</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Compare two time periods to see the impact of ratio changes
              {loadingHistory ? " · loading full history…" : ""}
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Time Range
              </p>
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground"
              >
                <option value={1}>1 Day</option>
                <option value={3}>3 Days</option>
                <option value={7}>7 Days</option>
                <option value={14}>14 Days</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Compare To
              </p>
              <select
                value={Math.min(cmpIdx, cmpOptions.length - 1)}
                onChange={(e) => setCmpIdx(Number(e.target.value))}
                className="text-xs bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground max-w-[220px]"
              >
                {cmpOptions.map((o, i) => (
                  <option key={i} value={i}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {!hasComparableData ? (
          <div className="rounded-xl border border-border bg-secondary/30 p-6 text-sm text-muted-foreground text-center">
            Not enough CGM history for this range yet. As more data syncs, the comparison will fill
            in — try a shorter time range meanwhile.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_240px] gap-3">
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">
                    Current{" "}
                    <span className="text-muted-foreground normal-case font-normal">
                      ({rangeText(currentWin.fromMs, currentWin.toMs)})
                    </span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ratio: {currentRatio != null ? `${currentRatio}g/u` : "—"}
                </p>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <StatCell
                    label="Average Glucose"
                    value={cur.avg != null ? `${cur.avg}` : "—"}
                    sub="mg/dL"
                  />
                  <StatCell label="Time in Range" value={curReadings.length ? `${cur.tir}%` : "—"} />
                  <StatCell
                    label="Total Insulin"
                    value={cur.insulinTotal != null ? `${cur.insulinTotal}u` : "—"}
                    sub={cur.insulinDaily != null ? `Avg daily ${cur.insulinDaily}u` : undefined}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">
                  Compare{" "}
                  <span className="text-muted-foreground normal-case font-normal">
                    ({rangeText(sel.win.fromMs, sel.win.toMs)})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ratio: {sel.carbRatio != null ? `${sel.carbRatio}g/u` : "—"}
                </p>
                {cmpReadings.length ? (
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <StatCell
                      label="Average Glucose"
                      value={cmp.avg != null ? `${cmp.avg}` : "—"}
                      sub="mg/dL"
                    />
                    <StatCell label="Time in Range" value={`${cmp.tir}%`} />
                    <StatCell
                      label="Total Insulin"
                      value={cmp.insulinTotal != null ? `${cmp.insulinTotal}u` : "—"}
                      sub={cmp.insulinDaily != null ? `Avg daily ${cmp.insulinDaily}u` : undefined}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-4">
                    No CGM data available for this period{" "}
                    {curServer.readings === null ? "yet — full history unlocks after the next backend deploy." : "."}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-xs font-semibold text-foreground mb-2">Key Differences</p>
                {cmpReadings.length && curReadings.length ? (
                  <div className="space-y-1.5">
                    {diffs.map((d) => {
                      const Arrow = d.delta === 0 ? Minus : d.delta > 0 ? ArrowUp : ArrowDown;
                      const color =
                        d.better == null
                          ? "text-muted-foreground"
                          : d.better
                            ? "text-success"
                            : "text-destructive";
                      return (
                        <div key={d.label} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground truncate">{d.label}</span>
                          <span className={`flex items-center gap-0.5 font-semibold ${color}`}>
                            <Arrow className="w-3 h-3" />
                            {d.delta > 0 ? "+" : d.delta < 0 ? "−" : ""}
                            {Math.abs(d.delta)}
                            {d.unit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Needs data in both periods to compare.
                  </p>
                )}
              </div>
            </div>

            {/* Overlay chart */}
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold text-foreground mb-2">Glucose Trend Comparison</p>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={overlay.rows} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <ReferenceArea
                    y1={zones.low}
                    y2={zones.high}
                    fill="#10B981"
                    fillOpacity={0.1}
                  />
                  <ReferenceLine y={zones.high} stroke="#F59E0B" strokeOpacity={0.45} strokeDasharray="4 4" />
                  <ReferenceLine y={zones.low} stroke="#F97316" strokeOpacity={0.45} strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    dataKey="i"
                    domain={[0, overlay.rows.length - 1]}
                    ticks={overlay.dayTicks}
                    tickFormatter={(i: number) =>
                      shortDate(currentWin.fromMs + i * ((currentWin.toMs - currentWin.fromMs) / overlay.rows.length))
                    }
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickMargin={8}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickMargin={6}
                    domain={[40, yMax]}
                    width={40}
                  />
                  <Tooltip content={(p) => <OverlayTooltip {...(p as object)} />} />
                  <Line
                    type="monotone"
                    dataKey="cur"
                    stroke={CURRENT_COLOR}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cmp"
                    stroke={COMPARE_COLOR}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-0.5 rounded" style={{ backgroundColor: CURRENT_COLOR }} />
                  Current{currentRatio != null ? ` (${currentRatio}g/u)` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-4 h-0.5 rounded"
                    style={{
                      backgroundImage: `repeating-linear-gradient(90deg, ${COMPARE_COLOR} 0 4px, transparent 4px 7px)`,
                    }}
                  />
                  Previous{sel.carbRatio != null ? ` (${sel.carbRatio}g/u)` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-success/30 border border-success/50" />
                  Target Range ({zones.low}–{zones.high} mg/dL)
                </span>
              </div>
            </div>

            {/* Insights */}
            {curReadings.length > 0 && cmpReadings.length > 0 && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-foreground mb-3">Insights</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {insights.map((ins) => {
                    const Icon = ins.icon;
                    const tone =
                      ins.tone === "good"
                        ? "text-success"
                        : ins.tone === "bad"
                          ? "text-destructive"
                          : "text-muted-foreground";
                    return (
                      <div key={ins.title} className="rounded-xl border border-border bg-secondary/30 p-3">
                        <p className={`flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
                          <Icon className="w-4 h-4" /> {ins.title}
                        </p>
                        <p className="text-xs text-foreground mt-1.5">{ins.stat}</p>
                        {ins.sub.map((s) => (
                          <p key={s} className="text-[11px] text-muted-foreground mt-0.5">
                            {s}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
