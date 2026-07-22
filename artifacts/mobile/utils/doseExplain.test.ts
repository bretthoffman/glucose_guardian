import { describe, expect, it } from "vitest";
import { doseCardExplanation, type DoseExplainInput } from "./doseExplain";

const base: DoseExplainInput = {
  bg: 364,
  target: 120,
  correctionFactor: 50,
  carbRatio: 15,
  carbs: 0,
  correctionInsulin: 4.88,
  trendAdjustment: 0,
  trendLabel: "Rising",
  correctionSuppressed: false,
  carbInsulin: 0,
  activeCarbGrams: 0,
  activeCarbInsulin: 0,
  activeCarbAgeMin: null,
  activeInsulinUnits: 2.96,
  activeInsulinDoseCount: 4,
  activeInsulinAgeMin: 38,
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

  it("folds a non-zero trend adjustment into Correct High BG", () => {
    const e = doseCardExplanation("correction", { ...base, trendAdjustment: -0.49 });
    expect(e.lines.join(" ").toLowerCase()).toContain("trend adjustment");
    expect(e.lines.join(" ")).toContain("0.49u");
  });

  it("suppresses the correction explanation when BG is at/under target", () => {
    const e = doseCardExplanation("correction", { ...base, bg: 100, correctionSuppressed: true });
    expect(e.lines.join(" ").toLowerCase()).toContain("no correction");
  });

  it("Carb Dose cites the carb ratio and entered carbs", () => {
    const e = doseCardExplanation("carb", { ...base, carbs: 30, carbInsulin: 2 });
    expect(e.title).toBe("Carb Dose");
    expect(e.lines.join(" ")).toContain("30 ÷ 15");
    expect(e.lines.join(" ")).toContain("2u");
  });

  it("Active Insulin explains subtraction and cites the amount on board", () => {
    const e = doseCardExplanation("activeInsulin", base);
    expect(e.lines.join(" ")).toContain("2.96u");
    expect(e.lines.join(" ").toLowerCase()).toContain("subtract");
  });

  it("Active Carbs cites grams still absorbing and the carb ratio", () => {
    const e = doseCardExplanation("activeCarbs", { ...base, activeCarbGrams: 12, activeCarbInsulin: 0.8, activeCarbAgeMin: 45 });
    expect(e.lines.join(" ")).toContain("12 g");
    expect(e.lines.join(" ")).toContain("1 unit per 15 g");
  });

  it("Dose summarizes the combination and the rounding", () => {
    const e = doseCardExplanation("dose", base);
    expect(e.title).toBe("Dose");
    expect(e.lines.join(" ")).toContain("1.92u");
    expect(e.lines.join(" ")).toContain("1.5u");
  });
});
