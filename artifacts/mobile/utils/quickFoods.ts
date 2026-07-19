/**
 * Quick Lookup list maintenance: saving an analyzed food puts it first and drops the last item,
 * so the list length stays constant. Re-saving a name already on the list just moves it to the
 * front (case-insensitive) instead of duplicating.
 */
export const DEFAULT_QUICK_FOODS = ["Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Pasta", "Milk"];
export function insertQuickFood(list: string[], name: string, maxLen: number): string[] {
  const trimmed = name.trim();
  if (!trimmed) return list.slice(0, maxLen);
  const withoutExisting = list.filter((f) => f.trim().toLowerCase() !== trimmed.toLowerCase());
  return [trimmed, ...withoutExisting].slice(0, maxLen);
}

/** Parse a stored Quick Lookup list; null when the payload isn't a usable string array. */
export function parseStoredQuickFoods(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const foods = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return foods.length > 0 ? foods : null;
  } catch {
    return null;
  }
}
