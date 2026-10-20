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

// ── Food page Quick Lookup: Recent / Favorites ──────────────────────────────────────────────────
// "Favorites" is the saved list above (same data, new name on screen). "Recent" is derived from the
// food log — nothing new is stored.

/** True when `name` is on the saved (Favorites) list, ignoring case and outer spaces. */
export function isQuickFood(list: QuickFood[], name: string): boolean {
  return list.some((f) => sameName(f.name, name));
}

/** The saved entry for `name`, if any. */
export function findQuickFood(list: QuickFood[], name: string): QuickFood | undefined {
  return list.find((f) => sameName(f.name, name));
}

/**
 * Split a long saved name into a bold title and a smaller detail line at its first "(":
 * "Two plain toaster waffles (frozen/boxed-style)" → title "Two plain toaster waffles",
 * detail "frozen/boxed-style". Names without parentheses come back whole.
 */
export function splitFoodName(name: string): { title: string; detail?: string } {
  const trimmed = name.trim();
  const open = trimmed.indexOf("(");
  if (open <= 0) return { title: trimmed };
  const title = trimmed.slice(0, open).trim();
  const detail = trimmed.slice(open + 1).replace(/\)\s*$/, "").trim();
  if (!title) return { title: trimmed };
  return detail ? { title, detail } : { title };
}

/** Carbs as shown in a row: whole numbers stay whole, otherwise one decimal (5.5, not 5.50). */
export function formatCarbs(carbs: number): string {
  if (!Number.isFinite(carbs)) return "—";
  const r = Math.round(carbs * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export interface RecentFoodSource {
  id: string;
  timestamp: string;
  foodName: string;
  estimatedCarbs: number;
}

/**
 * The most recent DIFFERENT foods from the log, newest first: each food appears once, as its latest
 * entry (that entry is what the row's pencil edits).
 */
export function recentFoods<T extends RecentFoodSource>(log: T[], limit = QUICK_LOOKUP_VISIBLE): T[] {
  const sorted = log
    .filter((e) => e.foodName?.trim() && Number.isFinite(new Date(e.timestamp).getTime()))
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of sorted) {
    const key = e.foodName.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? "0" : ""}${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today · 8:05 AM" / "Yesterday · 7:40 PM" / "Sun · 9:00 AM" (this past week) / "Oct 3 · 9:00 AM". */
export function formatRecentWhen(timestamp: string, now: Date = new Date()): string {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  const day =
    days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? DAYS[d.getDay()] : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${day} · ${clock(d)}`;
}

/**
 * Insulin recorded WITH a logged meal (a record, not a dose recommendation): the meal's logged carbs
 * ÷ the carb ratio, to 0.1 u — the same formula the Log page's "Log Food" uses. Computed from the
 * carbs actually logged, so editing the carbs before logging can't leave a stale number behind.
 */
export function mealInsulinUnits(carbs: number, carbRatio: number): number {
  if (!Number.isFinite(carbs) || !Number.isFinite(carbRatio) || carbRatio <= 0 || carbs <= 0) return 0;
  return Math.round((carbs / carbRatio) * 10) / 10;
}

/** Favorites as the server hands them over: an array (possibly empty) → the list; anything else → null. */
export function favoritesFromServer(items: unknown): QuickFood[] | null {
  if (!Array.isArray(items)) return null;
  return items.map(normalizeQuickFood).filter((f): f is QuickFood => f != null);
}

/**
 * Rename and/or re-carb one favorite in place (the Favorites pencil). If the new name matches a
 * DIFFERENT favorite, that duplicate is dropped so the list never holds the same food twice.
 */
export function editQuickFood(list: QuickFood[], oldName: string, newName: string, carbs?: number): QuickFood[] {
  const name = newName.trim() || oldName.trim();
  const i = list.findIndex((f) => sameName(f.name, oldName));
  if (i < 0) return list;
  const edited: QuickFood =
    carbs != null && Number.isFinite(carbs) && carbs >= 0 ? { name, carbs } : list[i]!.carbs != null ? { name, carbs: list[i]!.carbs } : { name };
  return list.flatMap((f, j) => (j === i ? [edited] : sameName(f.name, name) ? [] : [f]));
}
