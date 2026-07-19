/**
 * Day-graph log markers: each food/insulin log renders as a tiny icon sitting on the purple
 * target-glucose baseline at the log's time. Near-coincident logs stack vertically DOWNWARD from
 * the baseline instead of overlapping, and insulin always takes the top (on-line) spot.
 */
export type ChartMarkerKind = "insulin" | "food";

export interface ChartEventMarker {
  kind: ChartMarkerKind;
  timestamp: string;
}

export interface PositionedChartMarker {
  kind: ChartMarkerKind;
  /** Plot-space x of the marker's column (clusters share their anchor column). */
  x: number;
  /** 0 = directly on the baseline; 1, 2, … stack below it. */
  stackIndex: number;
}

/** Markers whose columns are within this many px join one vertical stack. */
export const CHART_MARKER_CLUSTER_PX = 12;

export function positionEventMarkers(
  markers: ChartEventMarker[],
  windowStartMs: number,
  windowMs: number,
  plotW: number,
  clusterPx: number = CHART_MARKER_CLUSTER_PX,
): PositionedChartMarker[] {
  if (windowMs <= 0 || plotW <= 0) return [];

  const inWindow = markers
    .map((m) => ({ kind: m.kind, t: new Date(m.timestamp).getTime() }))
    .filter((m) => Number.isFinite(m.t) && m.t >= windowStartMs && m.t < windowStartMs + windowMs)
    .map((m) => ({ kind: m.kind, t: m.t, x: ((m.t - windowStartMs) / windowMs) * plotW }))
    .sort((a, b) => a.x - b.x);

  const out: PositionedChartMarker[] = [];
  let i = 0;
  while (i < inWindow.length) {
    const anchorX = inWindow[i].x;
    const cluster = [inWindow[i]];
    let j = i + 1;
    while (j < inWindow.length && inWindow[j].x - anchorX <= clusterPx) {
      cluster.push(inWindow[j]);
      j++;
    }
    // Insulin outranks food for the on-line spot; ties keep chronological order.
    cluster.sort((a, b) => (a.kind === b.kind ? a.t - b.t : a.kind === "insulin" ? -1 : 1));
    cluster.forEach((m, idx) => out.push({ kind: m.kind, x: anchorX, stackIndex: idx }));
    i = j;
  }
  return out;
}
