/**
 * Carbs given to treat a low ("Treated a Low", logged as "Low treated: 4 glucose tabs") are there to
 * RAISE the number, so the dose calculator must never suggest insulin to cover them. They still count
 * everywhere else (carbs still working, logs, the recap).
 *
 * Medical-critical: this only ever removes carbs from the dose math, which can only lower a suggestion.
 */
export const LOW_TREATMENT_PREFIX = "Low treated: ";

export function isLowTreatment(entry: { foodName?: string | null }): boolean {
  return (entry.foodName ?? "").toLowerCase().startsWith(LOW_TREATMENT_PREFIX.toLowerCase());
}

/** The food log for the dose calculator: everything except low treatments. */
export function withoutLowTreatments<T extends { foodName?: string | null }>(log: T[]): T[] {
  return log.filter((f) => !isLowTreatment(f));
}
