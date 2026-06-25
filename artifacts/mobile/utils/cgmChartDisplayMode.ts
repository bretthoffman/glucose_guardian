export type GraphDisplayMode = "line" | "dots";

export const DEFAULT_GRAPH_DISPLAY_MODE: GraphDisplayMode = "line";

/** Parse persisted graph display mode; unknown or missing values default to line. */
export function parseGraphDisplayMode(raw: string | null | undefined): GraphDisplayMode {
  return raw === "dots" ? "dots" : DEFAULT_GRAPH_DISPLAY_MODE;
}
