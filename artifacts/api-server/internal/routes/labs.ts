import { Router, type IRouter } from "express";
import OpenAI from "openai";

/**
 * Lab results read from a photo of a lab report or a patient-portal screen. The app ALWAYS shows
 * what was read for the family to check and fix before anything is saved; nothing here is stored.
 */
const router: IRouter = Router();

const TESTS = ["a1c", "tsh", "celiac", "glucose", "other"] as const;
type LabTest = (typeof TESTS)[number];

export interface ReadLab {
  test: LabTest;
  name: string;
  value?: number;
  valueText?: string;
  unit?: string;
  refRange?: string;
  takenOn?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn the model's JSON into safe, checked results (drops anything malformed or implausible). */
export function parseLabExtraction(raw: string): ReadLab[] {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const list = Array.isArray((parsed as { results?: unknown })?.results) ? (parsed as { results: unknown[] }).results : [];
  const out: ReadLab[] = [];
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const test = (TESTS as readonly string[]).includes(String(r.test)) ? (String(r.test) as LabTest) : "other";
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const num = typeof r.value === "number" ? r.value : typeof r.value === "string" && r.value.trim() !== "" ? Number(r.value) : NaN;
    const value = Number.isFinite(num) ? num : undefined;
    const valueText = typeof r.valueText === "string" && r.valueText.trim() ? r.valueText.trim().slice(0, 60) : undefined;
    if (value == null && !valueText) continue;
    if (test === "a1c" && value != null && (value < 3 || value > 20)) continue;
    const takenOn = typeof r.takenOn === "string" && DATE.test(r.takenOn) ? r.takenOn : undefined;
    out.push({
      test,
      name,
      ...(value != null ? { value } : {}),
      ...(valueText ? { valueText } : {}),
      ...(typeof r.unit === "string" && r.unit.trim() ? { unit: r.unit.trim().slice(0, 20) } : {}),
      ...(typeof r.refRange === "string" && r.refRange.trim() ? { refRange: r.refRange.trim().slice(0, 40) } : {}),
      ...(takenOn ? { takenOn } : {}),
    });
  }
  return out;
}

router.post("/read-photo", async (req, res) => {
  try {
    const { photoBase64: rawBase64, mimeType: rawMime = "image/jpeg" } = req.body ?? {};
    if (!rawBase64) {
      res.status(400).json({ error: "photoBase64 is required" });
      return;
    }
    const photoBase64 = String(rawBase64).replace(/\s/g, "");
    const mime = String(rawMime).toLowerCase();
    const mimeType = mime.includes("heic") || mime.includes("heif") ? "image/jpeg" : mime;

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      fetch: globalThis.fetch,
    });

    const prompt = `This is a photo of a medical lab result (a lab report or a patient portal screen like MyChart). Read ONLY what is printed. Never guess or invent a number.

Respond ONLY with a JSON object, no markdown:
{"results":[{"test":"a1c"|"tsh"|"celiac"|"glucose"|"other","name":"test name as printed","value":<number or null>,"valueText":"text result if not a number, like Negative, else null","unit":"unit as printed or null","refRange":"reference range as printed or null","takenOn":"YYYY-MM-DD collection date if printed, else null"}]}

Use "a1c" for hemoglobin A1c / HbA1c, "tsh" for thyroid stimulating hormone, "celiac" for tTG-IgA or other celiac screens, "glucose" for a single blood glucose. If a screen shows a history table, return one entry per row with its own date. Skip anything that is not a lab result (names, ID numbers, "User Id", locations). If nothing is readable, return {"results":[]}.`;

    const response = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      max_completion_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${photoBase64}` } },
          ],
        },
      ],
    });
    const results = parseLabExtraction(response.choices[0]?.message?.content ?? "{}");
    res.json({ results });
  } catch (err) {
    console.error("Lab photo read error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Couldn't read that photo. Try again, or type the result in." });
  }
});

export default router;
