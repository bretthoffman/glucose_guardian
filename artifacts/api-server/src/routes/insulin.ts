import { Router, type IRouter } from "express";
import { CalculateInsulinBody, CalculateInsulinResponse } from "@workspace/api-zod";
import OpenAI from "openai";

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

    const glucoseRisePerGram = correctionFactor / carbRatio;
    const totalRise = carbs * glucoseRisePerGram;

    const peak30 = Math.round(current + totalRise * 0.85);
    const peak60WithoutInsulin = Math.round(current + totalRise * 0.6);

    const insulinDose = Math.round((carbs / carbRatio) * 10) / 10;
    const insulinEffect60min = insulinDose * correctionFactor * 0.35;
    const predicted60WithInsulin = Math.round(current + totalRise * 0.6 - insulinEffect60min);

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

    let friendlyMessage = "";
    let monsterMood: "happy" | "worried" | "danger" = "happy";

    if (inRange60) {
      friendlyMessage = `You're going to be in the safe zone if you take ${insulinDose} units now! Your sugar should be around ${predicted60WithInsulin} in an hour. Great job managing your diabetes! 🌟`;
      monsterMood = "happy";
    } else if (predicted60WithInsulin > 180) {
      friendlyMessage = `If you take ${insulinDose} units, your sugar should come down to around ${predicted60WithInsulin} in an hour. ${timingAdvice} Your diabetes team is proud of you for tracking! 💙`;
      monsterMood = "worried";
    } else if (predicted60WithInsulin < 70) {
      friendlyMessage = `Be careful — with ${insulinDose} units your sugar might go a little low (around ${predicted60WithInsulin}). Ask a parent or your doctor before taking insulin. Keep a juice box nearby! 🧃`;
      monsterMood = "danger";
    } else {
      friendlyMessage = `Take ${insulinDose} units with your meal and you should be in good shape! Your sugar is predicted to be around ${predicted60WithInsulin} in an hour. You've got this! 🎉`;
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
