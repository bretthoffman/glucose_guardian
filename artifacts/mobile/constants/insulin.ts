export interface InsulinOption {
  name: string;
  concentration: string;
  type: "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";
  genericName: string;
}

export const INSULIN_OPTIONS: InsulinOption[] = [
  { name: "Humalog",          concentration: "100 u/mL", type: "rapid",        genericName: "lispro"    },
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
