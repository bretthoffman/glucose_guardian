/**
 * Copy for the calculator's per-card "Your Dose Breakdown" panel. Pure + unit-tested so the wording
 * (and the settings it cites) stay verifiable and out of the render. Each colored operation card maps
 * to one explanation built from the LIVE dose values + the user's settings.
 *
 * TRANSPARENCY RULE: every component of the calculation — correction, resistance bump, trend,
 * carb dose, time-of-day override, uncovered carbs, the active-insulin credit (and any
 * effectiveness discount), the pattern adjustment, and the safety cap — must be stated in these
 * explanations whenever it affects the number. Nothing about the math is hidden.
 *
 * Card layout invariant: Correct BG (correction + resistance + trend, BEFORE the credit)
 * + Carb Dose + Uncovered Carbs − Active Insulin credit = subtotal; the Dose card then explains
 * the pattern adjustment and safety cap applied to that subtotal.
 */
import type { MealBucket } from "./doseSettings";
import { MEAL_BUCKET_LABELS } from "./doseSettings";

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
  /** Base correction (before resistance/trend), from (BG − target) ÷ ISF. */
  correctionInsulin: number;
  /** Extra correction added because glucose is very high (resistance bump). */
  resistanceBump: number;
  trendAdjustment: number;
  trendLabel: string;
  /** A falling-trend reduction was skipped because glucose is high. */
  hyperTrendZeroed: boolean;
  correctionSuppressed: boolean;
  carbInsulin: number;
  /** Which meal window the settings came from + whether a time-of-day override was used. */
  settingsBucket?: MealBucket;
  settingsFromOverride?: boolean;
  activeCarbGrams: number;
  activeCarbInsulin: number;
  activeCarbAgeMin: number | null;
  /** Carbs still absorbing that recent insulin does NOT cover (added to the dose). */
  uncoveredCarbInsulin: number;
  activeInsulinUnits: number;
  activeInsulinDoseCount: number;
  activeInsulinAgeMin: number | null;
  /** Credit actually subtracted from the correction (after any effectiveness discount). */
  iobCredit: number;
  iobDiscounted: boolean;
  /** Correction portion after trend + credit (what actually lands in the dose). */
  correctionApplied: number;
  subTotal: number;
  patternFactor: number;
  patternDelta: number;
  maxDoseCap: number;
  cappedAtMax: boolean;
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

/** "(your dinner override)" / "" — cited wherever a ratio or ISF is used. */
function settingsNote(d: DoseExplainInput): string {
  if (!d.settingsFromOverride || !d.settingsBucket) return "";
  return ` (your ${MEAL_BUCKET_LABELS[d.settingsBucket].toLowerCase()} override)`;
}

