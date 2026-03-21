import { Router, type IRouter } from "express";
import { CalculateInsulinBody, CalculateInsulinResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/", (req, res) => {
  const body = CalculateInsulinBody.parse(req.body);
  const { carbs, ratio, currentGlucose, targetGlucose, correctionFactor } = body;

  const mealDose = carbs / ratio;
  let correctionDose = 0;

  if (
    currentGlucose !== undefined &&
    targetGlucose !== undefined &&
    correctionFactor !== undefined
  ) {
    const glucoseDiff = currentGlucose - targetGlucose;
    if (glucoseDiff > 0) {
      correctionDose = glucoseDiff / correctionFactor;
    }
  }

  const totalInsulin = Math.max(0, mealDose + correctionDose);

  const response = CalculateInsulinResponse.parse({
    insulin: Number(totalInsulin.toFixed(1)),
    mealDose: Number(mealDose.toFixed(1)),
    correctionDose: Number(correctionDose.toFixed(1)),
  });

  res.json(response);
});

router.post("/predict", async (req, res) => {
  try {
    const {
      carbs,
      currentGlucose,
      carbRatio = 15,
      targetGlucose = 120,
      correctionFactor = 50,
      trendDirection = "stable",
      isMinor = false,
    } = req.body;

    if (!carbs || carbs <= 0) {
      res.status(400).json({ error: "Carbs required and must be greater than 0" });
      return;
    }

    const current = currentGlucose ?? targetGlucose;

    // ── Same formula as the Smart Dose Engine (utils/dose.ts) ──────────────
    const TREND_ADJ: Record<string, number> = {
      rapidly_rising: 0.5,
      rising: 0.25,
      stable: 0,
      falling: -0.25,
      rapidly_falling: -0.5,
    };

    // 1. Carb dose
    const carbInsulin = carbRatio > 0 ? carbs / carbRatio : 0;

    // 2. Correction dose (suppressed when BG is already below target)
    const correctionSuppressed = current < targetGlucose;
    const correctionInsulin =
      !correctionSuppressed && correctionFactor > 0
        ? (current - targetGlucose) / correctionFactor
        : 0;

    // 3. Trend adjustment
    const trendAdj = TREND_ADJ[trendDirection] ?? 0;

    // 4. KwikPen round to nearest 0.5 unit
    const totalRaw = Math.max(0, carbInsulin + correctionInsulin + trendAdj);
    const insulinDose = Math.round(totalRaw * 2) / 2;
    // ───────────────────────────────────────────────────────────────────────

    // Spike forecast: carb-driven rise over the next 30 min
    const glucoseRisePerGram = correctionFactor / carbRatio;
    const totalRise = carbs * glucoseRisePerGram;
    const peak30 = Math.round(current + totalRise * 0.85);
    const peak60WithoutInsulin = Math.round(current + totalRise * 0.6);

    // How much glucose the correct dose brings down at 60 min (≈35% of peak action)
    const insulinEffect60min = insulinDose * correctionFactor * 0.35;
    const predicted60WithInsulin = Math.round(
      current + totalRise * 0.6 - insulinEffect60min
    );

    const inRange30 = peak30 >= 70 && peak30 <= 180;
    const inRange60 = predicted60WithInsulin >= 70 && predicted60WithInsulin <= 180;

    let timingAdvice = "Take insulin with your meal.";
    let timingEmoji = "⏰";
    if (trendDirection === "falling" || trendDirection === "rapidly_falling") {
      timingAdvice = "Your sugar is trending down — wait 15–20 min after eating before taking insulin, or eat first.";
      timingEmoji = "⬇️";
    } else if (trendDirection === "rising" || trendDirection === "rapidly_rising") {
      timingAdvice = "Your sugar is trending up — take insulin 10–15 min before your meal for best results.";
      timingEmoji = "⬆️";
    } else if (peak30 > 250) {
      timingAdvice = "High-carb meal — take insulin 10–15 min before eating to blunt the spike.";
      timingEmoji = "⚡";
    }

    // Dose breakdown for the friendly message
    const carbDoseRounded = Math.round(carbInsulin * 10) / 10;
    const corrDoseRounded = Math.round(correctionInsulin * 10) / 10;
    const correctionNote =
      corrDoseRounded > 0
        ? ` (${carbDoseRounded}u for ${carbs}g carbs + ${corrDoseRounded}u correction for current glucose)`
        : correctionSuppressed
        ? ` (carb dose only — glucose is below target, no correction needed)`
        : "";

    let friendlyMessage = "";
    let monsterMood: "happy" | "worried" | "danger" = "happy";

    if (current < 70) {
      friendlyMessage = `Your sugar is low right now (${current} mg/dL). Treat the low first with fast carbs before taking any insulin! 🧃`;
      monsterMood = "danger";
    } else if (inRange60) {
      friendlyMessage = `Take ${insulinDose} units now${correctionNote} and your sugar should be around ${predicted60WithInsulin} mg/dL in an hour — right in range! Great job tracking your meals! 🌟`;
      monsterMood = "happy";
    } else if (predicted60WithInsulin > 180) {
      friendlyMessage = `Take ${insulinDose} units${correctionNote}. Your sugar should come down to around ${predicted60WithInsulin} mg/dL in an hour. ${timingAdvice} 💙`;
      monsterMood = "worried";
    } else if (predicted60WithInsulin < 70) {
      friendlyMessage = `Be careful — with ${insulinDose} units your sugar might drop a bit low (around ${predicted60WithInsulin} mg/dL). Ask a parent or your doctor before taking this dose. Keep a juice box nearby! 🧃`;
      monsterMood = "danger";
    } else {
      friendlyMessage = `Take ${insulinDose} units${correctionNote} and your sugar should be around ${predicted60WithInsulin} mg/dL in an hour. You've got this! 🎉`;
      monsterMood = "happy";
    }

    res.json({
      carbs,
      insulinDose,
      currentGlucose: current,
      predictedPeak30: peak30,
      predicted60WithInsulin,
      predicted60WithoutInsulin: peak60WithoutInsulin,
      targetGlucose,
      inRange30,
      inRange60,
      timingAdvice,
      timingEmoji,
      friendlyMessage,
      monsterMood,
      trendDirection,
      carbRatio,
      correctionFactor,
    });
  } catch (err) {
    console.error("Glucose prediction error:", err);
    res.status(500).json({ error: "Could not generate prediction. Please try again." });
  }
});

export default router;
