/**
 * Quick Lookup list maintenance. A quick food is a name plus (when known) its carbs, so the Food
 * page can show "28 g carbs" beside it. Older stored lists were plain name strings — every reader
 * here accepts both shapes. The list has no practical length cap: the Food page shows the first
 * QUICK_LOOKUP_VISIBLE, and the "See All" window shows and manages the whole list.
 */
export type QuickFood = { name: string; carbs?: number };

/** How many quick foods the Food page itself shows; the rest live behind "See All". */
export const QUICK_LOOKUP_VISIBLE = 8;

/** Starter list for a fresh account (typical serving carbs; a lookup refines them on first tap). */
export const DEFAULT_QUICK_FOODS: QuickFood[] = [
  { name: "Apple", carbs: 25 },
  { name: "Pizza", carbs: 36 },
  { name: "Rice", carbs: 45 },
  { name: "Banana", carbs: 27 },
  { name: "Sandwich", carbs: 34 },
  { name: "Oatmeal", carbs: 27 },
  { name: "Pasta", carbs: 43 },
  { name: "Milk", carbs: 12 },
];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One item from either shape (a legacy name string or a {name, carbs} object); null if unusable. */
export function normalizeQuickFood(x: unknown): QuickFood | null {
  if (typeof x === "string") {
    const name = x.trim();
    return name ? { name } : null;
  }
  if (x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string") {
    const name = (x as { name: string }).name.trim();
    if (!name) return null;
    const carbs = (x as { carbs?: unknown }).carbs;
    return typeof carbs === "number" && Number.isFinite(carbs) && carbs >= 0 ? { name, carbs } : { name };
  }
  return null;
}

/**
 * Put a food first. Re-saving a name already on the list moves it to the front (case-insensitive)
 * instead of duplicating; carbs given now win, otherwise the ones already stored are kept.
 */
export function insertQuickFood(list: QuickFood[], item: QuickFood | string, maxLen = Infinity): QuickFood[] {
  const incoming = normalizeQuickFood(item);
  if (!incoming) return list.slice(0, maxLen);
  const existing = list.find((f) => sameName(f.name, incoming.name));
  const merged: QuickFood =
    incoming.carbs != null ? incoming : existing?.carbs != null ? { name: incoming.name, carbs: existing.carbs } : incoming;
  return [merged, ...list.filter((f) => !sameName(f.name, incoming.name))].slice(0, maxLen);
}

/** Record carbs for a food already on the list, in place; the list is returned unchanged otherwise. */
export function updateQuickFoodCarbs(list: QuickFood[], name: string, carbs: number): QuickFood[] {
  if (!Number.isFinite(carbs) || carbs < 0) return list;
  const i = list.findIndex((f) => sameName(f.name, name));
  if (i < 0 || list[i]!.carbs === carbs) return list;
  const next = list.slice();
  next[i] = { name: list[i]!.name, carbs };
  return next;
}

export function removeQuickFood(list: QuickFood[], name: string): QuickFood[] {
  return list.filter((f) => !sameName(f.name, name));
}

/** Move the item at `from` to position `to` (indices clamped); other items keep their order. */
export function moveQuickFood(list: QuickFood[], from: number, to: number): QuickFood[] {
  if (list.length === 0) return list;
  const a = Math.max(0, Math.min(list.length - 1, from));
  const b = Math.max(0, Math.min(list.length - 1, to));
  if (a === b) return list;
  const next = list.slice();
  const [item] = next.splice(a, 1);
  next.splice(b, 0, item!);
  return next;
}

export function quickFoodNames(list: QuickFood[]): string[] {
  return list.map((f) => f.name);
}

/** Parse a stored Quick Lookup list (either shape); null when the payload isn't a usable list. */
export function parseStoredQuickFoods(raw: string | null): QuickFood[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const foods = parsed.map(normalizeQuickFood).filter((f): f is QuickFood => f != null);
    return foods.length > 0 ? foods : null;
  } catch {
    return null;
  }
}

/**
 * The circle's list as the server hands it over: prefer the items (with carbs), fall back to the
 * names-only field an older app version may have written last. Null when the server has neither.
 */
export function quickFoodsFromServer(items: unknown, names: unknown): QuickFood[] | null {
  if (Array.isArray(items)) {
    const parsed = items.map(normalizeQuickFood).filter((f): f is QuickFood => f != null);
    if (parsed.length > 0) return parsed;
  }
  if (Array.isArray(names)) {
    const parsed = names.map(normalizeQuickFood).filter((f): f is QuickFood => f != null);
    return parsed.length > 0 ? parsed : [];
  }
  return null;
}
