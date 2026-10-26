import { describe, expect, it } from "vitest";
import { parseLabExtraction } from "./labs";

describe("parseLabExtraction", () => {
  it("keeps real results, one per dated row, and drops junk", () => {
    const raw = JSON.stringify({
      results: [
        { test: "a1c", name: "Hemoglobin A1c", value: 7.8, unit: "%", takenOn: "2026-10-26" },
        { test: "glucose", name: "Glucose, Whole Blood", value: "142", unit: "mg/dL", refRange: "70.0 - 100.0 mg/dL", takenOn: "2026-10-26" },
        { test: "celiac", name: "tTG IgA", value: null, valueText: "Negative", takenOn: "Oct 26" },
        { test: "other", name: "User Id", value: null },
        { test: "a1c", name: "Hemoglobin A1c", value: 78 },
        { name: "" , value: 5 },
      ],
    });
    const out = parseLabExtraction("```json\n" + raw + "\n```");
    expect(out).toEqual([
      { test: "a1c", name: "Hemoglobin A1c", value: 7.8, unit: "%", takenOn: "2026-10-26" },
      { test: "glucose", name: "Glucose, Whole Blood", value: 142, unit: "mg/dL", refRange: "70.0 - 100.0 mg/dL", takenOn: "2026-10-26" },
      { test: "celiac", name: "tTG IgA", valueText: "Negative" },
    ]);
  });
  it("returns nothing for unreadable output", () => {
    expect(parseLabExtraction("not json")).toEqual([]);
    expect(parseLabExtraction("{}")).toEqual([]);
  });
});
