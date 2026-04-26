# Dexcom Debug Change 01 — Sync Result Visibility

Smallest-safe UX/debug change that makes the mobile CGM sync flow self-diagnosing. The previous flow could complete with `0` readings (or fail silently on auto-sync) without any visible feedback. After this change, every sync produces a status that is visible in the home-screen header, and non-silent syncs distinguish between "session expired", "0 readings", and generic failure.

## What changed

- Added a small `SyncResult` state on the home screen that records the outcome of every sync attempt (auto and manual).
- `performSync` now records that outcome in all four branches: `ok` (with count), `zero` (server returned an empty array), `session_expired` (HTTP 401 or message hints at session expiry), and `error` (network or 5xx failure).
- The CGM pill in the home-screen header now shows that result (color + label) instead of just a "5m ago" timestamp.
- On non-silent syncs (manual "Sync Now" or pull-to-refresh) the empty-readings case now triggers a dedicated **"No Readings Returned"** alert that explains the most common causes (Dexcom Share off, sensor inactive, Outside US toggle wrong) and offers a "Reconnect" shortcut.
- The existing 401 "Reconnect / OK" alert behavior is preserved; we only made the underlying state observable.

## Exact files changed

- `artifacts/mobile/app/(tabs)/index.tsx` (only file modified)
- New repo-root markdown: `DEXCOM_DEBUG_CHANGE_01.md`

No other files were touched. Auth, Convex, doctor, backend Dexcom routes, and the cgm-setup screen are unchanged.

## New sync states/results surfaced

Header caption under the "Dexcom" / "Libre" pill now reflects the most recent sync:

| Status              | Trigger                                                                                  | Caption text             | Color        |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------ | ------------ |
| `ok`                | `readings.length > 0`                                                                    | `12 new · 5m ago`        | success      |
| `zero`              | HTTP 200 with `readings.length === 0`                                                    | `0 readings · 5m ago`    | warning      |
| `session_expired`   | HTTP 401, or error body matches `/session\|expired\|reconnect/i`                         | `Session expired · ...`  | danger       |
| `error`             | Any other non-OK response, JSON parse failure, or thrown network error                   | `Sync failed · ...`      | danger       |

Additional behavior:

- On a manual sync that lands in the `zero` state, the user now sees an alert titled **"No Readings Returned"** with device-specific diagnostic hints and a "Reconnect" action. Auto-syncs remain silent (no toast spam) but still update the header caption.
- On disconnect, the sync result is cleared along with the existing `cgmLatestReading` clear.

## What was intentionally left unchanged

- Auto-sync cadence (5 minutes) and `AppState` re-sync trigger.
- The 401 "Sync Failed → Reconnect / OK" alert path.
- `bulkAddReadings`, dedup-by-timestamp, Convex flush, glucose history capping.
- Backend `cgm.ts` — no route, response shape, or logging changes.
- `AuthContext`, `GlucoseContext`, `cgm-setup.tsx`, doctor sync, alert prefs, Convex client.
- The "Synced!" success alert on manual sync (still fires when readings > 0).
- The `lastSyncTime` state is still updated only when readings > 0 so any downstream dependency on "successful sync" is preserved; the new `lastSyncResult` is purely additive.

## Manual verification checklist

User A (working account):

- [ ] Pull-to-refresh on the home screen → caption shows `N new · Just now` in green.
- [ ] Wait 5 minutes (or background/foreground the app) → caption updates after auto-sync.
- [ ] Disconnect Dexcom from `cgm-setup` → home screen pill returns to "Connect CGM" with no caption.

User B (no readings appear):

- [ ] Open the app and sign in → wait for the first auto-sync to complete.
- [ ] Confirm the header caption now reads either `0 readings · Just now` (orange) or `Session expired · Just now` (red) instead of being blank. This is the diagnostic signal we added.
- [ ] Tap "Sync Now":
  - If `0 readings` → alert "No Readings Returned" appears with hint about Share / sensor / Outside US toggle.
  - If `Session expired` → existing "Sync Failed → Reconnect" alert appears.
- [ ] Tap "Reconnect" from either alert → routes to `/cgm-setup`.
- [ ] Toggle "Outside US" if applicable, reconnect, return home, observe whether next sync flips from `0 readings` to `N new`.

Cross-cutting:

- [ ] No new TypeScript or lint errors (`tsc`/`pnpm lint`).
- [ ] No regression in the success alert ("Synced! N readings imported …") on a manual sync with readings.
- [ ] The relative-time portion of the caption ages correctly (the existing `labelTimer` `forceUpdate` every 30s already drives this).
- [ ] Switching between accounts on the same device shows the new caption only after the new account's first sync completes.
