import { Router, type IRouter } from "express";
import {
  SubmitGlucoseReadingBody,
  GetGlucoseHistoryResponse,
  SubmitGlucoseReadingResponse,
  ClearGlucoseHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

interface GlucoseEntry {
  glucose: number;
  timestamp: string;
  anomaly: { warning: boolean; message?: string };
}

let glucoseHistory: GlucoseEntry[] = [];

function detectAnomaly(
  previous: number | undefined,
  current: number
): { warning: boolean; message?: string } {
  if (previous === undefined) return { warning: false };
  const difference = Math.abs(current - previous);
  if (current < 70) {
    return {
      warning: true,
      message:
        "Low glucose detected! Consider juice or fast-acting carbs immediately.",
    };
  }
  if (current > 250) {
    return {
      warning: true,
      message: "High glucose detected! Check with your care team.",
    };
  }
  if (difference > 80) {
    return {
      warning: true,
      message:
        "Unusual glucose jump detected. Consider confirming with a finger-stick test.",
    };
  }
  return { warning: false };
}

function predictGlucose(
  history: GlucoseEntry[]
): { predicted30min: number } | null {
  if (history.length < 3) return null;
  const last = history[history.length - 1].glucose;
  const prev = history[history.length - 2].glucose;
  const trend = last - prev;
  const predicted = Math.max(0, last + trend * 3);
  return { predicted30min: Math.round(predicted) };
}

router.post("/", (req, res) => {
  const body = SubmitGlucoseReadingBody.parse(req.body);
  const { glucose } = body;

  const last = glucoseHistory[glucoseHistory.length - 1];
  const anomaly = detectAnomaly(last?.glucose, glucose);

  const entry: GlucoseEntry = {
    glucose,
    timestamp: new Date().toISOString(),
    anomaly,
  };

  glucoseHistory.push(entry);
  if (glucoseHistory.length > 100) glucoseHistory = glucoseHistory.slice(-100);

  const prediction = predictGlucose(glucoseHistory);

  const response = SubmitGlucoseReadingResponse.parse({
    current: glucose,
    anomaly,
    prediction: prediction ?? undefined,
    timestamp: entry.timestamp,
  });

  res.json(response);
});

router.get("/history", (_req, res) => {
  const response = GetGlucoseHistoryResponse.parse({
    history: glucoseHistory,
    count: glucoseHistory.length,
  });
  res.json(response);
});

router.delete("/history", (_req, res) => {
  glucoseHistory = [];
  const response = ClearGlucoseHistoryResponse.parse({
    success: true,
    message: "History cleared",
  });
  res.json(response);
});

export default router;