export function doseCardExplanation(key: DoseCardKey, d: DoseExplainInput): DoseCardExplanation {
  switch (key) {
    case "correction": {
      // No intro line for this first card (removed by design) — jump straight to the numbers.
      const lines: string[] = [];
      if (d.correctionSuppressed) {
        lines.push(
          `Your reading of ${d.bg} mg/dL is at or below your target of ${d.target} mg/dL, so no correction is added right now.`,
        );
      } else {
        lines.push(
          `Your reading is ${d.bg} mg/dL and your target is ${d.target} mg/dL. With a correction factor of 1 unit per ${d.correctionFactor} mg/dL${settingsNote(d)}, that's (${d.bg} − ${d.target}) ÷ ${d.correctionFactor} = ${u(d.correctionInsulin)}.`,
        );
      }
      if (d.resistanceBump > 0.001) {
        lines.push(
          `Because your glucose is very high, corrections often work less effectively — so a 10% resistance boost adds ${u(d.resistanceBump)}.`,
        );
      }
      if (Math.abs(d.trendAdjustment) >= 0.005) {
        const dir = d.trendAdjustment > 0 ? "adds" : "trims";
        lines.push(
          `Your glucose is ${d.trendLabel.toLowerCase()}, so a trend adjustment ${dir} ${u(Math.abs(d.trendAdjustment))} — that's the change expected over the next 30 minutes divided by your correction factor, so it scales to your sensitivity.`,
        );
      } else if (d.hyperTrendZeroed) {
        lines.push(
          `Your glucose is falling, but it's still high — so the usual falling-trend reduction is skipped. The full correction stands until you're back near range.`,
        );
      }
      if (d.iobCredit > 0.001) {
        lines.push(
          `Active insulin then reduces this correction — see the Active Insulin card for that part.`,
        );
      }
      return { title: "Correct High BG", lines };
    }

    case "carb": {
      // No intro line for this card (removed by design) — jump straight to the numbers.
      const lines: string[] = [];
      if (d.carbs > 0) {
        lines.push(
          `You entered ${d.carbs} g of carbs, and with a carb ratio of 1 unit for every ${d.carbRatio} g${settingsNote(d)}, your Carb Dose is ${d.carbs} ÷ ${d.carbRatio} = ${u(d.carbInsulin)}.`,
          `Carb insulin is never reduced by insulin that's already on board — earlier doses were for earlier food. Food always gets covered in full.`,
        );
      } else {
        lines.push(
          `You haven't entered any carbs, so the Carb Dose is 0u. Add the grams you're about to eat above and it updates automatically at a carb ratio of 1 unit per ${d.carbRatio} g${settingsNote(d)}.`,
        );
      }
      return { title: "Carb Dose", lines };
    }

    case "activeCarbs": {
      const lines: string[] = [
        `Active Carbs are carbs from recent meals that are still absorbing.`,
      ];
      if (d.activeCarbGrams > 0) {
        lines.push(
          `About ${d.activeCarbGrams} g are still working from food you logged ${ago(d.activeCarbAgeMin)} — worth ${u(d.activeCarbInsulin)} at your carb ratio.`,
        );
        if (d.uncoveredCarbInsulin > 0.001) {
          lines.push(
            `Insulin already on board covers part of them, but not all — the uncovered part adds ${u(d.uncoveredCarbInsulin)} so those carbs don't get missed.`,
          );
        } else {
          lines.push(
            `Insulin you've already taken fully covers them, so nothing extra is added here — they're balanced against your active insulin instead.`,
          );
        }
      } else {
        lines.push(`Nothing is currently absorbing from recent meals, so this adds 0u.`);
      }
      return { title: "Active Carbs", lines };
    }

    case "activeInsulin": {
      const lines: string[] = [
        `Active Insulin is insulin from recent doses that's still working in your body.`,
      ];
      if (d.activeInsulinUnits > 0) {
        const src =
          d.activeInsulinDoseCount > 1
            ? `${d.activeInsulinDoseCount} recent doses`
            : `a dose taken ${ago(d.activeInsulinAgeMin)}`;
        lines.push(`You still have ${u(d.activeInsulinUnits)} on board from ${src}.`);
        if (d.activeCarbInsulin > 0.001) {
          lines.push(
            `It's first balanced against the ${u(d.activeCarbInsulin)} of carbs still absorbing — only the surplus counts as a credit.`,
          );
        }
        if (d.iobDiscounted) {
          lines.push(
            `Your glucose is high and hasn't been coming down even with this insulin active, so only HALF of the surplus is credited — insulin that isn't visibly working shouldn't cancel a needed correction.`,
          );
        }
        if (d.iobCredit > 0.001) {
          const covers = d.correctionApplied <= 0.001;
          lines.push(
            covers
              ? `The ${u(d.iobCredit)} credit covers your whole correction, so no extra correction insulin is suggested — but it never reduces your Carb Dose. Food is always covered in full.`
              : `${u(d.iobCredit)} is subtracted from your correction (and only your correction — never your Carb Dose) to avoid stacking insulin.`,
          );
        } else if (d.uncoveredCarbInsulin > 0.001) {
          lines.push(
            `Absorbing carbs outweigh it, so there's no surplus to subtract — the leftover carbs are added on the Active Carbs card instead.`,
          );
        } else {
          lines.push(`There's no correction to reduce right now, so it doesn't change the suggestion.`);
        }
      } else {
        lines.push(`You have no insulin on board right now, so nothing is subtracted.`);
      }
      return { title: "Active Insulin", lines };
    }

    case "dose": {
      const parts: string[] = [];
      const corrCard = d.correctionInsulin + d.resistanceBump + d.trendAdjustment;
      if (Math.abs(corrCard) >= 0.005) parts.push(`${u(corrCard)} to correct`);
      if (d.carbInsulin > 0) parts.push(`${u(d.carbInsulin)} for carbs`);
      if (d.uncoveredCarbInsulin > 0.001) parts.push(`${u(d.uncoveredCarbInsulin)} for uncovered active carbs`);
      if (d.iobCredit > 0.001) parts.push(`minus the ${u(d.iobCredit)} active-insulin credit`);
      const math = parts.length > 0 ? parts.join(", ") : "the pieces above";
      const lines = [`Your suggested Dose combines everything above.`, `That's ${math} = ${u(d.subTotal)}.`];
      if (Math.abs(d.patternDelta) >= 0.005) {
        const dir = d.patternDelta > 0 ? "up" : "down";
        const pct = Math.round(Math.abs(d.patternFactor - 1) * 100);
        lines.push(
          `A pattern adjustment then nudges it ${dir} by ${u(Math.abs(d.patternDelta))} (${pct}%), because doses actually given at this time of day have consistently run ${dir === "up" ? "above" : "below"} the calculator's suggestions over the last two weeks. Your saved settings are never changed by this — it only tunes the suggestion, and it's always shown here.`,
        );
      }
      if (d.cappedAtMax) {
        lines.push(
          `The result was capped at the ${u(d.maxDoseCap)} single-dose safety limit${d.maxDoseCap === 10 ? "" : " (based on your weight)"} — confirm anything larger with your care team.`,
        );
      }
      lines.push(`That makes ${u(d.totalRaw)}, rounded to ${u(d.totalDose)}.`, `You can round it as needed before giving it.`);
      return { title: "Dose", lines };
    }
  }
}
