import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import { isTimestampInLocalDay } from "./localDayBoundaries";

export function filterFoodLogsForDay(
  foodLog: FoodLogEntry[],
  dayStartMs: number,
  dayEndMs: number,
): FoodLogEntry[] {
  return foodLog
    .filter((f) => isTimestampInLocalDay(f.timestamp, dayStartMs, dayEndMs))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function filterInsulinLogsForDay(
  insulinLog: InsulinLogEntry[],
  dayStartMs: number,
  dayEndMs: number,
): InsulinLogEntry[] {
  return insulinLog
    .filter((i) => isTimestampInLocalDay(i.timestamp, dayStartMs, dayEndMs))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
