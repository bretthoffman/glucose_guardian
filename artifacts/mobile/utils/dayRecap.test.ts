import { describe, expect, it } from "vitest";
import { dayRecapItems, dayRecapStats } from "./dayRecap";
import type { HandoffLog } from "./handoff";

const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
};

describe("day recap", () => {
  it("counts each dip under 70 once, the highest, and time in range inside the hours only", () => {
    const g = [120, 110, 64, 62, 84, 140, 214, 160, 66, 90];
    const readings = g.map((v, i) => ({ glucose: v, timestamp: iso(at(8) + i * 30 * 60_000) }));
    readings.push({ glucose: 300, timestamp: iso(at(7)) }); // before school: left out
    const s = dayRecapStats(readings, at(8), at(15));
    expect(s.lows).toBe(2);
    expect(s.highest).toBe(214);
    expect(s.inRangePct).toBe(60);
    expect(dayRecapStats([], at(8), at(15))).toEqual({ inRangePct: null, lows: 0, highest: null });
  });

  it("lists the school day newest first, with who did it, and marks a treated low", () => {
    const logs: HandoffLog[] = [
      { timestamp: iso(at(10, 42)), kind: "meal", title: "Low treated: 4 glucose tabs", detail: "16g carbs", authorName: "Holly (school nurse)", byYou: false },
      { timestamp: iso(at(11, 58)), kind: "insulin", title: "Humalog 2 units", authorName: "Holly (school nurse)", byYou: false },
      { timestamp: iso(at(11, 55)), kind: "meal", title: "Turkey sandwich", detail: "32g carbs", authorName: "Holly (school nurse)", byYou: false },
      { timestamp: iso(at(7, 10)), kind: "meal", title: "Waffles", detail: "45g carbs", authorName: "Brian", byYou: false },
    ];
    const items = dayRecapItems(logs, at(8), at(15), fmt);
    expect(items.map((i) => i.title)).toEqual(["Humalog 2 units", "Turkey sandwich", "Low treated: 4 glucose tabs"]);
    expect(items[2]).toMatchObject({ icon: "low", sub: "16g carbs · 10:42 AM · Holly" });
  });
});
