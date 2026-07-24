# PREDICTION_AI_PLAN_01 — AI-driven Dose prediction graph

## Goal

Replace the Dose-tab prediction chart's local linear projection (`artifacts/mobile/utils/glucoseForecast.ts` → `forecastGlucose`) with a call to the **same AI model the chat uses** (`openai/gpt-5.2` via the api-server), driven by its **own** prompt + context. The prediction is grounded in three things:

1. the **recent pattern** — the last 3 hours of readings before "now" (5-min cadence, matching the sensor);
2. the **pending inputs** — the calculator's current carb value and the suggested/entered dose;
3. **historical reference patterns** — the top-3 past situations in *this user's own data* that most closely match the current one, selected by a confidence-scored matching algorithm, with the readings around those past events handed to the model as rough analogies.

The design goal is a **data flywheel**: the more the user logs, the more candidate situations exist to match against, the better the references, the better the prediction. Early on (little data) predictions lean on physiology + recent trend; over time they sharpen.

## Real-data tuning (read-only sample of the dev deployment, 2026-07-23)

- Insulin `units`: min 0.5 / median **1.5** / p90 2.5 / max 16 → **DOSE_SCALE = 4u**.
- Food `estimatedCarbs`: min 14 / median **35** / p90 56 / max 120 → **CARB_SCALE = 40g**.
- Glucose: 52–401, median 139 → **BG_SCALE = 100 mg/dL**.
- Reading cadence: median + p90 gap **5.0 min** (clean CGM) → predict 18 pts @ 5 min = 90 min; require ≥12 post-window readings for a usable reference; trend slope over ~20 min (≈4 readings).

These scales/weights are the *starting point* and are isolated as named constants so they can be retuned as data grows.

## Architecture — 3 layers, client-orchestrated

```
insulin.tsx  (Predict tap only)
   │  { currentBG, doseUnits, carbsGrams, nowMs }
   ▼
[1] Convex  predictionReferences (query)         matching algorithm, on the data, circle-bucket + auth
   │  → { currentTrend, currentReadings3h[], references: top-3, strength, strengthLabel }
   ▼
[2] client assembles request (+ ISF, carbRatio, insulin DIA, pending dose/carbs)
   │  POST /api/predict
   ▼
[3] api-server /api/predict                       model gateway: prediction prompt + OpenAI + JSON parse
   │  → { predictions: number[18] }
   ▼
insulin.tsx → ForecastPoint[] → DosePredictionChart
```

Rationale: the **matching** (heavy, data-local, testable) belongs in Convex; the **prompt** belongs server-side in the api-server so it iterates without an app release; the api-server owns the OpenAI key; the client orchestrates exactly as it already does for chat. Fallback to the local `forecastGlucose` model on any failure so the chart is never empty.

## Layer 1 — reference matching (`convex/predictionReferences.ts` + pure `convex/predictionMatch.ts`)

Auth mirrors `careLogs`: a guardian (owner/active co-guardian) **or** an access code, reading the **circle shared bucket** (`circleBucketFor`) so pooled family history counts.

**Candidate events** = each historical **insulin log**; any **food log within ±15 min** is associated as that event's carbs (the carb↔insulin cross-match). Correction-only events → carbs 0.

**Hard filters (validity):**
- **Post-window must be clean:** no other insulin/carb log in `(event, event+90min]` — a later dose/meal contaminates the outcome, so it can't be a reference.
- **Enough outcome readings:** ≥12 readings in the post 90 min (else CGM-gap → unusable).

**Per-event features** (denormalized where possible — see below): `bgAtEvent`, `trendBucket` (5 buckets), `carbsAtEvent`, `units`.

**Confidence score** (weighted sum, 0..1; starting weights):

| Dimension | Formula | Weight |
|---|---|---|
| BG proximity | `1 − min(1, |curBG − eventBG| / 100)` | 0.28 |
| Dose proximity | `1 − min(1, |curDose − eventUnits| / 4)` | 0.24 |
| Carb proximity | `1 − min(1, |curCarbs − eventCarbs| / 40)` | 0.20 |
| Prior-trend match | same bucket 1.0 · off-by-one 0.5 · off-by-two 0.2 · opposite 0 | 0.16 |
| Prior-logs-in-window | current's logs in `[now−3h,now)` vs candidate's in `[event−3h,event)` by type + timing(±30m) + amount; both-empty=1, one-sided=penalty | 0.12 |

**Trend buckets** (same fn for current + every candidate; slope over ~20 min before the event, mg/dL·min): `rising_fast >+2.0`, `rising_slow +0.7..+2.0`, `steady −0.7..+0.7`, `falling_slow −2.0..−0.7`, `falling_fast <−2.0`.

Take **top 3** by confidence. For each, return `{ units, carbs, startBG, trendBucket, pre[] (3h @ ~20min), post[] (1.5h @ ~10min), confidence }`. **Surrounding logs are used only for scoring — never sent to the model.**

