/** Persisted Home Recent Readings section expand/collapse preference. */
export function parseHomeRecentReadingsExpanded(raw: string | null | undefined): boolean {
  return raw === "true";
}

export function serializeHomeRecentReadingsExpanded(expanded: boolean): "true" | "false" {
  return expanded ? "true" : "false";
}
