# Dose Calculator Accuracy Audit — 01

**Scope:** audit only, no implementation. Why the Dose-tab recommendation is right for isolated/simple doses but wrong (almost always **low**) in strings of real-world use; what variables are missing; whether high-glucose corrections and food need separate handling.

**Where the math lives:** `artifacts/mobile/utils/dose.ts` (`computeDose`), `utils/onBoard.ts` (IOB/COB), `utils/trend.ts` (trend), `utils/basalDose.ts` (basal), settings from onboarding → `patientProfiles` → `GlucoseContext` (`carbRatio`, `correctionFactor`, `targetGlucose`). The AI prediction layer (`/predict`) is visualization-only and never changes the number — calculator inaccuracy is purely this deterministic formula plus its inputs.

---

## 1. What the calculator computes today

```
dose = round0.5( max(0,  carbs/CR  +  COB/CR  +  (BG − target)/CF  +  trendAdj  −  IOB ) )
```

- **CR / CF / target:** one value each, all day, set once at onboarding (defaults **CR 40, CF 50, target 120** when fields are skipped), editable later, shared to the circle. No breakfast/lunch/dinner segmentation, no learning.
- **trendAdj:** flat units from the Dexcom arrow — +0.5 / +0.25 / 0 / −0.25 / −0.5.
- **IOB:** every non-basal logged dose, **linear** decay over 4 h (rapid) / 6 h (regular). Subtracted from the **whole total**, meal portion included.
- **COB:** logged food carbs, linear decay over **3 h**, added back as carbs.
- Correction suppressed below target; low/high/spike/falling/IOB-covers warnings exist (single blended message).

---

## 2. The screenshot day, reconstructed

Modeled IOB (4 h linear) at the moment of each recommendation:

| Time | Given | Rec | IOB at that moment | Match? |
|---|---|---|---|---|
| 2:46 AM | 0.5u | 0.5u | **0** | ✓ |
| 5:34 AM | 2u | 1u | 0.15u | ✗ (+1) |
| 11:27 AM | 2u | 0.5u | **0** | ✗ (+1.5) |
| 12:43 PM | 1.5u | 0.5u | 1.37u | ✗ (+1) |
| 1:41 PM | 1u | 0u | 2.02u | ✗ (+1) |
| 2:59 PM | 2.5u | 0u | 1.56u | ✗ (+2.5) |
| 5:01 PM | 1.5u | 0u | 1.40u | ✗ (+1.5) |
| 8:51 PM | 1.5u | 1.5u | ~0.06u | ✓ |

The two exact matches are **exactly the moments modeled IOB ≈ 0**. Every "Rec 0" sits on 1.4–2u of modeled IOB. From 12:43–5:01 the family delivered ~6.5u against ~1u recommended — and glucose presumably stayed high, which means the modeled IOB **was not actually working as credited**. This is not "ratios too weak overall" (that would break the 2:46 AM and 8:51 PM matches too); it's the stacking model eating chained daytime doses.

---

## 3. Root causes, ranked

