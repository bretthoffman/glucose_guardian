import { describe, expect, it } from "vitest";
import { fhirDate, labsFromBundle, nextPageUrl, observationToLab } from "./fhirLabs";

const obs = (extra: object) => ({ resourceType: "Observation", id: "o1", status: "final", effectiveDateTime: "2026-10-26T14:05:00-04:00", ...extra });

describe("MyChart lab results", () => {
  it("maps an A1C by LOINC, keeping the lab's value and date", () => {
    const lab = observationToLab(obs({
      code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood" }], text: "HEMOGLOBIN A1C" },
      valueQuantity: { value: 7.8, unit: "%" },
      referenceRange: [{ low: { value: 4 }, high: { value: 5.6, unit: "%" } }],
    }));
    expect(lab).toEqual({ test: "a1c", name: "A1C", value: 7.8, unit: "%", refRange: "4 to 5.6 %", takenOn: "2026-10-26", source: "mychart", externalId: "o1" });
  });
  it("maps a whole blood glucose and a text celiac result, by name when there's no LOINC", () => {
    expect(observationToLab(obs({ code: { text: "Glucose, Whole Blood" }, valueQuantity: { value: 142, unit: "mg/dL" }, referenceRange: [{ text: "70.0 - 100.0 mg/dL" }] })))
      .toMatchObject({ test: "glucose", value: 142, refRange: "70.0 - 100.0 mg/dL" });
    expect(observationToLab(obs({ code: { text: "Tissue Transglutaminase IgA" }, valueString: "Negative" })))
      .toMatchObject({ test: "celiac", valueText: "Negative" });
  });
  it("ignores everything else: other tests, ids, cancelled, no value, impossible A1C", () => {
    expect(observationToLab(obs({ code: { text: "User Id" }, valueQuantity: { value: 863133 } }))).toBeNull();
    expect(observationToLab(obs({ code: { text: "Sodium" }, valueQuantity: { value: 140 } }))).toBeNull();
    expect(observationToLab(obs({ status: "cancelled", code: { text: "Hemoglobin A1c" }, valueQuantity: { value: 7 } }))).toBeNull();
    expect(observationToLab(obs({ code: { text: "Hemoglobin A1c" } }))).toBeNull();
    expect(observationToLab(obs({ code: { text: "Hemoglobin A1c" }, valueQuantity: { value: 78 } }))).toBeNull();
  });
  it("reads a bundle and its next page", () => {
    const bundle = {
      link: [{ relation: "self", url: "a" }, { relation: "next", url: "b" }],
      entry: [
        { resource: obs({ code: { text: "Hemoglobin A1c" }, valueQuantity: { value: 7.8, unit: "%" } }) },
        { resource: { resourceType: "OperationOutcome" } },
      ],
    };
    expect(labsFromBundle(bundle as never)).toHaveLength(1);
    expect(nextPageUrl(bundle)).toBe("b");
    expect(fhirDate("2026-10-26")).toBe("2026-10-26");
    expect(fhirDate(undefined)).toBeNull();
  });
});
