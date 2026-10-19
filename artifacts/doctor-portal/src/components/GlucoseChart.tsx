import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import type { CGMReading } from "@doctor-portal/api-client-react";
import { formatTime, formatDate } from "@/lib/utils";
import { glucoseStatus, STATUS_META, type GlucoseZones } from "@/lib/glucose-metrics";

interface TooltipProps {
  active?: boolean;
  payload?: { value: number; payload: { d: string; t: string } }[];
  zones: GlucoseZones;
}

function GlucoseTooltip({ active, payload, zones }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  const meta = STATUS_META[glucoseStatus(v, zones)];
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">
        {payload[0].payload.d} · {payload[0].payload.t}
      </p>
      <p className={`text-xl font-display font-bold ${meta.text}`}>
        {v} <span className="text-xs font-normal text-muted-foreground">mg/dL</span>
      </p>
      <p className={`text-xs ${meta.text}`}>{meta.label}</p>
    </div>
  );
}

/** Clinical CGM line chart with target-range zone shading and threshold lines. */
export function GlucoseChart({
  readings,
  zones,
  height = 300,
}: {
  readings: CGMReading[];
  zones: GlucoseZones;
  height?: number;
}) {
  if (!readings.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-xl"
        style={{ height }}
      >
        No CGM data to display yet.
      </div>
    );
  }

  const data = [...readings]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((r) => ({
      value: r.value,
      t: formatTime(r.timestamp),
      d: formatDate(r.timestamp),
    }));
  const peak = Math.max(zones.urgentHigh + 20, ...data.map((d) => d.value));
  const yMax = Math.ceil((peak + 10) / 50) * 50;
  const ticks: number[] = [];
  for (let v = 100; v < yMax; v += 100) ticks.push(v);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <ReferenceArea y1={zones.urgentHigh} y2={yMax} fill={STATUS_META.urgentHigh.hex} fillOpacity={0.1} />
        <ReferenceArea y1={zones.high} y2={zones.urgentHigh} fill={STATUS_META.high.hex} fillOpacity={0.1} />
        <ReferenceArea y1={zones.low} y2={zones.high} fill={STATUS_META.target.hex} fillOpacity={0.14} />
        <ReferenceArea y1={zones.urgentLow} y2={zones.low} fill={STATUS_META.low.hex} fillOpacity={0.12} />
        <ReferenceArea y1={40} y2={zones.urgentLow} fill={STATUS_META.urgentLow.hex} fillOpacity={0.1} />
        <XAxis dataKey="t" stroke="var(--color-muted-foreground)" fontSize={11} tickMargin={8} minTickGap={56} />
        <YAxis
          stroke="var(--color-muted-foreground)"
          fontSize={11}
          tickMargin={6}
          domain={[40, yMax]}
          ticks={ticks}
          width={40}
        />
        <Tooltip content={(p) => <GlucoseTooltip {...(p as object)} zones={zones} />} />
        <ReferenceLine y={zones.high} stroke={STATUS_META.high.hex} strokeOpacity={0.5} strokeDasharray="4 4" />
        <ReferenceLine y={zones.low} stroke={STATUS_META.low.hex} strokeOpacity={0.5} strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-primary)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: "var(--color-primary)", stroke: "var(--color-card)", strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
