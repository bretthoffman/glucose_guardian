import { describe, expect, it } from "vitest";
import { doseCardExplanation, type DoseExplainInput } from "./doseExplain";

/** Correction-only redose scenario: 4.88u called for, 2.96u on board credits the correction. */
const base: DoseExplainInput = {
  bg: 364,
  target: 120,
  correctionFactor: 50,
  carbRatio: 15,
  carbs: 0,
  correctionInsulin: 4.88,
  resistanceBump: 0,
  trendAdjustment: 0,
  trendLabel: "Rising",
  hyperTrendZeroed: false,
  correctionSuppressed: false,
  carbInsulin: 0,
  settingsBucket: "lunch",
  settingsFromOverride: false,
  activeCarbGrams: 0,
  activeCarbInsulin: 0,
  activeCarbAgeMin: null,
  uncoveredCarbInsulin: 0,
  activeInsulinUnits: 2.96,
  activeInsulinDoseCount: 4,
  activeInsulinAgeMin: 38,
  iobCredit: 2.96,
  iobDiscounted: false,
  correctionApplied: 1.92,
  subTotal: 1.92,
  patternFactor: 1,
  patternDelta: 0,
  maxDoseCap: 10,
  cappedAtMax: false,
  totalRaw: 1.92,
  totalDose: 1.5,
};

describe("doseCardExplanation", () => {
  it("Correct High BG cites BG, target, ISF and the arithmetic", () => {
    const e = doseCardExplanation("correction", base);
    expect(e.title).toBe("Correct High BG");
    expect(e.lines.join(" ")).toContain("(364 − 120) ÷ 50");
    expect(e.lines.join(" ")).toContain("4.88u");
    // The generic intro line was removed for this first card only — it leads with the numbers.
    expect(e.lines.join(" ")).not.toContain("brings you back toward your target");
  });

  it("keeps the intro line on the activity cards", () => {
    expect(doseCardExplanation("activeCarbs", base).lines[0]).toContain("Active Carbs are");
    expect(doseCardExplanation("activeInsulin", base).lines[0]).toContain("Active Insulin is");
  });

  it("drops the correction and carb intro lines", () => {
    expect(doseCardExplanation("correction", base).lines.join(" ")).not.toContain("brings you back toward your target");
    expect(doseCardExplanation("carb", base).lines.join(" ")).not.toContain("Carb Dose covers");
  });

  it("folds a non-zero trend adjustment into Correct High BG and explains the ISF scaling", () => {
    const e = doseCardExplanation("correction", { ...base, trendAdjustment: -0.49 });
    expect(e.lines.join(" ").toLowerCase()).toContain("trend adjustment");
    expect(e.lines.join(" ")).toContain("0.49u");
    expect(e.lines.join(" ")).toContain("divided by your correction factor");
  });

  it("explains a skipped falling-trend reduction while glucose is high", () => {
    const e = doseCardExplanation("correction", { ...base, trendAdjustment: 0, hyperTrendZeroed: true });
    expect(e.lines.join(" ")).toContain("falling-trend reduction is skipped");
  });

  it("explains the very-high resistance boost when present", () => {
    const e = doseCardExplanation("correction", { ...base, resistanceBump: 0.49 });
    expect(e.lines.join(" ")).toContain("resistance boost adds 0.49u");
  });

  it("suppresses the correction explanation when BG is at/under target", () => {
    const e = doseCardExplanation("correction", { ...base, bg: 100, correctionSuppressed: true });
    expect(e.lines.join(" ").toLowerCase()).toContain("no correction");
  });

  it("Carb Dose cites the carb ratio, entered carbs, and the never-reduced rule", () => {
    const e = doseCardExplanation("carb", { ...base, carbs: 30, carbInsulin: 2 });
    expect(e.title).toBe("Carb Dose");
    expect(e.lines.join(" ")).toContain("30 ÷ 15");
    expect(e.lines.join(" ")).toContain("2u");
    expect(e.lines.join(" ")).toContain("never reduced by insulin");
  });

  it("cites the time-of-day override wherever a ratio is used", () => {
    const o = { ...base, carbs: 30, carbInsulin: 2, settingsFromOverride: true, settingsBucket: "breakfast" as const };
    expect(doseCardExplanation("carb", o).lines.join(" ")).toContain("your breakfast override");
    expect(doseCardExplanation("correction", o).lines.join(" ")).toContain("your breakfast override");
  });

  it("Active Insulin explains the correction-only credit and cites the amount on board", () => {
    const e = doseCardExplanation("activeInsulin", base).lines.join(" ");
    expect(e).toContain("2.96u");
    expect(e.toLowerCase()).toContain("subtracted from your correction");
    expect(e).toContain("never your Carb Dose");
  });

  it("Active Insulin explains FULL coverage of the correction without touching carbs", () => {
    const e = doseCardExplanation("activeInsulin", { ...base, iobCredit: 4.88, correctionApplied: 0 }).lines
      .join(" ")
      .toLowerCase();
    expect(e).toContain("covers your whole correction");
    expect(e).toContain("food is always covered in full");
  });

  it("Active Insulin explains the effectiveness discount when glucose is not falling", () => {
    const e = doseCardExplanation("activeInsulin", { ...base, iobDiscounted: true, iobCredit: 1.48 }).lines.join(" ");
    expect(e).toContain("only HALF");
  });

  it("Active Insulin explains the balance when absorbing carbs outweigh it", () => {
    const e = doseCardExplanation("activeInsulin", {
      ...base,
      activeCarbInsulin: 4,
      uncoveredCarbInsulin: 1.04,
      iobCredit: 0,
    }).lines.join(" ");
    expect(e).toContain("Absorbing carbs outweigh it");
  });

  it("Active Carbs cites grams absorbing, and the uncovered portion when insulin doesn't cover them", () => {
    const covered = doseCardExplanation("activeCarbs", {
      ...base,
      activeCarbGrams: 12,
      activeCarbInsulin: 0.8,
      activeCarbAgeMin: 45,
      uncoveredCarbInsulin: 0,
    }).lines.join(" ");
    expect(covered).toContain("12 g");
    expect(covered).toContain("fully covers them");
    const uncovered = doseCardExplanation("activeCarbs", {
      ...base,
      activeCarbGrams: 30,
      activeCarbInsulin: 2,
      activeCarbAgeMin: 20,
      uncoveredCarbInsulin: 1.2,
      iobCredit: 0,
    }).lines.join(" ");
    expect(uncovered).toContain("uncovered part adds 1.2u");
  });

  it("Dose summarizes the combination and the rounding", () => {
    const e = doseCardExplanation("dose", base);
    expect(e.title).toBe("Dose");
    expect(e.lines.join(" ")).toContain("1.92u");
    expect(e.lines.join(" ")).toContain("1.5u");
  });

  it("Dose explains the pattern adjustment and that settings are never changed", () => {
    const e = doseCardExplanation("dose", {
      ...base,
      patternFactor: 1.2,
      patternDelta: 0.38,
      totalRaw: 2.3,
      totalDose: 2.5,
    }).lines.join(" ");
    expect(e).toContain("pattern adjustment");
    expect(e).toContain("0.38u");
    expect(e).toContain("never changed");
  });

  it("Dose explains the safety cap when it clipped the suggestion", () => {
    const e = doseCardExplanation("dose", {
      ...base,
      subTotal: 12,
      cappedAtMax: true,
      maxDoseCap: 8,
      totalRaw: 8,
      totalDose: 8,
    }).lines.join(" ");
    expect(e).toContain("capped at the 8u single-dose safety limit");
  });
});
