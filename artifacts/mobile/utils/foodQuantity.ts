/**
 * "How many?" on a food result (pure, unit-tested). A photo of one waffle when she ate three: pick 3
 * and the carbs (and fat, protein) triple. Barcode results already used this as "servings".
 */

/** Whole count, 1 to 99, from whatever the picker holds. */
export function parseCount(text: string): number {
  const n = Math.round(parseFloat(text));
  return Number.isFinite(n) && n >= 1 ? Math.min(99, n) : 1;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The carbs for a new count, starting from what the card shows now for the old count. Going from the
 * shown number (not the AI's first guess) keeps any correction the person typed: 20 g corrected for
 * one waffle becomes 60 g for three, not three times the AI's guess.
 */
export function carbsForCount(shownCarbs: number, oldCount: number, newCount: number): number {
  const each = oldCount > 0 ? shownCarbs / oldCount : shownCarbs;
  return r1(each * newCount);
}

/** Fat or protein for a count, from the one-item value. */
export function scaleOptional(each: number | undefined, count: number): number | undefined {
  return each == null ? undefined : r1(each * count);
}

/** The logged name: "Waffle" for one, "3 × Waffle" for three. */
export function nameWithCount(name: string, count: number): string {
  const n = name.trim();
  return count > 1 && n ? `${count} × ${n}` : n;
}

/** Carbs for ONE, for remembering a favorite: a favorite keeps the single-item number. */
export function carbsForOne(totalCarbs: number, count: number): number {
  return count > 1 ? r1(totalCarbs / count) : totalCarbs;
}
