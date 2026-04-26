# Dashboard Export Range Change 01 — Day-Based A1C Rows

The dashboard's downloadable text export and full PDF report previously emitted A1C estimates over four month-based windows (3 / 6 / 9 / 12 months). That export now uses the same five day-based windows as the Predict tab (3 / 7 / 14 / 30 / 90 days). Helper logic, output labels, and the export-options checkbox copy were all updated to match.

## What changed

- Renamed and rewrote the helper from `a1cForMonths(months: number)` to `a1cForDays(days: number)` — the cutoff is now `Date.now() - days * 24h`.
- Added a single source-of-truth constant `A1C_EXPORT_RANGES = [3, 7, 14, 30, 90]` used by both the text export and the PDF export.
- Text export A1C section now emits one line per day-window with the label `"{N}-Day A1C Estimate"`.
- PDF export A1C table now emits one row per day-window with the cell label `"{N}-Day"`.
- Export-options card label updated from `"A1C Estimates (3 / 6 / 9 / 12 mo)"` to `"A1C Estimates (3 / 7 / 14 / 30 / 90 days)"`.

## Exact files changed

- `artifacts/mobile/app/(tabs)/dashboard.tsx` (only file modified)
- New repo-root markdown: `DASHBOARD_EXPORT_RANGE_CHANGE_01.md`

No other files were touched. Predict tab, CGM setup, home screen, backend, Convex code, and clinical formulas are unchanged.

## Old export ranges

| Row in export | Window cutoff (per-row)             |
| ------------- | ----------------------------------- |
| `3-Month`     | `now − 3 calendar months`           |
| `6-Month`     | `now − 6 calendar months`           |
| `9-Month`     | `now − 9 calendar months`           |
| `12-Month`    | `now − 12 calendar months`          |

Cutoffs were computed via `cutoff.setMonth(cutoff.getMonth() - months)`, which uses calendar months (variable day counts).

## New export ranges

| Row in export | Window cutoff (per-row)             |
| ------------- | ----------------------------------- |
| `3-Day`       | `now − 3 × 24h`                     |
| `7-Day`       | `now − 7 × 24h`                     |
| `14-Day`      | `now − 14 × 24h`                    |
| `30-Day`      | `now − 30 × 24h`                    |
| `90-Day`      | `now − 90 × 24h`                    |

Five rows now (was four). Ordering is shortest → longest, matching the Predict selector.

## Calculation logic changes

Functionally minimal — only the window definition changed:

- Cutoff math changed from calendar-month subtraction (`setMonth(getMonth() - n)`) to fixed-millisecond subtraction (`Date.now() - n * 24 * 60 * 60 * 1000`). This brings the export in line with how Predict computes its windows.
- `estimateA1C` formula `((avg + 46.7) / 28.7).toFixed(1)` is **unchanged** — same eAG → HbA1c mapping, same precision.
- Insufficient-data guard `if (filtered.length < 3) return null;` is **unchanged** — short windows that lack three readings still render as "Not enough data" / "—" / "Insufficient data" in the respective outputs, exactly as before.
- A1C status thresholds (<7 Good, <8 Needs Attention, ≥8 High Risk) are **unchanged**.

## Caveats

- The eAG → HbA1c formula is clinically meaningful over ~90 days. Over `3-Day` and `7-Day` windows the value should be read as a short-term trend indicator rather than a true HbA1c estimate. The export label "{N}-Day A1C Estimate" is explicit about the window. Clinicians reading the PDF should interpret the short-window rows accordingly. (Same caveat already noted for the Predict tab.)
- The insufficient-data threshold is still 3 readings per window. With CGM-grade data (typically 288 readings/day) this will be trivially satisfied for all five windows. For users on manual logging the `3-Day` row may legitimately render "—" / "Not enough data" — this is intentional and matches prior behavior.
- The PDF row count went from 4 to 5. The `<table>` markup auto-grows; no styles needed to change.
- The change applies to **both** export paths (text `.txt` and HTML/PDF). They share the new `A1C_EXPORT_RANGES` constant so they cannot drift.

## Manual verification checklist

- [ ] Open the Dashboard tab and scroll to "Download Patient Logs".
- [ ] Confirm the A1C Estimates checkbox label reads `A1C Estimates (3 / 7 / 14 / 30 / 90 days)`.
- [ ] Toggle on A1C plus at least one other category, then tap the text export action.
- [ ] In the resulting `.txt` file, confirm the `=== A1C ESTIMATES ===` section has exactly five lines:
  - `3-Day A1C Estimate: …`
  - `7-Day A1C Estimate: …`
  - `14-Day A1C Estimate: …`
  - `30-Day A1C Estimate: …`
  - `90-Day A1C Estimate: …`
- [ ] Tap the full PDF export. In the resulting PDF, confirm the **A1C Estimates** table has five rows with `Period` cells reading `3-Day` / `7-Day` / `14-Day` / `30-Day` / `90-Day`, with status mapped to color (green/orange/red) consistent with prior behavior.
- [ ] On a fresh account (no readings), confirm every row reads "Not enough data" (text) and "—" / "Insufficient data" (PDF) — i.e. the existing fallback still works.
- [ ] On an account with only the last hour of readings, confirm `3-Day` shows a value (since 3 readings should exist) and longer windows degrade gracefully.
- [ ] Confirm the text and PDF outputs match each other on the same dataset (same five A1C numbers).
- [ ] No new TypeScript or lint errors.
- [ ] Predict tab is untouched and still shows the 3D / 7D / 14D / 30D / 90D selector.