**Strength indicator** (combines the chosen references "smartly"): `strength = mean(confidences) × countFactor` where `countFactor = {1:0.8, 2:0.92, 3:1.0}` — match quality scaled by corroboration → label buckets: `<0.32 building` · `0.32–0.55 rough` · `0.55–0.72 good` · `>0.72 strong`. A single near-perfect analogy still reads "strong"; a lone weak match reads "rough"; no references reads "building — log more".

**Performance decision (chosen — two-pass narrowing, no schema change):** rather than denormalize per-event features onto the log rows (which needs a schema field, a write-path change, and a backfill, and still requires scanning all logs), the query narrows in passes so reading reads stay bounded regardless of total data:
- **Candidate cap:** consider the most recent ~600 insulin logs (`by_patient_time` desc). Recency is also *better for accuracy* — insulin sensitivity/growth drift over time, so recent history is the more relevant analogy set.
- **Pass 1 (log-only, no reading reads):** score the dimensions that don't need readings — dose (0.24) + carb (0.20, via ±15m food) + prior-logs (0.12) — and apply the contamination hard-filter (post-window log scan) + carb association, all from the indexed log stream. Rank by this partial score; keep a generous shortlist (~top 24) so a strong BG/trend match is very unlikely to be dropped.
- **Pass 2 (readings for the shortlist):** fetch a small window per shortlisted candidate to derive `bgAtEvent` + `trendBucket`, complete the score (add BG 0.28 + trend 0.16), take the top 3.
- **Pass 3 (readings for the final 3):** fetch the full pre-3h / post-1.5h windows for the prompt.

This touches no schema and no write path, works on *all* existing history with no backfill, and bounds reading reads to ~24 small + 3 full windows per prediction (which only fires on an explicit Predict tap). Denormalization was rejected: with the recency cap the candidate count is already bounded, so its only saving (a handful of Pass-2 windows) doesn't justify the migration + hot-path cost.

## Layer 3 — `/api/predict` (api-server)

New `routes/predict.ts`, same OpenAI client/model/env as `routes/chat.ts`, own prompt:
- **System:** glucose-prediction engine; output ONLY `{"predictions":[18 ints]}`, one per 5 min for 90 min; analyze the 3h trend, apply the pending dose+carbs, use the references as rough analogies from this same person; clamp 40–400; no prose.
- **Context:** current BG + 3h readings @5min; pending dose (units + DIA) + carbs (even 0); ISF + carb ratio; classified recent trend; the top-3 reference windows (start BG, units, carbs, lead-in + outcome readings, confidence) with framing "use freely to shape magnitude/curve, but current data takes priority."
- `max_completion_tokens ≈ 500`; parse JSON with a bracket-extraction fallback; validate exactly 18 finite numbers or signal failure (client falls back to the local model).

## Layer 2/UI — mobile (`predictionClient.ts`, `insulin.tsx`, `DosePredictionChart.tsx`)

- **Predict-tap only:** the graph **never** recomputes automatically. Changing carbs/dose does nothing to the graph until **Predict** is tapped again. Implementation: a `predictionSnapshot` state (forecast pts + strength + the inputs it ran with); the chart renders the snapshot; the button runs a fresh prediction. When current inputs differ from the snapshot's, show a subtle "inputs changed — tap Predict to update" hint.
- **Building state:** while the request is in flight, the chart shows real readings + Now immediately and a "Building prediction…" status over the future region (pulsing placeholder).
- **Strength indicator:** after the run, a small color-coded pill under the chart shows the strength label (building / rough / good / strong) from Layer 1.
- **Fallback:** any failure/timeout/invalid response → draw the local `forecastGlucose` result (kept as the degrade path), labeled as an estimate.
- `predictionClient.ts` caches by rounded (BG5, dose0.5, carbs5) so an immediate re-tap with identical inputs is free.

## Files

- **New** `convex/predictionMatch.ts` (pure scoring/buckets/strength) · `convex/predictionReferences.ts` (two-pass query) · `convex/predictionReferences.test.ts`. No schema or write-path changes.
- **New** `artifacts/api-server/internal/routes/predict.ts` · **edit** `routes/index.ts`.
- **New** `artifacts/mobile/utils/predictionClient.ts` · **edit** `app/(tabs)/insulin.tsx` (Predict-only flow) · `components/DosePredictionChart.tsx` (loading + async + strength). Keep `glucoseForecast.ts` as fallback.

## Testing

- `predictionMatch` pure unit tests (bucket thresholds, each scoring dim, strength combine).
- `predictionReferences` Convex tests (candidate selection, ±15m carb association, post-window contamination filter, prior-logs bonus, top-3 order, guardian + code auth, circle bucket).
- Keep the suite green (baseline 339 pass / 7 pre-existing `doctor.test.ts` fails) + mobile & convex tsc clean.

## Deploy

Convex (new query only, no schema change) → dev via `codegen`, prod via `convex deploy`. api-server `/predict` → Vercel redeploy. Mobile → OTA. Until the api-server route is deployed the client fallback keeps the chart working with the local model.
