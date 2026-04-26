# Dexcom Multi-User Debug Plan

Diagnostic plan for the case where **user A connects Dexcom and gets live readings**, but **user B can connect successfully yet sees no readings and no visible error**.

This document is based purely on the current code in:

- `artifacts/mobile/app/cgm-setup.tsx`
- `artifacts/mobile/app/(tabs)/index.tsx`
- `artifacts/mobile/context/AuthContext.tsx`
- `artifacts/mobile/context/GlucoseContext.tsx`
- `artifacts/api-server/internal/routes/cgm.ts`

No code changes were made.

---

## 1. Current Dexcom Flow Summary

### 1a. How connection works

1. In `cgm-setup.tsx` the user enters Dexcom email + password and the `outsideUS` switch.
2. The mobile app POSTs to `/api/cgm/dexcom/connect` with `{ username, password, outsideUS }`.
3. The Express route (`cgm.ts`) does Dexcom's two-step auth against either
   `share1.dexcom.com` (US) or `shareous1.dexcom.com` (OUS) based on the `outsideUS` flag:
   - `POST /General/AuthenticatePublisherAccount` → `accountId`
   - `POST /General/LoginPublisherAccountById` → `sessionId`
4. Backend responds with `{ sessionId, outsideUS }`. Note: it does **not** return a `token` for Dexcom (only Libre returns a token).
5. The mobile app calls `setCGMConnection({ type: 'dexcom', sessionId: data.sessionId, token: data.token, outsideUS, connectedAt })`.

### 1b. How `sessionId` is stored

`AuthContext.commitCGMConnection`:

- Sets in-memory `cgmConnection` state.
- Persists to AsyncStorage under the **single device-wide key** `@gluco_guardian_cgm`.
- If a Convex-backed account is signed in, mirrors the connection to Convex via `api.patientCgm.replace` (per `userId` + `passwordHash`). This is the per-user cloud copy.

On sign-in (`signIn`):

- Local AsyncStorage CGM is cleared.
- `api.patientCgm.get` is called with the user's `convexUserId`.
- If a remote CGM record exists, it is restored into state and AsyncStorage. If not, `cgmConnection` stays `{ type: null }`.

On boot (`useEffect` load), the same restore happens for an already-saved session: AsyncStorage is hydrated first, then Convex is queried and overrides if present.

### 1c. How readings are fetched

In `app/(tabs)/index.tsx` → `performSync(silent)`:

- Endpoint: `POST /api/cgm/dexcom/readings`
- Body for Dexcom:
  ```ts
  { sessionId: cgmConnection.sessionId, outsideUS: cgmConnection.outsideUS, count: needsBackfill ? 288 : 5 }
  ```
- `needsBackfill` is `historyLenRef.current < 20 || coverageMs < 23.5h`.
- Backend (`cgm.ts` `/dexcom/readings`):
  - Hits `Publisher/ReadPublisherLatestGlucoseValues?sessionId=…&minutes=1440&maxCount=count` on US or OUS base depending on the body's `outsideUS`.
  - Parses the array, normalizes `Value`/`ST`/`Trend`, sorts ascending, returns `{ readings: [...] }`.

### 1d. How readings are saved to app state

Back in `performSync`:

```ts
const readings = data.readings ?? [];
const entries = readings.map(r => ({ glucose, timestamp, anomaly, dexcomTrend }));
bulkAddReadings(entries);
if (entries.length > 0) {
  setCgmLatestReading({ glucose, timestamp });
  // alert logic …
}
if (readings.length > 0) {
  setLastSyncTime(new Date());
  if (!silent) Alert.alert('Synced!', `${readings.length} readings imported …`);
}
```

`GlucoseContext.bulkAddReadings`:

- Filters out entries whose `timestamp` already exists in `history`.
- Sorts by timestamp, caps to 300, persists to AsyncStorage, and (if signed-in) flushes to Convex via `api.patientGlucose.upsertBatch`.

`performSync` runs once on mount (silent), then every 5 minutes via `setInterval`, plus on `AppState` change to `active`. There is also a manual pull-to-refresh and "Sync Now" path that runs `performSync(false)`.

---

## 2. Most Likely Reasons One User Gets Readings and Another Gets None

