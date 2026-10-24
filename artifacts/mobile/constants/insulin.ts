/** How the insulin comes: a pen, or a vial drawn up with a syringe. */
export type InsulinForm = "pen" | "vial";
export const INSULIN_FORMS: readonly InsulinForm[] = ["pen", "vial"];

export interface InsulinOption {
  name: string;
  concentration: string;
  type: "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";
  genericName: string;
  /** Which of pen / vial it is sold as (US labels). */
  forms: readonly InsulinForm[];
}

const BOTH: readonly InsulinForm[] = ["pen", "vial"];
const PEN_ONLY: readonly InsulinForm[] = ["pen"];
const VIAL_ONLY: readonly InsulinForm[] = ["vial"];

export const INSULIN_OPTIONS: InsulinOption[] = [
  { name: "Humalog",          concentration: "100 u/mL", type: "rapid",        genericName: "lispro", forms: BOTH },
  { name: "Lispro Junior",    concentration: "100 u/mL", type: "rapid",        genericName: "lispro", forms: PEN_ONLY },
  { name: "NovoLog",          concentration: "100 u/mL", type: "rapid",        genericName: "aspart", forms: BOTH },
  { name: "Apidra",           concentration: "100 u/mL", type: "rapid",        genericName: "glulisine", forms: BOTH },
  { name: "FIASP",            concentration: "100 u/mL", type: "rapid",        genericName: "aspart", forms: BOTH },
  { name: "Lantus",           concentration: "100 u/mL", type: "long",         genericName: "glargine", forms: BOTH },
  { name: "Basaglar",         concentration: "100 u/mL", type: "long",         genericName: "glargine", forms: PEN_ONLY },
  { name: "Toujeo",           concentration: "300 u/mL", type: "ultra-long",   genericName: "glargine", forms: PEN_ONLY },
  { name: "Levemir",          concentration: "100 u/mL", type: "long",         genericName: "detemir", forms: BOTH },
  { name: "Tresiba",          concentration: "100 u/mL", type: "ultra-long",   genericName: "degludec", forms: BOTH },
  { name: "Humulin R",        concentration: "100 u/mL", type: "regular",      genericName: "insulin", forms: VIAL_ONLY },
  { name: "Novolin R",        concentration: "100 u/mL", type: "regular",      genericName: "insulin", forms: BOTH },
  { name: "Humulin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH", forms: BOTH },
  { name: "Novolin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH", forms: BOTH },
  { name: "Humalog Mix 75/25",concentration: "100 u/mL", type: "premixed",     genericName: "lispro mix", forms: BOTH },
  { name: "NovoLog Mix 70/30",concentration: "100 u/mL", type: "premixed",     genericName: "aspart mix", forms: BOTH },
];

export const INSULIN_TYPE_LABEL: Record<InsulinOption["type"], string> = {
  "rapid":        "Rapid-Acting",
  "regular":      "Short-Acting",
  "intermediate": "Intermediate",
  "long":         "Long-Acting",
  "ultra-long":   "Ultra-Long",
  "premixed":     "Pre-Mixed",
};

export function insulinChipLabel(opt: InsulinOption): string {
  return `${opt.name} · ${opt.concentration}`;
}

/** Resolve a stored profile chip label (e.g. "Humalog · 100 u/mL") back to its option. */
export function findInsulinByChipLabel(label: string): InsulinOption | undefined {
  return INSULIN_OPTIONS.find((opt) => insulinChipLabel(opt) === label);
}

/** Mealtime/correction-capable insulins — basal (intermediate/long/ultra-long) are excluded. */
export function isBolusInsulin(type: InsulinOption["type"]): boolean {
  return type === "rapid" || type === "regular" || type === "premixed";
}

/** Compact "name · acting class" line, e.g. "Humalog · Rapid-Acting". */
export function insulinDisplayLabel(opt: InsulinOption): string {
  return `${opt.name} · ${INSULIN_TYPE_LABEL[opt.type]}`;
}

/**
 * Default calculator selection from the profile's configured chip labels: first bolus-capable
 * insulin wins (it's a mealtime-dose calculator), otherwise the first configured one.
 */
export function defaultInsulinChipLabel(configured: string[] | undefined): string | null {
  if (!configured || configured.length === 0) return null;
  const bolus = configured.find((label) => {
    const opt = findInsulinByChipLabel(label);
    return opt != null && isBolusInsulin(opt.type);
  });
  return bolus ?? configured[0];
}
