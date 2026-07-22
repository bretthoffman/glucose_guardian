/**
 * Copy for the calculator's per-card "Your Dose Breakdown" panel. Pure + unit-tested so the wording
 * (and the settings it cites) stay verifiable and out of the render. Each colored operation card maps
 * to one explanation built from the LIVE dose values + the user's settings.
 *
 * NOTE: the "Correct High BG" card folds the trend adjustment into the correction (so the four input
 * cards actually sum to the Dose), and its explanation surfaces the trend when it's non-zero.
 */
export type DoseCardKey = "correction" | "carb" | "activeCarbs" | "activeInsulin" | "dose";

/** Compact age: "just now", "32m", "1h 20m" (mirrors utils/onBoard.formatAgeShort). */
function formatAgeShort(ageMin: number | null): string {
  if (ageMin == null || ageMin < 1) return "just now";
  const m = Math.round(ageMin);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

export interface DoseExplainInput {
  bg: number;
  target: number;
  correctionFactor: number;
  carbRatio: number;
  carbs: number;
  /** Base correction (before trend), from (BG − target) ÷ ISF. */
  correctionInsulin: number;
  trendAdjustment: number;
  trendLabel: string;
  correctionSuppressed: boolean;
  carbInsulin: number;
  activeCarbGrams: number;
  activeCarbInsulin: number;
  activeCarbAgeMin: number | null;
  activeInsulinUnits: number;
  activeInsulinDoseCount: number;
  activeInsulinAgeMin: number | null;
  totalRaw: number;
  totalDose: number;
}

export interface DoseCardExplanation {
  title: string;
  lines: string[];
}

/** "just now" / "32m ago" / "1h 20m ago". */
function ago(ageMin: number | null): string {
  const s = formatAgeShort(ageMin);
  return ageMin != null && ageMin >= 1 ? `${s} ago` : s;
}

/** 1 dp, no trailing ".0", keeps a leading sign off (callers add it). */
function u(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${r}u`;
}

export function doseCardExplanation(key: DoseCardKey, d: DoseExplainInput): DoseCardExplanation {
  switch (key) {
    case "correction": {
      const foldedTrend = d.trendAdjustment;
      const lines: string[] = [];
      if (d.correctionSuppressed) {
        lines.push(
          `Correct High BG brings you back toward your target when you're running high.`,
          `Your reading of ${d.bg} mg/dL is at or below your target of ${d.target} mg/dL, so no correction is added right now.`,
        );
      } else {
        lines.push(
          `Correct High BG brings you back toward your target when you're running high.`,
          `Your reading is ${d.bg} mg/dL and your target is ${d.target} mg/dL. With a correction factor of 1 unit per ${d.correctionFactor} mg/dL, that's (${d.bg} − ${d.target}) ÷ ${d.correctionFactor} = ${u(d.correctionInsulin)}.`,
        );
      }
      if (Math.abs(foldedTrend) >= 0.05) {
        const dir = foldedTrend > 0 ? "adds" : "trims";
        lines.push(
          `Your glucose is ${d.trendLabel.toLowerCase()}, so a trend adjustment ${dir} ${u(Math.abs(foldedTrend))} to account for where you're heading.`,
        );
      }
      return { title: "Correct High BG", lines };
    }

    case "carb": {
      const lines: string[] = [
        `Carb Dose covers the carbs you plan to eat.`,
      ];
      if (d.carbs > 0) {
        lines.push(
          `You entered ${d.carbs} g of carbs, and with a carb ratio of 1 unit for every ${d.carbRatio} g, your Carb Dose is ${d.carbs} ÷ ${d.carbRatio} = ${u(d.carbInsulin)}.`,
          `If you change the carbs above, this number updates automatically.`,
        );
      } else {
        lines.push(
          `You haven't entered any carbs, so the Carb Dose is 0u. Add the grams you're about to eat above and it updates automatically at a carb ratio of 1 unit per ${d.carbRatio} g.`,
        );
      }
      return { title: "Carb Dose", lines };
    }

    case "activeCarbs": {
      const lines: string[] = [`Active Carbs are carbs from recent meals that are still absorbing.`];
      if (d.activeCarbGrams > 0) {
        lines.push(
          `About ${d.activeCarbGrams} g are still working from food you logged ${ago(d.activeCarbAgeMin)}. At your carb ratio of 1 unit per ${d.carbRatio} g, they add ${u(d.activeCarbInsulin)} so this dose covers them too.`,
        );
      } else {
        lines.push(`Nothing is currently absorbing from recent meals, so this adds 0u.`);
      }
      return { title: "Active Carbs", lines };
    }

    case "activeInsulin": {
      const lines: string[] = [`Active Insulin is insulin from recent doses that's still working in your body.`];
      if (d.activeInsulinUnits > 0) {
        const src =
          d.activeInsulinDoseCount > 1
            ? `${d.activeInsulinDoseCount} recent doses`
            : `a dose taken ${ago(d.activeInsulinAgeMin)}`;
        lines.push(
          `You still have ${u(d.activeInsulinUnits)} on board from ${src}. We subtract it so you don't stack insulin on top of what's already lowering your glucose.`,
        );
      } else {
        lines.push(`You have no insulin on board right now, so nothing is subtracted.`);
      }
      return { title: "Active Insulin", lines };
    }

    case "dose": {
      const parts: string[] = [];
      const corr = d.correctionInsulin + d.trendAdjustment;
      if (Math.abs(corr) >= 0.05) parts.push(`${u(corr)} to correct`);
      if (d.carbInsulin > 0) parts.push(`${u(d.carbInsulin)} for carbs`);
      if (d.activeCarbInsulin > 0) parts.push(`${u(d.activeCarbInsulin)} for active carbs`);
      if (d.activeInsulinUnits > 0) parts.push(`minus ${u(d.activeInsulinUnits)} already active`);
      const math = parts.length > 0 ? parts.join(", ") : "the pieces above";
      const lines = [
        `Your suggested Dose combines everything above.`,
        `That's ${math} — ${u(d.totalRaw)} total, rounded to ${u(d.totalDose)}.`,
        `You can round it as needed before giving it.`,
      ];
      return { title: "Dose", lines };
    }
  }
}
