export interface InsulinOption {
  name: string;
  concentration: string;
  type: "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";
  genericName: string;
}

export const INSULIN_OPTIONS: InsulinOption[] = [
  { name: "Humalog",          concentration: "100 u/mL", type: "rapid",        genericName: "lispro"    },
  { name: "Lispro Junior",    concentration: "100 u/mL", type: "rapid",        genericName: "lispro"    },
  { name: "NovoLog",          concentration: "100 u/mL", type: "rapid",        genericName: "aspart"    },
  { name: "Apidra",           concentration: "100 u/mL", type: "rapid",        genericName: "glulisine" },
  { name: "FIASP",            concentration: "100 u/mL", type: "rapid",        genericName: "aspart"    },
  { name: "Lantus",           concentration: "100 u/mL", type: "long",         genericName: "glargine"  },
  { name: "Basaglar",         concentration: "100 u/mL", type: "long",         genericName: "glargine"  },
  { name: "Toujeo",           concentration: "300 u/mL", type: "ultra-long",   genericName: "glargine"  },
  { name: "Levemir",          concentration: "100 u/mL", type: "long",         genericName: "detemir"   },
  { name: "Tresiba",          concentration: "100 u/mL", type: "ultra-long",   genericName: "degludec"  },
  { name: "Humulin R",        concentration: "100 u/mL", type: "regular",      genericName: "insulin"   },
  { name: "Novolin R",        concentration: "100 u/mL", type: "regular",      genericName: "insulin"   },
  { name: "Humulin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH"       },
  { name: "Novolin N",        concentration: "100 u/mL", type: "intermediate", genericName: "NPH"       },
  { name: "Humalog Mix 75/25",concentration: "100 u/mL", type: "premixed",     genericName: "lispro mix"},
  { name: "NovoLog Mix 70/30",concentration: "100 u/mL", type: "premixed",     genericName: "aspart mix"},
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
