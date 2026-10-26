/**
 * MyChart (Epic, SMART on FHIR R4) lab results → our lab results. Pure, unit-tested.
 *
 * Only lab Observations the app understands are kept (A1C, TSH, celiac screen, blood glucose), by
 * LOINC code or, failing that, the name. Everything else in the chart is ignored. Values are copied
 * exactly as the lab reported them; the FHIR id becomes `externalId` so a re-import never duplicates.
 */
import type { LabResult, LabTest } from "./labs";

const LOINC: Record<string, LabTest> = {
  // Hemoglobin A1c
  "4548-4": "a1c",
  "4549-2": "a1c",
  "17856-6": "a1c",
  "59261-8": "a1c",
  "62388-4": "a1c",
  // TSH
  "3016-3": "tsh",
  "11580-8": "tsh",
  // Celiac screen: tissue transglutaminase IgA
  "31017-7": "celiac",
  "56537-5": "celiac",
  "46128-5": "celiac",
  // Glucose (blood / serum / plasma / capillary)
  "2339-0": "glucose",
  "2345-7": "glucose",
  "41653-7": "glucose",
  "32016-8": "glucose",
};

function testFromName(name: string): LabTest | null {
  const n = name.toLowerCase();
  if (/a1c|hba1c|glycated hemoglobin|hemoglobin a1/.test(n)) return "a1c";
  if (/\btsh\b|thyroid stimulating/.test(n)) return "tsh";
  if (/transglutaminase|ttg|celiac/.test(n)) return "celiac";
  if (/^glucose|blood glucose|glucose,/.test(n)) return "glucose";
  return null;
}

const SHORT_NAME: Record<LabTest, string> = {
  a1c: "A1C",
  tsh: "Thyroid (TSH)",
  celiac: "Celiac screen",
  glucose: "Glucose (blood draw)",
  other: "Lab result",
};

type Coding = { system?: string; code?: string; display?: string };
type Quantity = { value?: number; unit?: string; code?: string };
interface FhirObservation {
  resourceType?: string;
  id?: string;
  status?: string;
  code?: { coding?: Coding[]; text?: string };
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: { text?: string; coding?: Coding[] };
  effectiveDateTime?: string;
  issued?: string;
  referenceRange?: { text?: string; low?: Quantity; high?: Quantity }[];
}

/** "2026-10-26T14:05:00-04:00" → "2026-10-26" (the date as the lab wrote it, no timezone shift). */
export function fhirDate(s: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s ?? "");
  return m ? m[1]! : null;
}

function rangeText(r: FhirObservation["referenceRange"]): string | undefined {
  const first = r?.[0];
  if (!first) return undefined;
  if (first.text) return first.text;
  const lo = first.low?.value;
  const hi = first.high?.value;
  if (lo != null && hi != null) return `${lo} to ${hi}${first.high?.unit ? ` ${first.high.unit}` : ""}`;
  return undefined;
}

/** One Observation → a lab result, or null when it isn't one we show (or is cancelled / empty). */
export function observationToLab(obs: FhirObservation): Omit<LabResult, "id"> | null {
  if (obs.resourceType && obs.resourceType !== "Observation") return null;
  if (obs.status && !["final", "amended", "corrected", "preliminary"].includes(obs.status)) return null;
  const codings = obs.code?.coding ?? [];
  const loinc = codings.find((c) => (c.system ?? "").includes("loinc") && c.code && LOINC[c.code]);
  const labelled = obs.code?.text ?? codings.find((c) => c.display)?.display ?? "";
  const test: LabTest | null = loinc ? LOINC[loinc.code!]! : testFromName(labelled);
  if (!test) return null;
  const takenOn = fhirDate(obs.effectiveDateTime) ?? fhirDate(obs.issued);
  if (!takenOn) return null;
  const q = obs.valueQuantity;
  const value = q?.value != null && Number.isFinite(q.value) ? q.value : undefined;
  const valueText = value == null ? (obs.valueString ?? obs.valueCodeableConcept?.text ?? obs.valueCodeableConcept?.coding?.[0]?.display) : undefined;
  if (value == null && !valueText) return null;
  if (test === "a1c" && value != null && (value < 3 || value > 20)) return null;
  const unit = q?.unit ?? (q?.code === "%" ? "%" : undefined);
  const refRange = rangeText(obs.referenceRange);
  return {
    test,
    name: SHORT_NAME[test],
    ...(value != null ? { value } : {}),
    ...(valueText ? { valueText: valueText.slice(0, 60) } : {}),
    ...(unit ? { unit: unit === "% of total Hgb" || unit === "%{HbA1c}" ? "%" : unit } : {}),
    ...(refRange ? { refRange } : {}),
    takenOn,
    source: "mychart",
    ...(obs.id ? { externalId: obs.id } : {}),
  };
}

/** Every lab we show from a FHIR search Bundle (entries can also hold OperationOutcomes; skipped). */
export function labsFromBundle(bundle: { entry?: { resource?: FhirObservation }[] } | null | undefined): Omit<LabResult, "id">[] {
  const out: Omit<LabResult, "id">[] = [];
  for (const e of bundle?.entry ?? []) {
    const lab = e.resource ? observationToLab(e.resource) : null;
    if (lab) out.push(lab);
  }
  return out;
}

/** The FHIR server's "next page" link, if any. */
export function nextPageUrl(bundle: { link?: { relation?: string; url?: string }[] } | null | undefined): string | null {
  return bundle?.link?.find((l) => l.relation === "next")?.url ?? null;
}
