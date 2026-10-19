import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  LabelList,
} from "recharts";
import {
  Info,
  Calendar,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  Zap,
  CheckCircle2,
  ExternalLink,
  LineChart as LineChartIcon,
} from "lucide-react";
import type { CGMReading, PatientSnapshot } from "@doctor-portal/api-client-react";
import { zonesFromSnapshot, type GlucoseZones } from "@/lib/glucose-metrics";
import { GlucoseTrendChart } from "@/components/GlucoseTrendChart";
import { LabA1cRecord } from "@/components/LabA1cRecord";

const DAY = 86_400_000;
const RANGES = [3, 7, 14, 30, 90, 180, 365];

function rangeLabel(d: number): string {
  return d >= 365 ? "1 year" : `${d} days`;
}

interface Stats {
  count: number;
  avg: number | null;
  tir: number | null;
  tar: number | null;
  gmi: number | null;
}

function statsFor(readings: CGMReading[], zones: GlucoseZones, startMs: number, endMs: number): Stats {
  const vals = readings
    .filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= startMs && t <= endMs;
    })
    .map((r) => r.value);
  const n = vals.length;
  if (!n) return { count: 0, avg: null, tir: null, tar: null, gmi: null };
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / n);
  return {
    count: n,
    avg,
    tir: Math.round((vals.filter((v) => v >= zones.low && v <= zones.high).length / n) * 100),
    tar: Math.round((vals.filter((v) => v > zones.high).length / n) * 100),
    gmi: 3.31 + 0.02392 * avg,
  };
}

