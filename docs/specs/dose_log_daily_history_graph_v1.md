# Dose Log Daily History Graph v1

## Summary

Redesigns the mobile Dose page **Log → Day** view from expandable time-of-day accordions into a fixed **local calendar-day glucose graph** (reusing `CGMChart`) plus a day-scoped **Food Log** list beneath it. Glucose for each selected day is loaded on demand from Convex day-range queries; food and insulin remain filtered from device-local logs.

## Previous Log architecture

- **Component:** `artifacts/mobile/components/LogHistory.tsx`
- **Day view:** Left/right day navigation (`dayOffset`) with labels Today / Yesterday / formatted date.
- **Grouping:** Expandable Morning / Afternoon / Evening / Night buckets; glucose, food, and insulin cards nested inside.
- **Glucose source:** `GlucoseContext.history` from `patientGlucose.listRecent` (last 300 readings), filtered client-side per day.
- **Food/insulin source:** `AuthContext` AsyncStorage (`@gluco_guardian_food_log`, `@gluco_guardian_insulin_log`), filtered client-side.
- **No graph** in Log Day view.

## New day-based architecture

### Layout (Log mode)

1. Shared Dose header (Dose/Log toggle + glucose pill)
2. Selected-day navigation row
3. Historical 24-hour `CGMChart` (`calendarDayWindow`)
4. **Food Log** heading (always visible)
5. Food-log cards or quiet empty message
6. **Insulin Log** heading + cards when insulin entries exist for the day

> **Update (v1.1):** Day / Week / Month / Year selector removed — Log mode is implicitly daily-only.

### Removed from Day view

- Time-of-day accordion sections and related state (`groupedByHour`, `expandedSections`, `sectionSummary` for Day).
- Glucose reading cards beneath the graph (graph replaces them).

### Preserved

- Day navigation behavior (no future days; right arrow disabled on today).
- Food and insulin card styling/format from prior `EntryRow` branches.
- Caregiver `restrictToDay` prop retained on `LogHistory` for API compatibility (no-op; always daily).

## Shared Home graph reuse

`CGMChart` gained optional props:

| Prop | Home (default) | Log historical day |
|------|----------------|-------------------|
| `calendarDayWindow` | — | `{ startMs, endMs }` local midnights |
| `showRangeSelector` | `true` (default) | `false` |
| `emptyMessage` | rolling-window copy | `No glucose readings for this day` |

All rendering math (Y mapping, line/dot modes, gap breaks, shading, thresholds, axis labels, colors) remains in the single `CGMChart` implementation.

**Graph mode persistence:** Shared `@glucose_guardian_graph_display_mode` AsyncStorage key — tap toggles line/dots on both Home and Log graphs.

## Fixed 24-hour domain

- Domain: **selected local midnight inclusive → next local midnight exclusive**.
- Not a rolling last-24-hours window.
- Full day width always shown; sparse/partial days leave empty regions (no interpolation, no future fabrication).
- Latest point in the day receives the same endpoint marker styling (not labeled “live”).

## Timezone and DST

Helpers in `artifacts/mobile/utils/localDayBoundaries.ts`:

- `startOfLocalDay` / `endOfLocalDay` via `setDate(getDate() + 1)` for next midnight.
- `localDayBoundaries()` returns `startMs`, `endMs`, ISO bounds, and `dayKey` (`YYYY-MM-DD`).

**DST strategy:**

- Elapsed window may be 23h or 25h on transition days.
- Reading X positions use real elapsed ms: `(ts - startMs) / windowMs`.
- Two-hour X labels use wall-clock `setHours(hour)` from day start so labels align with local clock times.

## X-axis labels (historical)

`artifacts/mobile/utils/calendarDayXAxis.ts`:

**Two-row layout (v1.1):**

| Row | Content |
|-----|---------|
| 1 | Numeric two-hour ticks: `12  2  4  6  8  10  12  2  4  6  8  10  12` (no AM/PM suffix) |
| 2 | `AM` centered at 25% plot width; `PM` centered at 75% plot width |

- Tick X positions use `calendarDayLabelX()` (same timestamp-to-X mapping as readings).
- Meridiem row uses `calendarDayMeridiemPositions(plotW)`.
- Numeric labels use `calendarDayNumericLabelLayout()` to avoid edge clipping.
- Axis font size: 8.5px for small-screen readability.

