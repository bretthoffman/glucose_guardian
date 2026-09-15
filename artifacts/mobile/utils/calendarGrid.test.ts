import { describe, expect, it } from "vitest";
import { monthGrid } from "./calendarGrid";

describe("monthGrid", () => {
  it("lays September 2026 out under the weekday row: 42 cells, first day on Tuesday, 30 days", () => {
    const cells = monthGrid(2026, 8);
    expect(cells).toHaveLength(42);
    // Sep 1, 2026 is a Tuesday → two leading blanks (Sun, Mon).
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells[2]?.getDate()).toBe(1);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells[31]?.getDate()).toBe(30);
    expect(cells[32]).toBeNull();
  });

  it("handles a leap February and a month that needs all six rows", () => {
    expect(monthGrid(2024, 1).filter(Boolean)).toHaveLength(29);
    // May 2026 starts on Friday and has 31 days → spills into a sixth row.
    const may = monthGrid(2026, 4);
    expect(may.filter(Boolean)).toHaveLength(31);
    expect(may[5]?.getDate()).toBe(1);
    expect(may[35]?.getDate()).toBe(31);
  });
});
