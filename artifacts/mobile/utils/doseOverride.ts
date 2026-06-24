/** Filters live dose TextInput to digits + one decimal, max two fractional digits. */
export function filterDoseInputText(raw: string): string {
  let text = raw.replace(/[^0-9.]/g, "");
  const dot = text.indexOf(".");
  if (dot === -1) return text;
  const intPart = text.slice(0, dot + 1);
  const fracPart = text.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return intPart + fracPart;
}

/** True while editing — empty or nonnegative decimal with ≤2 fractional digits. */
export function isValidDoseInputText(text: string): boolean {
  if (text === "") return true;
  return /^\d*(\.\d{0,2})?$/.test(text);
}

/** Nearest 0.25 u — Math.round(value * 4) / 4 */
export function roundToQuarterUnits(value: number): number {
  return Math.round(value * 4) / 4;
}

/** Parse completed edit text; null when empty/invalid. Does not round. */
export function parseDoseInputText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const normalized = trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Parse, quarter-round, and return final override amount; null when empty/invalid. */
export function finalizeManualDoseInput(text: string): number | null {
  const parsed = parseDoseInputText(text);
  if (parsed == null) return null;
  return roundToQuarterUnits(parsed);
}

/** Display dose amount — whole numbers without decimal; .25/.5/.75 preserved. */
export function formatDoseAmount(value: number): string {
  const q = roundToQuarterUnits(value);
  if (Math.abs(q - Math.round(q)) < 1e-9) {
    return String(Math.round(q));
  }
  const fixed = q.toFixed(2);
  return fixed.replace(/(\.\d*[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

/** Stable quarter-unit equality for dose comparisons. */
export function doseAmountsEqual(a: number, b: number): boolean {
  return roundToQuarterUnits(a) === roundToQuarterUnits(b);
}

/** Normalized amount + singular/plural unit label, e.g. `1 unit` or `1.5 units`. */
export function formatDoseUnitsLabel(amount: number): string {
  const q = roundToQuarterUnits(amount);
  const unit = Math.abs(q - 1) < 1e-9 ? "unit" : "units";
  return `${formatDoseAmount(q)} ${unit}`;
}

/** Supporting copy beneath a manual override tile. */
export function formatSuggestedDoseLine(recommended: number): string {
  return `Suggested dose: ${formatDoseUnitsLabel(recommended)}`;
}
