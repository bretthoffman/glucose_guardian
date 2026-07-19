import { describe, expect, it } from "vitest";
import { positionEventMarkers } from "./chartEventMarkers";

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-07-18T00:00:00Z").getTime();
const PLOT_W = 340;

function at(hours: number): string {
  return new Date(START + hours * 3600_000).toISOString();
}

describe("positionEventMarkers", () => {
  it("maps a log's time to its plot column on the baseline", () => {
    const [m] = positionEventMarkers(
      [{ kind: "food", timestamp: at(12) }],
      START,
      DAY,
      PLOT_W,
    );
    expect(m.x).toBeCloseTo(PLOT_W / 2, 5);
    expect(m.stackIndex).toBe(0);
  });

  it("drops markers outside the window and invalid timestamps", () => {
    const out = positionEventMarkers(
      [
        { kind: "food", timestamp: at(-1) },
        { kind: "insulin", timestamp: at(25) },
        { kind: "food", timestamp: "garbage" },
      ],
      START,
      DAY,
      PLOT_W,
    );
    expect(out).toHaveLength(0);
  });

  it("stacks near-coincident logs downward with insulin on the baseline", () => {
    const out = positionEventMarkers(
      [
        { kind: "food", timestamp: at(12) },
        { kind: "insulin", timestamp: at(12.05) }, // ~42s later → same column
      ],
      START,
      DAY,
      PLOT_W,
    );
    expect(out).toHaveLength(2);
    const insulin = out.find((m) => m.kind === "insulin")!;
    const food = out.find((m) => m.kind === "food")!;
    expect(insulin.stackIndex).toBe(0);
    expect(food.stackIndex).toBe(1);
    expect(insulin.x).toBe(food.x);
  });

  it("keeps well-separated logs in their own columns", () => {
    const out = positionEventMarkers(
      [
        { kind: "food", timestamp: at(8) },
        { kind: "insulin", timestamp: at(18) },
      ],
      START,
      DAY,
      PLOT_W,
    );
    expect(out).toHaveLength(2);
    expect(out[0].stackIndex).toBe(0);
    expect(out[1].stackIndex).toBe(0);
    expect(out[0].x).not.toBe(out[1].x);
  });

  it("stacks same-kind logs chronologically within a cluster", () => {
    const out = positionEventMarkers(
      [
        { kind: "insulin", timestamp: at(12.02) },
        { kind: "insulin", timestamp: at(12) },
      ],
      START,
      DAY,
      PLOT_W,
    );
    expect(out[0].stackIndex).toBe(0);
    expect(out[1].stackIndex).toBe(1);
  });
});
