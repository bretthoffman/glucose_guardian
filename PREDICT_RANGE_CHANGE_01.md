# Predict Range Change 01 — Day-Based History/A1C Windows

The Predict tab's glucose-history and A1C-average range selector has been converted from month-based windows (1M / 3M / 6M / 9M / 12M) to day-based windows (3D / 7D / 14D / 30D / 90D). All downstream calculations and labels tied to that selector were updated accordingly. No other Predict-screen behavior was changed.

## What changed

- `TimeRange` type now represents **days**, not months.
- New user-facing options: **3D**, **7D**, **14D**, **30D**, **90D**.
- Default range changed from `3` (3 months) to `14` (14 days) — matches the standard CGM AGP window and remains a practical default for the new options.
- Cutoff math updated from `timeRange * 30 * 24h` → `timeRange * 24h`.
- Per-day averages (`avgCarbs/day`, `avgInsulin/day`) now divide by `timeRange` directly instead of `timeRange * 30`.
- Button label updated from `{r}M` to `{r}D`.
- A1C card sublabel updated from `Estimated A1C · {N}-month avg` to `Estimated A1C · {N}-day avg`.
- `a1cInsight` copy updated to say "days" instead of "months", and its short-window branch now triggers at `timeRange <= 7` instead of `<= 3`.

## Exact files changed

- `artifacts/mobile/app/(tabs)/insulin.tsx` (Predict section lives inside the insulin screen under the `predict` tab)
- New repo-root markdown: `PREDICT_RANGE_CHANGE_01.md`

No other files were modified. Backend routes, Convex code, dashboard, CGM setup, and home screen are untouched.

## Old range options

| Button | Window               | How window was computed        |
| ------ | -------------------- | ------------------------------ |
| `1M`   | ~30 days             | `timeRange * 30 * 24h`         |
| `3M`   | ~90 days (default)   | `timeRange * 30 * 24h`         |
| `6M`   | ~180 days            | `timeRange * 30 * 24h`         |
| `9M`   | ~270 days            | `timeRange * 30 * 24h`         |
| `12M`  | ~360 days            | `timeRange * 30 * 24h`         |

## New range options

| Button | Window              | How window is computed |
| ------ | ------------------- | ---------------------- |
| `3D`   | 3 days              | `timeRange * 24h`      |
| `7D`   | 7 days              | `timeRange * 24h`      |
| `14D`  | 14 days (default)   | `timeRange * 24h`      |
| `30D`  | 30 days             | `timeRange * 24h`      |
| `90D`  | 90 days             | `timeRange * 24h`      |

## Calculation logic changes

These changes are mechanical — the *shape* of the computation is unchanged, only the window size:

- `rangeReadings` cutoff: `Date.now() - timeRange * 30 * 24 * 60 * 60 * 1000` → `Date.now() - timeRange * 24 * 60 * 60 * 1000`.
- `foodInRange` / `insulinInRange` cutoffs: same fix, now share a single `windowStart` constant.
- `totalDays` for per-day averages: `timeRange * 30` → `timeRange`.
- `a1cInsight` short-window threshold: `timeRange <= 3` (months) → `timeRange <= 7` (days); only affects the wording of the "looking great" insight, not the A1C value itself.
- `estimateA1C` formula `((avgBg + 46.7) / 28.7)` is **unchanged** — it still maps average glucose → estimated HbA1c using the standard eAG formula. Only the input window changes.

Time-in-range, %High, %Low, and avg glucose are all derived from `rangeReadings` and therefore automatically follow the new day-based window without further changes.

## What was intentionally left unchanged

- The A1C formula itself (`estimateA1C`).
- The A1C categorization thresholds (<7 good, <8 needs attention, ≥8 high risk).
- The Predict / Log toggle, dose calculator, suggestions, latest-reading panel, and chart.
- Dashboard A1C export code (`a1cForMonths`, `[3, 6, 9, 12]` month rows) — the dashboard PDF/report export is a separate surface and was intentionally not modified. If you want the exports switched to day-based too, that should be a follow-up.
- Caregiver / child-mode visibility rules (the selector is still hidden for caregivers).
- All styling (`rangeRow`, `rangeBtn`, `rangeBtnText`).

## Caveats

- The `estimateA1C` formula is the CDC/ADA eAG→A1C mapping, which is clinically meaningful over ~90 days. Short windows like `3D` and `7D` will produce a numeric value that technically reflects only that window's average glucose and should be read more as a short-term trend indicator than a true HbA1c estimate. The UI already labels it as "Estimated A1C · N-day avg", which makes this explicit to the user.
- Small windows with sparse data can produce volatile A1C numbers. The existing "No glucose data for this period" fallback renders when `rangeReadings.length === 0`. For 3D/7D the card will simply not render if the user has no readings in that window — no additional insufficient-data handling was added, consistent with the requirement to keep behavior minimal and safe.
- Default changed from `3` to `14`. Users whose previous session had `timeRange === 3` (3 months) will, on next mount, see 3D selected if their persisted state somehow survived — but `timeRange` is `useState`, not persisted, so each new session starts at the default (14D). No migration needed.
- The dashboard export still shows 3/6/9/12-month A1C rows in the shareable PDF / text report. This was explicitly excluded from this change's scope because it lives on a different screen and is part of the clinician-export flow.

## Manual verification checklist

- [ ] Open the Predict tab (insulin screen, "📈 Predict" toggle active).
- [ ] Confirm the range selector row shows five buttons: **3D · 7D · 14D · 30D · 90D**.
- [ ] Confirm **14D** is selected by default on first open.
- [ ] Tap each range button and confirm:
  - [ ] The selected button highlights (primary color background, white text).
  - [ ] The A1C card sublabel updates to `Estimated A1C · {N}-day avg`.
  - [ ] `Time in Range`, `% High`, `% Low` update when the underlying window changes.
  - [ ] `Avg Carbs/day` updates to a sane number (no ×30 inflation and no ÷30 deflation).
- [ ] With no glucose readings in the chosen window, confirm the fallback card renders with "No glucose data for this period. Sync your CGM to see A1C estimates."
- [ ] With readings present, confirm the A1C percentage and the colored badge (Good / Needs Attention / High Risk) still render.
- [ ] Confirm the insight sentence under the A1C card reads "… over the last N day(s)" for 3D and 7D, and "… over the last N days" for 14D / 30D / 90D.
- [ ] Switch to the Log tab and back — behavior unchanged.
- [ ] No new TypeScript or lint errors.
- [ ] Dashboard export (PDF / logs share) still references month-based A1C rows — that's intentional and out of scope for this change.
