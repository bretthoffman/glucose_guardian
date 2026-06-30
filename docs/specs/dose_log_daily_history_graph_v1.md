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

## Shared long-press data cursor (Home + Log)

Both Home rolling-window graphs and Log calendar-day graphs share one interaction implementation in `CGMChart` — no duplicate gesture logic per screen.

### Architecture

| Layer | File | Role |
|-------|------|------|
| Plot points | `utils/cgmChartCursor.ts` | `buildChartPlotPoints` — filtered readings with plot `x`, `y`, `glucose`, `timestamp` |
| Nearest reading | `utils/cgmChartCursor.ts` | `nearestReadingIndex` — binary search on sorted X positions |
| Gesture | `hooks/useCgmChartCursorGesture.ts` | Long-press timer, quick-tap vs hold, PanResponder for active drag |
| Overlay | `components/CgmChartCursorOverlay.tsx` | Vertical guide, selected-point marker, floating readout |

### Activation gesture

- **Quick tap** (`< 250 ms`, movement `< 12 px`): toggles line/dot mode (unchanged persistence).
- **Touch and hold** (`350 ms`): activates cursor; does **not** toggle mode.
- **Hold + horizontal drag**: moves between readings; does not toggle mode.
- **Vertical scroll intent** (`> 14 px` before activation): cancels long-press timer so parent `ScrollView` can scroll.
- **Release / cancel / background / range-day change / unmount**: hides cursor and readout; suppresses delayed tap after cursor use.

Uses React Native `PanResponder` + view `onTouch*` handlers (no new native dependency).

### Nearest-reading snapping

1. Finger X → `nearestReadingIndex` on pre-sorted plot X values (binary search).
2. Cursor snaps to that reading’s actual `x` coordinate.
3. Readout shows stored `glucose` and `timestamp` — **no interpolation** between points.
4. Empty graph: long-press is a no-op (no fabricated cursor).

### Cursor rendering

- SVG vertical line spanning plot height (`textMuted`, 1px, 85% opacity).
- Temporary selected-point marker (halo + center dot) at exact reading coordinate; does not alter permanent latest-point marker.
- Overlay is `pointerEvents="none"` — does not block gestures.

### Floating readout

- Compact card near top of plot: glucose value + local time (e.g. `167 mg/dL` / `2:15 PM`).
- **Vertical placement:** `chartCursorTooltipTop` — stable Y derived from chart value 350 (between 300–400 grid band).
- **Horizontal placement:** `chartCursorTooltipLeft` — centers on cursor with 4px inset clamping so text stays inside plot and off right-axis labels.

### Scope

| Graph | Selectable readings |
|-------|---------------------|
| Home 3H / 6H / 12H / 24H | Filtered rolling window only; range change resets cursor |
| Log selected day | Local midnight inclusive → next midnight exclusive; day change resets cursor |

Log tooltip shows **time only** contextually (date is above graph); Home shows full local time — both use `formatChartCursorTime`.

### Line vs dot mode

Identical snapping — both modes use the same underlying plot points (line segments connect these coordinates; dots render at the same locations).

### Performance

- Sorted X array memoized with plot points.
- Binary search per move (not full scan).
- `setSelectedIndex` only when nearest index changes during drag.
- No backend queries or persistence during cursor use.

### Accessibility

- Graph accessibility hint mentions touch-and-hold to inspect readings.
- No per-point VoiceOver spam while dragging.
- Existing reading lists (Home Recent Readings, etc.) remain available for non-touch inspection.

### Tests

`artifacts/mobile/utils/cgmChartCursor.test.ts` — snapping, gesture thresholds, tooltip clamping, scope helpers, empty/single-reading edge cases.

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
| `artifacts/mobile/utils/*.test.ts` | Boundary/axis/food/cursor tests |
| `artifacts/mobile/utils/cgmChartCursor.ts` | Shared cursor plot points + nearest-reading + tooltip layout |
| `artifacts/mobile/hooks/useCgmChartCursorGesture.ts` | Long-press / tap gesture controller |
| `artifacts/mobile/components/CgmChartCursorOverlay.tsx` | Vertical cursor + readout overlay |

## Pre-existing unrelated changes (preserved)

- `artifacts/mobile/app/(tabs)/insulin.tsx` — Dose header layout + Calculator spacing (prior package)
- `artifacts/mobile/utils/doseScreenHeaderLayout.ts` (+ test)

## Tests

- `localDayBoundaries.test.ts` — midnight boundaries, future nav, DST window length
- `calendarDayXAxis.test.ts` — two-hour label sequence and edge positions
- `logDayEntries.test.ts` — food day filtering
- `patientGlucose.test.ts` — Convex day-range inclusive/exclusive + auth
- `cgmChartCursor.test.ts` — long-press cursor snapping, gesture thresholds, tooltip layout
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