**Edge midnight labels (v1.2):** First `12` (hour 0) uses `textAlign: left` at `left: 0`; final `12` (hour 24) uses `textAlign: right` at `left: plotW - labelWidth`. Middle ticks remain center-aligned at their true X coordinates.

## Convex day-range queries

**File:** `convex/patientGlucose.ts`

| Query | Purpose |
|-------|---------|
| `listForDayRange` | Patient auth; `by_user_time` index; `gte` start, `lt` end; asc; limit 500 default / 600 max |
| `listForDayRangeForCaregiver` | Caregiver code auth; same bounds |

**Index used:** existing `patientGlucoseReadings.by_user_time` — no schema change.

### Food logs

Food logs remain **device-local** (AsyncStorage, max 200). Day filtering uses the same local midnight bounds in `logDayEntries.ts`. No Convex food table exists; this is documented as a follow-up if cross-device food history is required.

### Insulin logs

Preserved below food in an **Insulin Log** section when entries exist (device-local, same day filter).

## Client loading and cache

**Hook:** `artifacts/mobile/hooks/useDayGlucoseReadings.ts`

- Opens Log Day → loads today via Convex (or local fallback when offline/unsigned).
- Day change → new bounded query; clears displayed readings during load (no previous-day flash).
- **Cache:** `dayGlucoseCache.ts` — in-memory Map keyed by `dayKey`, max 14 entries, FIFO eviction.
- **Yesterday prefetch:** After today loads successfully, prefetches yesterday in background.
- **Today refresh:** Reacts to `GlucoseContext.history` updates while viewing today.
- **Stale protection:** Monotonic `requestIdRef`; ignored responses cannot overwrite current selection.
- **Sign-out:** Clears day glucose cache.

## Week / Month / Year status

**Removed from Log UI (v1.1).** Log mode is daily-only. Prior Week/Month/Year views were client-side aggregates; they are no longer exposed in the Dose Log tab.

## Files changed (this package)

| File | Change |
|------|--------|
| `artifacts/mobile/components/LogHistory.tsx` | Day view redesign |
| `artifacts/mobile/components/CGMChart.tsx` | Calendar-day window mode |
| `artifacts/mobile/hooks/useDayGlucoseReadings.ts` | On-demand day glucose loading |
| `artifacts/mobile/utils/localDayBoundaries.ts` | DST-safe day bounds |
| `artifacts/mobile/utils/calendarDayXAxis.ts` | Two-hour X labels |
| `artifacts/mobile/utils/dayGlucoseCache.ts` | Session cache |
| `artifacts/mobile/utils/logDayEntries.ts` | Food/insulin day filters |
| `convex/patientGlucose.ts` | Day-range queries |
| `convex/patientGlucose.test.ts` | Query tests |
| `artifacts/mobile/utils/*.test.ts` | Boundary/axis/food tests |

## Pre-existing unrelated changes (preserved)

- `artifacts/mobile/app/(tabs)/insulin.tsx` — Dose header layout + Calculator spacing (prior package)
- `artifacts/mobile/utils/doseScreenHeaderLayout.ts` (+ test)

## Tests

- `localDayBoundaries.test.ts` — midnight boundaries, future nav, DST window length
- `calendarDayXAxis.test.ts` — two-hour label sequence and edge positions
- `logDayEntries.test.ts` — food day filtering
- `patientGlucose.test.ts` — Convex day-range inclusive/exclusive + auth
- Existing `cgmChartAxis.test.ts` — Home axis parity unchanged

## Deployment requirements

1. **Convex:** Deploy `listForDayRange` and `listForDayRangeForCaregiver` to the target backend before mobile clients rely on Log Day graph in production. `npx convex codegen` was run during development (may have synced dev deployment).
2. **Mobile:** OTA-compatible — no native dependency, Expo config, or runtime version changes.

## Rollback plan

1. Revert `LogHistory.tsx` DayView to accordion layout.
2. Remove `calendarDayWindow` usage; Home `CGMChart` remains compatible if props are optional (current design).
3. Convex queries are additive — old clients ignore them; safe to leave deployed or remove in a follow-up.

## Unresolved issues / follow-ups

- Cloud-synced food/insulin day queries (requires new Convex tables + migration).
- Week/Month/Year glucose completeness beyond 300-reading window.
- Optional insulin **Insulin Log** always-visible heading (currently shown only when entries exist).
- Manual visual verification on smallest iPhone, large accessibility fonts, DST transition days.