function fmtDate(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function Ring({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const tone = pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0">
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
        transform="rotate(-90 38 38)"
      />
      <text x="38" y="43" textAnchor="middle" fontSize="17" fontWeight="700" fill="currentColor">
        {pct}%
      </text>
    </svg>
  );
}

function Delta({ value, unit, goodWhenDown = true }: { value: number; unit: string; goodWhenDown?: boolean }) {
  const down = value < 0;
  const improved = goodWhenDown ? down : !down;
  const tone = improved ? "text-success" : "text-destructive";
  const Icon = down ? ArrowDown : ArrowUp;
  return (
    <span className={`inline-flex items-center gap-0.5 ${tone}`}>
      <Icon className="w-3.5 h-3.5" />
      {Math.abs(value)}
      {unit}
    </span>
  );
}

function KpiShell({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-card border border-border rounded-2xl p-5 ${className}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
      {children}
    </div>
  );
}

function Insight({
  icon: Icon,
  tone,
  text,
}: {
  icon: typeof Zap;
  tone: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <p className="text-sm text-foreground/90 leading-snug">{text}</p>
    </div>
  );
}

function TrendCard({
  title,
  points,
  format,
  currentTone,
  enoughHistory,
  currentValue,
}: {
  title: string;
  points: { label: string; value: number; display: string }[];
  format: string;
  currentTone: string;
  enoughHistory: boolean;
  currentValue: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">
        {title}
        <Info className="w-3.5 h-3.5 text-muted-foreground" />
      </h3>
      {enoughHistory ? (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={points} margin={{ top: 22, right: 24, left: 24, bottom: 2 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickMargin={8}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ r: 4, fill: "var(--color-primary)" }}
              isAnimationActive={false}
            >
              <LabelList dataKey="display" position="top" fontSize={12} fill="var(--color-muted-foreground)" />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[150px] flex flex-col items-center justify-center text-center">
          <p className={`text-3xl font-display font-bold ${currentTone}`}>{currentValue}</p>
          <p className="text-xs text-muted-foreground mt-1">Current {format}</p>
          <p className="text-[11px] text-muted-foreground mt-2 max-w-[220px]">
            Long-term trend appears as more CGM history is collected.
          </p>
        </div>
      )}
    </div>
  );
}

export function ChartPanel({
  data,
  historyLoading = false,
  onNeedHistoryDays,
}: {
  data: PatientSnapshot;
  /** True while the durable CGM history is still arriving. */
  historyLoading?: boolean;
  /** Ask the page to load at least this many days of history. */
  onNeedHistoryDays?: (days: number) => void;
}) {
  const [, setLocation] = useLocation();
  const [rangeDays, setRangeDays] = useState(30);
  const pickRange = (d: number) => {
    setRangeDays(d);
    // The "vs prior period" deltas compare against the window before this one, so load twice.
    onNeedHistoryDays?.(d * 2);
  };
  const zones = useMemo(() => zonesFromSnapshot(data), [data]);
  const readings = useMemo(
    () =>
      [...(data.glucoseReadings ?? [])].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [data],
  );

  const latestMs = readings.length
    ? new Date(readings[readings.length - 1].timestamp).getTime()
    : Date.now();
  const earliestMs = readings.length ? new Date(readings[0].timestamp).getTime() : latestMs;
  const dataSpanDays = (latestMs - earliestMs) / DAY;

  const rangeMs = rangeDays * DAY;
  const rangeStart = latestMs - rangeMs;
  const displayStart = Math.max(rangeStart, earliestMs);
  const domain: [number, number] = [displayStart, latestMs];

  const cur = useMemo(() => statsFor(readings, zones, rangeStart, latestMs), [readings, zones, rangeStart, latestMs]);
  const prev = useMemo(
    () => statsFor(readings, zones, rangeStart - rangeMs, rangeStart),
    [readings, zones, rangeStart, rangeMs],
  );

  // Data completeness over the window we actually have data for (sensor uptime).
  const spanDays = Math.max(1, Math.round((latestMs - displayStart) / DAY));
  const expected = Math.max(1, Math.round((latestMs - displayStart) / (5 * 60_000)));
  const completeness = cur.count ? Math.min(100, Math.round((cur.count / expected) * 100)) : 0;
  const capturedDays = ((completeness / 100) * spanDays).toFixed(1);

  const gmiStr = cur.gmi != null ? cur.gmi.toFixed(1) : "--";
  const gmiHigh = cur.gmi != null && cur.gmi > 7;
  const gmiDelta = cur.gmi != null && prev.gmi != null ? +(cur.gmi - prev.gmi).toFixed(1) : null;
  const avgDelta = cur.avg != null && prev.avg != null ? cur.avg - prev.avg : null;

  // Overnight (12–6 AM) stability over the range.
  const overnight = useMemo(() => {
    const vals = readings
      .filter((r) => {
        const t = new Date(r.timestamp).getTime();
        if (t < rangeStart || t > latestMs) return false;
        const h = new Date(r.timestamp).getHours();
        return h >= 0 && h < 6;
      })
      .map((r) => r.value);
    if (!vals.length) return null;
    return { lows: vals.some((v) => v < zones.low), count: vals.length };
  }, [readings, zones, rangeStart, latestMs]);

  const insights = useMemo(() => {
    const out: { icon: typeof Zap; tone: string; text: string }[] = [];
    if (cur.gmi != null) {
      out.push(
        gmiHigh
          ? { icon: TrendingUp, tone: "text-destructive border-destructive/30 bg-destructive/10", text: "Estimated A1C remains elevated." }
          : { icon: CheckCircle2, tone: "text-success border-success/30 bg-success/10", text: "Estimated A1C is within target range." },
      );
    }
    if ((cur.tar ?? 0) > 30) {
      out.push({
        icon: Zap,
        tone: "text-warning border-warning/30 bg-warning/10",
        text: "Post-meal spikes are contributing to high average glucose.",
      });
    }
    if (overnight) {
      out.push(
        overnight.lows
          ? { icon: Zap, tone: "text-warning border-warning/30 bg-warning/10", text: "Overnight lows detected between 12–6 AM." }
          : { icon: CheckCircle2, tone: "text-success border-success/30 bg-success/10", text: "Overnight glucose is stable with minimal lows." },
      );
    }
    if (avgDelta != null) {
      out.push(
        avgDelta < 0
          ? { icon: Info, tone: "text-primary border-primary/30 bg-primary/10", text: `Average glucose improved compared to the prior ${rangeLabel(rangeDays)}.` }
          : { icon: Info, tone: "text-warning border-warning/30 bg-warning/10", text: `Average glucose rose compared to the prior ${rangeLabel(rangeDays)}.` },
      );
    }
    return out;
  }, [cur.gmi, cur.tar, gmiHigh, overnight, avgDelta, rangeDays]);

  // Long-term trend points (only buckets the data actually spans).
  const buildTrend = (project: (s: Stats) => number | null, fmt: (v: number) => string) => {
    const pts = [365, 180, 90, 30]
      .filter((d) => dataSpanDays >= d)
      .map((d) => {
        const v = project(statsFor(readings, zones, latestMs - d * DAY, latestMs));
        return v == null ? null : { label: `${d}D`, value: +v.toFixed(2), display: fmt(v) };
      })
      .filter(Boolean) as { label: string; value: number; display: string }[];
    const curV = project(statsFor(readings, zones, latestMs - 14 * DAY, latestMs));
    if (curV != null) pts.push({ label: "Current", value: +curV.toFixed(2), display: fmt(curV) });
    return pts;
  };
  const a1cPoints = buildTrend((s) => s.gmi, (v) => `${v.toFixed(1)}%`);
  const avgPoints = buildTrend((s) => s.avg, (v) => `${Math.round(v)}`);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiShell label="Estimated A1C (GMI)" className="ring-1 ring-primary/10">
          <div className="flex items-center gap-2">
            <span className={`text-4xl font-display font-bold ${gmiHigh ? "text-destructive" : "text-success"}`}>
              {gmiStr}%
            </span>
            {cur.gmi != null && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  gmiHigh
                    ? "bg-destructive/15 text-destructive border-destructive/30"
                    : "bg-success/15 text-success border-success/30"
                }`}
              >
                {gmiHigh ? "High" : "On target"}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {prev.gmi != null ? (
              <>
                Previous {rangeLabel(rangeDays)}: {prev.gmi.toFixed(1)}%{" "}
                {gmiDelta != null && gmiDelta !== 0 && <Delta value={gmiDelta} unit="%" />}
              </>
            ) : (
              "No prior-period data yet"
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Goal: &lt; 7.0%</p>
          <LabA1cRecord snapshot={data} accessCode={data.accessCode} estimated={cur.gmi} />
        </KpiShell>

        <KpiShell label="Average Glucose">
          <p className="text-4xl font-display font-bold text-foreground">
            {cur.avg ?? "--"}
            <span className="text-base font-normal text-muted-foreground ml-1">mg/dL</span>
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {prev.avg != null ? (
              <>
                Previous {rangeLabel(rangeDays)}: {prev.avg} mg/dL
              </>
            ) : (
              "No prior-period data yet"
            )}
          </p>
          <p className="text-xs mt-0.5">
            {avgDelta != null && avgDelta !== 0 ? (
              <Delta value={avgDelta} unit=" mg/dL" />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </KpiShell>

        <KpiShell label="Time in Range">
          <p
            className={`text-4xl font-display font-bold ${
              cur.tir == null
                ? "text-muted-foreground"
                : cur.tir >= 70
                  ? "text-success"
                  : cur.tir >= 50
                    ? "text-warning"
                    : "text-destructive"
            }`}
          >
            {cur.tir != null ? `${cur.tir}%` : "--"}
          </p>
          <p className="text-sm text-muted-foreground mt-2">Goal: &gt; 70%</p>
          <p className="text-xs text-muted-foreground mt-0.5">{zones.low}–{zones.high} mg/dL</p>
        </KpiShell>

        <KpiShell label="Data Completeness">
          <div className="flex items-center gap-4">
            <span className={completeness >= 80 ? "text-success" : completeness >= 50 ? "text-warning" : "text-destructive"}>
              <Ring pct={completeness} />
            </span>
            <div>
              <p className="text-sm text-foreground font-medium">
                {capturedDays} / {spanDays} days
              </p>
              <p className="text-xs text-muted-foreground">CGM data captured</p>
            </div>
          </div>
        </KpiShell>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div
          data-tour="range"
          className="flex items-center gap-1 bg-card border border-border rounded-xl p-1"
        >
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => pickRange(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                rangeDays === d
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-sm text-foreground">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          {fmtDate(displayStart)} – {fmtDate(latestMs, true)}
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Chart + insights */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="font-medium text-foreground flex items-center gap-2 mb-4">
              Glucose Over Time
              <Info className="w-4 h-4 text-muted-foreground" />
            </h3>
            {historyLoading ? (
              <p className="text-xs text-muted-foreground mb-2">Loading full history…</p>
            ) : (
              dataSpanDays < rangeDays &&
              readings.length > 0 && (
                <p className="text-xs text-muted-foreground mb-2">
                  Showing all available data ({spanDays} day{spanDays === 1 ? "" : "s"}).
                </p>
              )
            )}
            <GlucoseTrendChart readings={readings} zones={zones} domain={domain} height={380} />
            <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-0.5 rounded bg-primary" /> Glucose (mg/dL)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-5 border-t-2 border-dashed border-[var(--chart-avg)]" /> Average Glucose
              </span>
            </div>
          </div>

          {/* Trend cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <TrendCard
              title="A1C (GMI) Over Time"
              points={a1cPoints}
              format="A1C / GMI"
              currentTone={gmiHigh ? "text-destructive" : "text-success"}
              enoughHistory={a1cPoints.length >= 2}
              currentValue={`${gmiStr}%`}
            />
            <TrendCard
              title="Average Glucose Over Time (mg/dL)"
              points={avgPoints}
              format="average glucose"
              currentTone="text-foreground"
              enoughHistory={avgPoints.length >= 2}
              currentValue={`${cur.avg ?? "--"}`}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            GMI (Estimated A1C) is calculated from CGM data. Not a lab test. Use clinical judgment.
          </p>
        </div>

        {/* Insights */}
        <div data-tour="insights" className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-4">
            <LineChartIcon className="w-4 h-4 text-primary" /> Insights
          </h3>
          {insights.length ? (
            <div className="space-y-4">
              {insights.map((ins, i) => (
                <Insight key={i} icon={ins.icon} tone={ins.tone} text={ins.text} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No insights for this range yet.</p>
          )}
          <button
            onClick={() => setLocation(`/patient/${data.accessCode}/overview`)}
            className="w-full mt-5 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-secondary transition-colors"
          >
            View Full Insights Report <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
