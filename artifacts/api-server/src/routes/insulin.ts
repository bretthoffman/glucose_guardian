import { Router, type IRouter } from "express";
import { CalculateInsulinBody, CalculateInsulinResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/", (req, res) => {
  const body = CalculateInsulinBody.parse(req.body);
  const { carbs, ratio, currentGlucose, targetGlucose, correctionFactor } =
    body;

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

export default router;
