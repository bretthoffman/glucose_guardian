import { describe, it, expect } from "vitest";
import { glucoseTone, parseThemePreference, resolveEffectiveScheme, getThemeColors, lightColors, darkColors, T, mixHex } from "./theme";

const { coral, emerald, amber } = T.color;

describe("parseThemePreference — missing/invalid → dark default", () => {
  it("missing (null/undefined) → dark", () => {
    expect(parseThemePreference(null)).toBe("dark");
    expect(parseThemePreference(undefined)).toBe("dark");
  });
  it("valid values pass through", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
  });
  it("invalid/garbage → dark", () => {
    expect(parseThemePreference("")).toBe("dark");
    expect(parseThemePreference("SYSTEM")).toBe("dark");
    expect(parseThemePreference("blue")).toBe("dark");
  });
});

describe("resolveEffectiveScheme", () => {
  it("explicit light/dark ignore the device scheme", () => {
    expect(resolveEffectiveScheme("light", "dark")).toBe("light");
    expect(resolveEffectiveScheme("dark", "light")).toBe("dark");
  });
  it("system follows the device scheme", () => {
    expect(resolveEffectiveScheme("system", "light")).toBe("light");
    expect(resolveEffectiveScheme("system", "dark")).toBe("dark");
  });
  it("system with no device scheme → dark default", () => {
    expect(resolveEffectiveScheme("system", null)).toBe("dark");
    expect(resolveEffectiveScheme("system", undefined)).toBe("dark");
  });
});

describe("theme color sets", () => {
  it("getThemeColors returns the matching set", () => {
    expect(getThemeColors("dark")).toBe(darkColors);
    expect(getThemeColors("light")).toBe(lightColors);
  });
  it("semantic health colors are IDENTICAL across light/dark (no classification drift)", () => {
    for (const k of ["emerald", "emeraldDark", "coral", "amber", "violet", "violetActive"] as const) {
      expect(lightColors[k]).toBe(darkColors[k]);
    }
  });
  it("structural colors DIFFER between light and dark", () => {
    expect(lightColors.screen).not.toBe(darkColors.screen);
    expect(lightColors.textPrimary).not.toBe(darkColors.textPrimary);
    expect(lightColors.card).not.toBe(darkColors.card);
  });
});

describe("glucoseTone — four-state classification by account thresholds", () => {
  // Account A: low 70, high 180, critical-high (urgentHigh) 250 (the attached account)
  const A = { low: 70, high: 180, urgentHigh: 250 };

  it("below the low threshold → coral", () => {
    expect(glucoseTone(54, A.low, A.high, A.urgentHigh)).toBe(coral);
    expect(glucoseTone(69, A.low, A.high, A.urgentHigh)).toBe(coral);
  });

  it("within the target range (low..high inclusive) → emerald", () => {
    expect(glucoseTone(70, A.low, A.high, A.urgentHigh)).toBe(emerald);
    expect(glucoseTone(120, A.low, A.high, A.urgentHigh)).toBe(emerald);
    expect(glucoseTone(180, A.low, A.high, A.urgentHigh)).toBe(emerald);
  });

  it("above high but below critical-high → amber (never red prematurely)", () => {
    expect(glucoseTone(181, A.low, A.high, A.urgentHigh)).toBe(amber);
    expect(glucoseTone(200, A.low, A.high, A.urgentHigh)).toBe(amber);
    expect(glucoseTone(249, A.low, A.high, A.urgentHigh)).toBe(amber);
  });

  it("at or above the critical-high threshold → coral", () => {
    expect(glucoseTone(250, A.low, A.high, A.urgentHigh)).toBe(coral);
    expect(glucoseTone(320, A.low, A.high, A.urgentHigh)).toBe(coral);
  });

  it("honors a DIFFERENT account's thresholds (not hardcoded 180/250)", () => {
    // Account B: low 80, high 160, critical-high 220
    const B = { low: 80, high: 160, urgentHigh: 220 };
    expect(glucoseTone(170, B.low, B.high, B.urgentHigh)).toBe(amber); // 170 > 160 high, < 220 → amber
    expect(glucoseTone(165, B.low, B.high, B.urgentHigh)).toBe(amber);
    expect(glucoseTone(160, B.low, B.high, B.urgentHigh)).toBe(emerald); // == high → still in range
    expect(glucoseTone(220, B.low, B.high, B.urgentHigh)).toBe(coral); // == critical → red
    expect(glucoseTone(79, B.low, B.high, B.urgentHigh)).toBe(coral); // below low → red
  });

  it("a reading of 200 stays amber under the default account thresholds", () => {
    expect(glucoseTone(200)).toBe(amber);
  });
});

describe("mixHex (the shade ramp)", () => {
  it("returns the endpoints at t=0 and t=1, clamped outside [0,1]", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mixHex("#000000", "#FFFFFF", -3)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 7)).toBe("#FFFFFF");
  });
  it("interpolates each channel independently", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#061124", "#0B1B36", 0.5)).toBe("#09162D");
  });
  it("keeps every band of the dark screen ramp within two units of its neighbour per channel", () => {
    const steps = 16;
    const bands = Array.from({ length: steps }, (_, i) => mixHex("#061124", "#0B1B36", i / (steps - 1)));
    for (let i = 1; i < steps; i++) {
      for (let ch = 0; ch < 3; ch++) {
        const a = parseInt(bands[i - 1].slice(1 + ch * 2, 3 + ch * 2), 16);
        const b = parseInt(bands[i].slice(1 + ch * 2, 3 + ch * 2), 16);
        expect(Math.abs(b - a)).toBeLessThanOrEqual(2);
      }
    }
  });
});