### R1 — IOB is subtracted from the *meal* portion (biggest driver)
Industry bolus calculators (Medtronic Bolus Wizard, Tandem t:slim, Omnipod) subtract IOB **only from the correction portion** — food insulin is never reduced by prior insulin, because the prior dose was for *prior* food. Ours subtracts IOB from the entire total, so lunch's carb dose gets eaten by breakfast's tail. COB partially compensates (it re-adds the old meal's carbs), but asymmetrically → R2.

### R2 — COB dies at 3 h while IOB lives 4 h, and both decay linearly
In hours 3–4 after a meal+dose, the insulin still *counts against you* but the carbs no longer *count for you*. Linear IOB also overstates remaining insulin mid-window vs. the real activity curve (the code comments call this "the safe direction" — safe against hypos, but it is precisely the systematic under-dose in the screenshot). Corrections that provably failed (BG never fell) still get full IOB credit.

### R3 — No hyperglycemia mode (your 400 mg/dL case)
At 400: correction = (400−120)/50 = 5.6u, then **falling trend subtracts**, then stale IOB from previous too-small corrections subtracts, and the result collapses to ~0.5u → the under-correction spiral: each tiny dose adds IOB that suppresses the next recommendation, while BG never moves. Missing vs. standard practice:
- **No IOB-effectiveness check** — if BG has been flat/rising ≥45–60 min despite >1u IOB, that credit is demonstrably not materializing (Loop calls this retrospective correction).
- **No insulin-resistance scaling** — above ~250 mg/dL effective ISF worsens (glucotoxicity); many pediatric protocols add 10–20% or use a sliding tier.
- **Falling-trend subtraction applies at any BG** — a ↘ at 400 still means "very high"; the subtraction should attenuate (or only warn) above a threshold.
- **No ketone prompt / escalation** at >250–300 sustained (check ketones, consider pen vs. site, call the care team), though the high-BG *warnings* do exist.

### R4 — One CR/CF for the whole day, never tuned
The 5:34 AM and 11:27 AM misses had **zero IOB** — they're a settings-strength problem: breakfast insulin need is typically the day's highest (dawn phenomenon), and kids' ratios drift week to week. There is no per-time-of-day CR/CF and **no learning loop — even though the data to tune is already stored** (`InsulinLogEntry.recommendedUnits` vs `units` + `manualOverride`, plus CGM outcomes). A recurring "family gives ~2× the rec at breakfast" pattern is computable today from existing logs.

### R5 — Food is a single carb integer
`FoodLogEntry` = `estimatedCarbs` only; quick foods are stored as **name strings**; the photo AI is asked for only `estimatedCarbs`. Missing signals the model could already return:
- **Fat/protein** — pizza/nuggets/mac-and-cheese delay and extend the rise (Warsaw method: ~100 kcal fat/protein ≈ 1 "fat-protein unit" dosed later). A carbs-only model under-doses these meals *and* the late rise then gets under-corrected because the mealtime dose is still "on board" (compounds R1/R3).
- **Absorption speed / GI** — juice vs. oatmeal at identical grams need different timing; the lookup table already *writes GI hints in the tips prose* but nothing consumes them.
- ⚠️ The photo prompt says **"Estimate generously for safety"** — for insulin dosing, generous carb estimates are the *unsafe* direction (over-dose → hypo). Wrong-way instruction.

### R6 — Trend adjustment is flat units, not scaled to the child
±0.25/0.5u means wildly different things at ISF 150 (toddler) vs ISF 25 (teen). Published approaches (Scheiner; DirecNet) scale by ~10–20% of the dose or by projected-30-min-delta ÷ ISF. Flat units happens to suit one body size only.

### R7 — Age/weight: collected, barely used
Weight seeds only the **basal** starting estimate (0.2 u/kg). The bolus calculator uses neither — which matches standard practice (CR/CF *are* the personalization) — but weight is being left on the table for: seeding smarter onboarding defaults (500/1800 rules from estimated TDD instead of flat CR 40/CF 50), and a **weight-based max single-bolus sanity cap** (there is currently **no cap of any kind** on the recommended dose).

### R8 — Blank-onboarding defaults are arbitrary
CR 40 / CF 50 / target 120 regardless of a 30-lb toddler or 160-lb teen. Fine as placeholders, but nothing ever flags "your settings look untouched and your family overrides every rec."

---

## 4. Direct answers to your questions

- **Age/weight used?** Weight → basal baseline only. Age → nowhere in dosing. Neither touches the bolus math (normal for bolus calculators, but see R7 for the two legitimate uses).
- **Separate high-BG calculation?** No — one linear correction formula at every BG, with trend subtraction and IOB credit applied even at 400. Warnings exist ("high — verify with finger stick", spike, high-but-falling) but the *number* has no high-BG regime. R3 is the case you described, mechanism confirmed.
- **Stacking warnings already there?** Yes — the "Active Insulin" card, and an info notice when IOB fully covers the dose. The problem isn't missing warnings; it's that the IOB *model* over-credits (R1/R2) and never checks whether the credited insulin is actually working (R3).
- **Food factors we're missing?** Fat, protein, absorption speed — none captured from photos or quick picks, all achievable with the existing AI call (R5), plus the "estimate generously" prompt pointing the wrong way.

## 5. Improvement candidates (priority order, for a future pass)

1. **Stop subtracting IOB from the carb portion** (subtract from correction only, floor 0) — single highest-impact change; directly fixes the daytime Rec-0 collapse. Pair with revisiting the COB add (they were compensating for each other).
2. **Curvilinear IOB** (standard Walsh/bilinear curve) + align COB window to meal reality (~3.5–4 h).
3. **Hyperglycemia regime:** above ~250 — attenuate/zero the falling-trend subtraction, apply an IOB-effectiveness check before crediting stale corrections, optional resistance bump, ketone/escalation guidance in the warning.
4. **Settings audit surface:** mine `recommendedUnits` vs `units` per time-of-day and show "your breakfast ratio looks ~2× too weak" (recommendation to the family / doctor portal proposal — not silent auto-tuning).
5. **Per-time-of-day CR/CF** (breakfast/lunch/dinner/night), doctor-editable via the existing treatment-proposal flow.
6. **Food v2:** photo + quick-pick AI returns `{carbs, fatG, proteinG, absorption: fast|medium|slow}`; store on `FoodLogEntry`; slow meals get a "recheck in 2 h — delayed rise likely" nudge before any formula change. Remove "estimate generously."
7. **ISF-scaled trend adjustment** (projected 30-min delta ÷ ISF, capped) instead of flat ±0.5u.
8. **Max-dose sanity cap** (weight-based when weight exists) + smarter onboarding defaults via 500/1800 rules.

**Safety framing:** every change above moves recommendations *up* in some situation — the current design errs low by construction. Items 1–3 realign us with what commercial bolus calculators already do, but this is exactly the territory to sanity-check with the care team (and the doctor-portal proposal flow is the natural gate for per-family changes like #4/#5).

## 6. What's right and should not change

Correction suppression below target; basal fully separated from meal math (weight-seeded, fasting-titrated); low-glucose "treat first, don't dose" gate; the single blended warning; prediction layer kept out of the calculator; quarter-unit override UX; `recommendedUnits`/`manualOverride` being logged (it's the future tuning dataset).
