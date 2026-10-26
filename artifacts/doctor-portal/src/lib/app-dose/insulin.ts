/**
 * MIRROR of glucose_guardian artifacts/mobile/constants/insulin.ts (at b465fdc) so the portal calculates
 * doses exactly the way the app does. Do not change the math here: when the app’s file changes,
 * copy it over again. Only the import lines differ from the original.
 */
/** How the insulin comes: a pen, or a vial drawn up with a syringe. */
export type InsulinForm = "pen" | "vial";
export const INSULIN_FORMS: readonly InsulinForm[] = ["pen", "vial"];

/** One way an insulin is sold: the device name and how many days it's good for once opened. */
export interface InsulinPack {
  /** "KwikPen", "FlexPen", "SoloStar", "FlexTouch", "Pen" or "Vial". */
  device: string;
  /** Days good for once opened, at room temperature, per the product label. */
  days: number;
}

export interface InsulinOption {
  name: string;
  concentration: string;
  type: "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";
  genericName: string;
  /** Sold as a pen (US). Missing = not sold as a pen. */
  pen?: InsulinPack;
  /** Sold as a vial (US). Missing = not sold as a vial. */
  vial?: InsulinPack;
  /** No longer sold in the US: kept so accounts that use it still work, hidden from new picks. */
  discontinued?: boolean;
}

/**
 * US insulins (U-100 and Toujeo U-300), each with the pen and/or vial it actually comes in and the
 * in-use days from its label (pharmacy insulin storage chart, 2025; Tresiba FlexTouch, Toujeo and
 * Humalog Junior KwikPen from their labels). Concentrated U-200 / U-500 products are left out on
 * purpose: their units and syringes work differently.
 *
 * Existing names never change: the stored label is "name · concentration".
 */
export const INSULIN_OPTIONS: InsulinOption[] = [
  // Rapid-acting
  { name: "Humalog",          concentration: "100 u/mL", type: "rapid", genericName: "lispro",       pen: { device: "KwikPen", days: 28 },   vial: { device: "Vial", days: 28 } },
  { name: "Lispro Junior",    concentration: "100 u/mL", type: "rapid", genericName: "lispro",       pen: { device: "Junior KwikPen", days: 28 } },
  { name: "Insulin Lispro",   concentration: "100 u/mL", type: "rapid", genericName: "lispro",       pen: { device: "KwikPen", days: 28 },   vial: { device: "Vial", days: 28 } },
  { name: "Admelog",          concentration: "100 u/mL", type: "rapid", genericName: "lispro",       pen: { device: "SoloStar", days: 28 },  vial: { device: "Vial", days: 28 } },
  { name: "Lyumjev",          concentration: "100 u/mL", type: "rapid", genericName: "lispro-aabc",  pen: { device: "KwikPen", days: 28 },   vial: { device: "Vial", days: 28 } },
  { name: "NovoLog",          concentration: "100 u/mL", type: "rapid", genericName: "aspart",       pen: { device: "FlexPen", days: 28 },   vial: { device: "Vial", days: 28 } },
  { name: "Insulin Aspart",   concentration: "100 u/mL", type: "rapid", genericName: "aspart",       pen: { device: "FlexPen", days: 28 },   vial: { device: "Vial", days: 28 } },
  { name: "FIASP",            concentration: "100 u/mL", type: "rapid", genericName: "aspart",       pen: { device: "FlexTouch", days: 28 }, vial: { device: "Vial", days: 28 } },
  { name: "Apidra",           concentration: "100 u/mL", type: "rapid", genericName: "glulisine",    pen: { device: "SoloStar", days: 28 },  vial: { device: "Vial", days: 28 } },
  // Long-acting
  { name: "Lantus",           concentration: "100 u/mL", type: "long", genericName: "glargine",      pen: { device: "SoloStar", days: 28 },  vial: { device: "Vial", days: 28 } },
  { name: "Basaglar",         concentration: "100 u/mL", type: "long", genericName: "glargine",      pen: { device: "KwikPen", days: 28 } },
  { name: "Semglee",          concentration: "100 u/mL", type: "long", genericName: "glargine-yfgn", pen: { device: "Pen", days: 28 },       vial: { device: "Vial", days: 28 } },
  { name: "Rezvoglar",        concentration: "100 u/mL", type: "long", genericName: "glargine-aglr", pen: { device: "KwikPen", days: 28 } },
  { name: "Levemir",          concentration: "100 u/mL", type: "long", genericName: "detemir",       pen: { device: "FlexPen", days: 42 },   vial: { device: "Vial", days: 42 }, discontinued: true },
  // Ultra-long
  { name: "Toujeo",           concentration: "300 u/mL", type: "ultra-long", genericName: "glargine", pen: { device: "SoloStar", days: 56 } },
  { name: "Tresiba",          concentration: "100 u/mL", type: "ultra-long", genericName: "degludec", pen: { device: "FlexTouch", days: 56 }, vial: { device: "Vial", days: 56 } },
  // Short-acting (regular)
  { name: "Humulin R",        concentration: "100 u/mL", type: "regular", genericName: "insulin",    vial: { device: "Vial", days: 31 } },
  { name: "Novolin R",        concentration: "100 u/mL", type: "regular", genericName: "insulin",    pen: { device: "FlexPen", days: 28 },   vial: { device: "Vial", days: 42 } },
  // Intermediate (NPH)
  { name: "Humulin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH",   pen: { device: "KwikPen", days: 14 },   vial: { device: "Vial", days: 31 } },
  { name: "Novolin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH",   pen: { device: "FlexPen", days: 28 },   vial: { device: "Vial", days: 42 } },
  // Pre-mixed
  { name: "Humalog Mix 75/25",concentration: "100 u/mL", type: "premixed", genericName: "lispro mix", pen: { device: "KwikPen", days: 10 },  vial: { device: "Vial", days: 28 } },
  { name: "Humalog Mix 50/50",concentration: "100 u/mL", type: "premixed", genericName: "lispro mix", pen: { device: "KwikPen", days: 10 } },
  { name: "NovoLog Mix 70/30",concentration: "100 u/mL", type: "premixed", genericName: "aspart mix", pen: { device: "FlexPen", days: 14 },  vial: { device: "Vial", days: 28 } },
  { name: "Humulin 70/30",    concentration: "100 u/mL", type: "premixed", genericName: "NPH/regular", pen: { device: "KwikPen", days: 10 }, vial: { device: "Vial", days: 31 } },
  { name: "Novolin 70/30",    concentration: "100 u/mL", type: "premixed", genericName: "NPH/regular", pen: { device: "FlexPen", days: 28 }, vial: { device: "Vial", days: 42 } },
];

/** The pen or vial this insulin comes as, or undefined when it isn't sold that way. */
export function insulinPack(opt: InsulinOption, form: InsulinForm): InsulinPack | undefined {
  return form === "pen" ? opt.pen : opt.vial;
}

/** Forms this insulin is sold as. */
export function insulinForms(opt: InsulinOption): InsulinForm[] {
  return INSULIN_FORMS.filter((f) => insulinPack(opt, f) != null);
}

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