Categorized by where the cause sits.

### App-side (highest priority — these match "no error visible")

1. **Empty `readings` array is treated as success and surfaces nothing.**
   In `performSync`, when `data.readings = []`:
   - `bulkAddReadings([])` short-circuits (no entries).
   - `setCgmLatestReading` is not called.
   - `setLastSyncTime` is not called.
   - No alert, no toast, no banner. The UI just sits in "no readings yet" state.
   This perfectly matches the reported symptom.
2. **Auto-sync errors are silent by design.** The mount effect calls `performSync(true)`. In the `!res.ok` branch the code returns `false` without alerting when `silent` is `true`. So a `401 SessionNotValid` on auto-sync produces zero UI feedback. Only the user manually tapping "Sync Now" or pull-to-refresh would see the "Sync Failed / Reconnect" alert.
3. **Stale `sessionId` restored from Convex.** Dexcom Share session IDs expire (typically minutes to ~1 hour of idleness). On sign-in, `signIn` restores `sessionId` from `api.patientCgm.get` and the auto-sync immediately uses it. If user B signed in long after their last connect, the restored `sessionId` is stale → `/dexcom/readings` returns 401 → silent failure (see #2). User A may simply have a fresh session because they connected more recently on this device.
4. **`bulkAddReadings` deduplicates by `timestamp`.** If Convex already has user B's history (from a prior device/session), readings with identical timestamps are filtered out. The end-state visible reading still updates via `setCgmLatestReading`, *but only if `entries.length > 0` from the API response*, which it will be — so this alone won't fully explain it. However, combined with #1 (Dexcom returning `[]`) it can mask the diagnosis.
5. **Per-account Convex restore vs. local-only state.** Local AsyncStorage CGM is keyed by a single device-wide key (`@gluco_guardian_cgm`). On sign-in the local copy is wiped and replaced from Convex. If user B's `api.patientCgm.replace` mutation failed silently (the `catch {}` in `commitCGMConnection` swallows network errors), then the next sign-in would restore `{ type: null }` and the home screen would show "Connect CGM" — but the user said they *can* see the connected state, so this is less likely to be the active cause for B. Worth checking in the access log anyway.

### Dexcom-side

6. **Dexcom Share not enabled in user B's Dexcom mobile app.** The `cgm-setup.tsx` requirements box explicitly says "Open the Dexcom app → Menu → Share → Enable Sharing". Without Share enabled, `AuthenticatePublisherAccount` and `LoginPublisherAccountById` can still succeed (they only validate credentials), but `ReadPublisherLatestGlucoseValues` returns an empty array. This is a textbook cause of "connect works, readings empty".
7. **Region mismatch (`outsideUS` flag).** Dexcom OUS accounts authenticated against the US base (or vice versa) can sometimes return a valid session but no readings. There is no auto-redirect for Dexcom in the backend (Libre has a redirect handler at `loginData?.status === 2`, Dexcom does not). If user B is in Europe but `outsideUS=false` was selected, the readings call hits US Share, which has no data for them.
8. **No recent data in the last 1440 minutes (24h).** The query hard-codes `minutes=1440`. If user B's sensor has been off, in warmup, or not transmitting for 24h, the response is legitimately `[]`.
9. **Session legitimately expired.** Same as #3 but caused on the Dexcom side rather than by stale storage.

### Backend-side

10. **Backend is stateless per request.** `cgm.ts` does not store sessions, does not multiplex, does not key anything by user. It simply forwards whatever `sessionId` and `outsideUS` are in the body. So the backend cannot itself cause one-user-only behavior.
11. **Diagnostic info is logged server-side but never returned.** `console.log("Dexcom readings response:", response.status, rawText.slice(0, 300))` is helpful in API logs but invisible in the mobile app. The mobile client also does not log the count it received.

---

## 3. Could the Current Code Plausibly Behave Like a One-User-Only System?

**No.** Reading the code directly:

- `cgm.ts` does not retain any session state across requests. Every call to `/dexcom/connect` and `/dexcom/readings` is independent and uses whatever credentials/`sessionId` the client sends. There is no in-memory map of users, no global session, no singleton client.
- On the mobile side, CGM connection is stored per Convex user via `api.patientCgm.replace` keyed by `userId`. Each signed-in account has its own remote record. AsyncStorage is the device-wide cache, but it is wiped and re-fetched on `signIn` so different accounts on the same device do not collide.

The system supports an unbounded number of users by design. The bug is almost certainly **per-user Dexcom state (Share enabled, region, sensor activity, session freshness)** combined with **the app silently treating "0 readings" and "auto-sync 401" as non-events**.

---

## 4. Best Next Debug Step

**Surface what `/dexcom/readings` actually returned, even when it's "nothing wrong".**

The smallest safe change that would crack this open:

- In `performSync`, after `const readings = data.readings ?? []`, capture and expose:
  - `readings.length`
  - the HTTP status (already available as `res.status`)
  - whether the request was silent
  - the `sessionId` prefix (first 6 chars only) and `outsideUS` flag in use
- Render a small "last sync result" line under the existing `lastSyncTime` label in the home screen header, e.g. `"5m ago · 12 readings"` or `"5m ago · 0 readings"` or `"5m ago · session expired"`.
- Additionally, when `readings.length === 0` on a non-silent sync, show an alert that distinguishes the two cases:
  - "Dexcom returned 0 readings — check that Share is enabled in your Dexcom app and that your sensor is active."
  - vs. the existing "Session expired — Reconnect" path for 401s.

This single change makes user B's symptom self-diagnosing: they'll either see "0 readings" (Dexcom-side: Share/region/sensor) or "session expired" (auth lifecycle issue).

A complementary backend tweak (also tiny) is to include the upstream count and a debug header in the response, e.g. `res.json({ readings, debug: { count: readings.length, region: outsideUS ? 'OUS' : 'US' } })`. This avoids relying on `console.log` only.

---

## 5. Suggested Temporary Product / Debug Improvements

For diagnosing real-user CGM sync issues during testing, consider adding (temporarily, behind a debug flag if desired):

1. **CGM Debug panel on `cgm-setup.tsx` when already connected.** Show:
   - `cgmConnection.type`, `connectedAt`, `outsideUS`
   - Last 6 chars of `sessionId` (so it's identifiable but not leaked in screenshots)
   - Last sync timestamp and last reading count
   - Last HTTP status from `/dexcom/readings`
   - A "Force resync (verbose)" button that runs `performSync(false)` and shows a result modal with `{ status, count, firstTimestamp, lastTimestamp }`.
2. **Sync result toast on the home screen for every sync (silent or not), auto-dismissing after a few seconds.** Reuses the same data as the debug panel; doesn't require modal flows.
3. **In-app log buffer (ring buffer of last ~50 sync events).** Each entry: timestamp, status code, count, sessionId prefix, error message if any. Dump button to copy/share. This lets a tester send a real log instead of guessing.
4. **Surface backend `console.log` to clients during testing.** Add an opt-in `debug: true` field in the request body that causes the server to attach `{ upstreamStatus, upstreamBodySnippet }` to the JSON response. Make sure to gate this so it never leaks raw Dexcom payloads in production.
5. **Detect and warn on stale `sessionId` proactively.** When restoring `cgmConnection` from Convex on sign-in, if `connectedAt` is older than e.g. 30 minutes, show a non-blocking banner: "Your Dexcom session may have expired — tap to reconnect." This avoids the silent auto-sync 401 path entirely.
6. **Auto-reconnect attempt on session expiry.** If `/dexcom/readings` returns 401, and we still have the user's credentials available (we do not — we never store them), we could re-auth. Since we don't store credentials, the next-best is to elevate the silent failure into a visible "Reconnect Dexcom" banner so the user knows action is required.
7. **Region auto-detect / fallback.** If a US auth succeeds but readings come back empty for N consecutive syncs, prompt: "No readings — are you outside the US? Try toggling Outside US." This addresses cause #7 without changing the auth flow.

---

## Summary

The code is multi-user capable. The two ingredients producing the symptom are almost certainly: (a) a per-user Dexcom condition (Share not enabled, wrong region, stale session, sensor inactive) producing an empty readings array or 401, and (b) the mobile app's auto-sync silently swallowing both of those outcomes. Making the empty / failed response visible is the highest-leverage next step.
