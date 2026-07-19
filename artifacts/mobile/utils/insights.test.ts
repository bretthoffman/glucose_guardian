import { describe, expect, it } from "vitest";
import type { GlucoseEntry } from "@/context/GlucoseContext";
import { analyzeReadings } from "./insights";

const NOW = new Date("2026-07-18T20:00:00Z").getTime();

function reading(minutesAgo: number, glucose: number): GlucoseEntry {
  return {
    glucose,
    timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
    anomaly: { warning: false },
  };
}

function analyze(readings: GlucoseEntry[]) {
  return analyzeReadings(readings, 120, false, [], [], NOW);
}

describe("analyzeReadings — live current-state cards", () => {
  it("flags a CURRENT low as urgent, including the live falling rate", () => {
    // Last two readings 5 min apart, dropping 17 → rapidly_falling; latest 55 (< 70).
    const out = analyze([reading(60, 120), reading(40, 110), reading(20, 95), reading(5, 72), reading(0, 55)]);
    expect(out[0].tag).toBe("URGENT");
    expect(out[0].title).toContain("Hypoglycemia");
    expect(out[0].body).toContain("55 mg/dL right now");
    expect(out[0].body).toContain("still falling");
    expect(out[0].body).toContain("mg/dL per minute");
  });

  it("turns a RECOVERED low into a past-tense earlier-today card, not an urgent one", () => {
    const out = analyze([
      reading(200, 120), reading(180, 62), reading(160, 58), reading(140, 78),
      reading(60, 105), reading(30, 110), reading(0, 112),
    ]);
    expect(out.some((s) => s.tag === "URGENT")).toBe(false);
    const recovered = out.find((s) => s.tag === "EARLIER TODAY");
    expect(recovered).toBeDefined();
    expect(recovered!.title).toContain("recovered");
    expect(recovered!.body).toContain("58 mg/dL");
    expect(recovered!.body).toContain("112 now");
  });

  it("describes a CURRENT high with live value and rising movement", () => {
    // Diff +10 over 5 min → rising; latest 220 (> 180).
    const out = analyze([reading(60, 150), reading(40, 185), reading(20, 200), reading(5, 210), reading(0, 220)]);
    const high = out.find((s) => s.title.includes("Elevated now"));
    expect(high).toBeDefined();
    expect(high!.body).toContain("220 mg/dL now");
    expect(high!.body).toContain("rising");
  });

  it("softens a CURRENT high that is already falling — warns against stacking corrections", () => {
    // Diff -20 over 5 min → falling; latest 200 (> 180).
    const out = analyze([reading(60, 250), reading(40, 245), reading(20, 235), reading(5, 220), reading(0, 200)]);
    const high = out.find((s) => s.tag === "IMPROVING");
    expect(high).toBeDefined();
    expect(high!.body).toContain("trending down");
    expect(high!.body).toContain("stack");
  });

  it("turns a RECOVERED high into a past-tense card with the peak time", () => {
    const out = analyze([
      reading(300, 130), reading(280, 240), reading(260, 250), reading(240, 200),
      reading(60, 140), reading(30, 132), reading(0, 128),
    ]);
    expect(out.some((s) => s.title.includes("Elevated now"))).toBe(false);
    const past = out.find((s) => s.title.includes("Earlier high"));
    expect(past).toBeDefined();
    expect(past!.body).toContain("250 mg/dL");
    expect(past!.body).toContain("128 now");
  });

  it("does not celebrate excellent control while currently out of range", () => {
    // 100% of the day in range except the current reading, which is high and stable.
    const out = analyze([
      reading(120, 120), reading(90, 125), reading(60, 130), reading(30, 178), reading(5, 181), reading(0, 182),
    ]);
    expect(out.some((s) => s.title.includes("Excellent"))).toBe(false);
  });
});
