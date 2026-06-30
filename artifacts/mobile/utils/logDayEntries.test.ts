import { describe, expect, it } from "vitest";
import { filterFoodLogsForDay } from "./logDayEntries";

describe("filterFoodLogsForDay", () => {
  const dayStart = new Date(2026, 5, 25, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(2026, 5, 26, 0, 0, 0, 0).getTime();

  it("returns only food logs for the selected local day in chronological order", () => {
    const rows = filterFoodLogsForDay(
      [
        {
          id: "a",
          timestamp: new Date(2026, 5, 24, 15, 0, 0).toISOString(),
          foodName: "Old",
          estimatedCarbs: 10,
          insulinUnits: 1,
          confidence: "high",
          fromPhoto: false,
        },
        {
          id: "b",
          timestamp: new Date(2026, 5, 25, 12, 0, 0).toISOString(),
          foodName: "Lunch",
          estimatedCarbs: 40,
          insulinUnits: 3,
          confidence: "high",
          fromPhoto: false,
        },
        {
          id: "c",
          timestamp: new Date(2026, 5, 25, 18, 0, 0).toISOString(),
          foodName: "Dinner",
          estimatedCarbs: 55,
          insulinUnits: 4,
          confidence: "medium",
          fromPhoto: true,
        },
      ],
      dayStart,
      dayEnd,
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "c"]);
  });
});
