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
  Customized,
} from "recharts";
import type { CGMReading } from "@doctor-portal/api-client-react";
import { glucoseStatus, STATUS_META, type GlucoseZones } from "@/lib/glucose-metrics";
import type { DayMarker } from "@/lib/day-review";

const MARKER_COLOR: Record<DayMarker["kind"], string> = {
  meal: STATUS_META.target.hex,
  correction: "#A855F7",
  insulin: "var(--color-primary)",
};

function formatHourTick(ts: number): string {
  const h = new Date(ts).getHours();
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface TooltipProps {
  active?: boolean;
  payload?: { value: number; payload: { ts: number } }[];
  zones: GlucoseZones;
}

function GlucoseTooltip({ active, payload, zones }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  const meta = STATUS_META[glucoseStatus(v, zones)];
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{formatClock(payload[0].payload.ts)}</p>
      <p className={`text-xl font-display font-bold ${meta.text}`}>
        {v} <span className="text-xs font-normal text-muted-foreground">mg/dL</span>
      </p>
      <p className={`text-xs ${meta.text}`}>{meta.label}</p>
    </div>
  );
}

/**
 * Full-day CGM line with target-range shading, threshold lines, and meal / insulin / correction
 * markers placed at their exact times (numeric time axis). Labels for carbs and units sit in the
 * band beneath the plot, connecting food and dosing to the glucose response.
 */
export function DayTimelineChart({
  readings,
  markers,
  zones,
  domain,
  height = 320,
}: {
  readings: CGMReading[];
  markers: DayMarker[];
  zones: GlucoseZones;
  domain: [number, number];
  height?: number;
}) {
  const data = readings
    .map((r) => ({ ts: new Date(r.timestamp).getTime(), value: r.value }))
    .filter((d) => d.ts >= domain[0] && d.ts <= domain[1])
    .sort((a, b) => a.ts - b.ts);

  const peak = Math.max(300, zones.urgentHigh + 20, ...data.map((d) => d.value));
  const yMax = Math.ceil((peak + 10) / 50) * 50;
  const yTicks = Array.from(
    new Set([40, zones.low, zones.high, zones.urgentHigh, yMax].filter((t) => t <= yMax)),
  ).sort((a, b) => a - b);

  const span = domain[1] - domain[0];
  const step = span > 18 * 3600_000 ? 3 : span > 8 * 3600_000 ? 2 : 1;
  const xTicks: number[] = [];
  const first = new Date(domain[0]);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= domain[1]; t += step * 3600_000) {
    if (t >= domain[0]) xTicks.push(t);
  }

  const visibleMarkers = markers.filter((m) => m.ts >= domain[0] && m.ts <= domain[1]);

  // Custom SVG layer: vertical guides + carb/unit labels in the bottom band.
  const renderMarkers = (cprops: Record<string, unknown>) => {
    const xAxisMap = cprops.xAxisMap as Record<string, { scale: (v: number) => number }> | undefined;
    const offset = cprops.offset as
      | { top: number; height: number; left: number; width: number }
      | undefined;
    if (!xAxisMap || !offset) return <g />;
    const scale = Object.values(xAxisMap)[0]?.scale;
    if (!scale) return <g />;
    const top = offset.top;
    const bottom = offset.top + offset.height;
    return (
      <g>
        {visibleMarkers.map((m, i) => {
          const x = scale(m.ts);
          if (x == null || x < offset.left - 1 || x > offset.left + offset.width + 1) return null;
          const color = MARKER_COLOR[m.kind];
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={top}
                y2={bottom}
                stroke={color}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.55}
              />
              <circle cx={x} cy={bottom} r={3} fill={color} />
              <text x={x} y={bottom + 16} textAnchor="middle" fontSize={10} fill="var(--color-muted-foreground)">
                {formatClock(m.ts)}
              </text>
              {m.carbs != null && (
                <text x={x} y={bottom + 29} textAnchor="middle" fontSize={10} fill={color}>
                  {m.carbs}g
                </text>
              )}
              {m.units != null && (
                <text
                  x={x}
                  y={bottom + (m.carbs != null ? 42 : 29)}
                  textAnchor="middle"
                  fontSize={10}
                  fill={MARKER_COLOR[m.kind === "meal" ? "insulin" : m.kind]}
                >
                  {m.units}u
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-xl"
        style={{ height }}
      >
        No CGM readings for this day.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: -4, bottom: 52 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <ReferenceArea y1={zones.low} y2={zones.high} fill={STATUS_META.target.hex} fillOpacity={0.12} />
        <XAxis
          type="number"
          dataKey="ts"
          domain={domain}
          ticks={xTicks}
          tickFormatter={formatHourTick}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
          tickMargin={8}
        />
        <YAxis
          domain={[40, yMax]}
          ticks={yTicks}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
          tickMargin={6}
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
          isAnimationActive={false}
        />
        <Customized component={renderMarkers} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
