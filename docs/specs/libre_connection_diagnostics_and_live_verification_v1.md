# Libre Connection Diagnostics and Live Verification v1

Status: **implemented in working tree; not deployed; not live-verified**

Scope: Stage 1 — sanitized Libre connection diagnostics, empty-account handling, client sync-state visibility, and operator verification tooling. Preserves the shared Dexcom/Libre ingestion architecture in `convex/cgm/core.ts` and `convex/cgmIngest.ts`.

---

## Architecture (unchanged foundation)

Libre uses the **LibreLink Up follower** unofficial API:

1. Mobile `cgm-setup.tsx` → API `/libre/connect` → Convex `patientCgm.replace` + credential backup
2. Convex cron (`runDueIngest`) and expedited sync (`requestExpeditedSync`) → `makeLibreAdapter` → `patientGlucoseReadings`
3. Credentials in `patientLibreCredentials` (server-secret gated); session in `patientCgmConnections`

**Expected account type:** LibreLink Up **follower** account with an accepted sharing invitation — not necessarily the primary sensor wearer account.

---

## Status taxonomy

### Provider diagnostic categories (client-safe)

| Category | Meaning | Reconnect required | Scheduler |
|----------|---------|-------------------|-----------|
| `connected` | Authenticated; readings available or generic success | No | Normal cadence |
| `connected_no_data` | Shared patient found; graph empty | No | Normal cadence |
| `no_shared_patient` | Authenticated; `/llu/connections` empty | No | Normal cadence (retry) |
| `sharing_not_enabled` | Login OK but no share token | Yes | Terminal recheck |
| `invalid_credentials` | Email/password rejected | Yes | Terminal recheck |
| `session_expired` | Bearer session invalid | Yes (re-login) | Transient / relogin |
| `no_credentials` | No server-stored credentials | Yes | Terminal recheck |
| `rate_limited` | HTTP 429 | No | Backoff |
| `provider_unavailable` | Outage / network | No | Backoff |
| `unknown_provider_error` | Unclassified | No | Backoff |

### Internal `FailureCategory` extensions

Added to `convex/cgm/core.ts`:

- `sharing_not_enabled`
- `no_shared_patient`
- `connected_no_data`

Mapped to diagnostics via `convex/cgm/diagnostics.ts`.

---

## Diagnostic stages (Libre)

`runLibreDiagnosticFlow` / `cgmDiagnostics.runLibreDiagnostic` report:

1. Credentials present
2. Login attempted / succeeded
3. Region resolved (`apiHostLabel` only, e.g. `api.eu.libreview.io`)
4. Session persisted (server-side only; never returned)
5. Connections enumerated (`connectionCount`)
6. First connection selected (`selectedConnectionFound`)
7. Graph requested (`graphRequestSucceeded`)
8. Readings counted (`readingCount`, `latestReadingTimestamp`)

**Never stored or returned:** email, password, bearer token, raw JSON, patient names, patient IDs.

---

## Empty-account behavior

### No shared patient

When `/llu/connections` succeeds with zero usable entries:

- Adapter `readKind: "no_shared_patient"`
- Sync category `no_shared_patient` (not `none`, not `invalid_credentials`)
- `cgmSyncState.status = "no_shared_patient"`
- Mobile banner: guidance to use LibreLinkUp follower account and accept invitation

### Connected but no data

When a shared patient exists but graph has no parseable readings:

- Adapter `readKind: "connected_no_data"`
- Sync category `connected_no_data`
- Session preserved; scheduler continues on normal cadence
- Mobile banner: connected, waiting for readings

### Sharing not enabled

When login succeeds but `authTicket.token` is absent:

- Category `sharing_not_enabled` (distinct from invalid password)
- Terminal until user enables LibreLinkUp sharing and reconnects

---

## Session expiration

- Read/connections 401 → `sessionExpired: true` → `runProviderSync` re-login
- Failed relogin → `invalid_credentials` / `needs_reconnect`
- Diagnostic action reports `session_expired` when appropriate

---

## Mobile UX

- `patientCgmSync.getSyncStatus` — sanitized query (auth: `userId` + `passwordHash`)
- Home tab banners for Libre: no shared patient, connected-no-data, sharing off, reconnect, provider unavailable
- Dexcom UI unchanged (generic zero-readings alert retained for Dexcom only)
- Message keys mapped in `artifacts/mobile/utils/cgmDiagnosticMessages.ts`

---

## Operator diagnostic action

`cgmDiagnostics.runLibreDiagnostic` — authenticated patient action, throttled 60s.

Returns `LibreDiagnosticSummary` only. Does not run automatically on a timer.

---

## Multi-patient limitation

Adapter selects **first** connection with a `patientId`. Diagnostic reports `connectionCount` and `multiConnectionDetected` when count > 1. No patient-selection UI in this stage.

---

## Trend handling (Stage 3 blocker)

Libre `TrendArrow` is still stored in `dexcomTrend` and rendered via `mapDexcomTrend`. Abbott trend scale mapping requires sanitized live fixtures — **not changed in this stage**.

---

## Credential encryption follow-up

Passwords remain **plaintext in Convex** (`patientLibreCredentials`, `patientDexcomCredentials`), access-controlled but not application-encrypted.

**Recommended follow-up:**

1. Application-layer encryption at rest (per-field)
2. Key ownership (Convex env / KMS) and rotation runbook
3. Migration of existing credential rows
4. Access auditing and log redaction review

---

## Deployment requirements

| Component | Required for live Libre diagnostics |
|-----------|-------------------------------------|
| Convex | Deploy schema + `cgmIngest`, `patientCgmSync`, `cgmDiagnostics` |
| API server | Existing Libre connect/credentials routes (no change required for Stage 1) |
| Mobile | Build with updated Home sync UI + `getSyncStatus` query |

**Current deployment status:** Code exists on `master` in repo; **live deployment not verified** during this change. Do not assume production Convex/API/mobile bundles include this work until operator deploys.

---

## Empty-account operator test (manual)

**Do not paste credentials into shell history.** Use the mobile connect UI or secure prompts.

1. Sign in to Gluco Guardian mobile app
2. Settings → Connect CGM → select **FreeStyle Libre**
3. Enter LibreLinkUp follower credentials in the app UI (not CLI)
4. Confirm connect succeeds or shows precise failure (sharing off / invalid creds)
5. Verify credential backup banner is **not** shown (or reconnect if shown)
6. Open Home — pull to sync or wait for expedited sync
7. Confirm banner shows either **No shared patient** or **Connected — no readings yet**
8. (Optional) Call diagnostic via Convex dashboard or future operator UI: `cgmDiagnostics.runLibreDiagnostic`
9. Confirm `cgmSyncState` row has `providerDiagnosticCategory` set (Convex dashboard — no password fields)
10. Confirm **no** rows inserted into `patientGlucoseReadings` for empty account
11. Wait 5+ minutes — confirm cron retries without `needs_reconnect`
12. **Dexcom regression:** connect Dexcom test account; confirm readings still ingest

---

## Active-reading account test (still required)

Requires consenting LibreLinkUp account with active sensor data:

- Real graph parsing and trend display
- Cursor advancement and deduplication
- Expedited + scheduled sync
- Dexcom non-regression

**Do not claim production-verified Libre ingestion until this completes.**

---

## Dexcom regression checks

Automated: existing Dexcom tests in `cgm/providers.test.ts`, `cgmIngest.test.ts`, `cgm/core.test.ts` must pass unchanged.

Manual: connect Dexcom after Libre empty-account test; confirm sync, banners, and readings.

---

## Abbott API uncertainty

Endpoints, headers (`product: llu.android`, `version: 4.7.0`), and response shapes are **undocumented**. Sharing/consent edge cases may require live samples.

---

## Rollback plan

1. Revert Convex deploy to prior deployment
2. Mobile: prior build without `patientCgmSync` query (falls back to expedited sync only)
3. Schema additions are optional fields — old workers remain compatible
4. Libre ingestion reverts to treating empty connections as generic zero-readings success

---

## Files added/changed (Stage 1)

| Path | Role |
|------|------|
| `convex/cgm/diagnostics.ts` | Sanitized taxonomy + message keys |
| `convex/cgm/core.ts` | New categories, `readKind`, schedule rules |
| `convex/cgm/providers.ts` | Libre empty-state distinction + `runLibreDiagnosticFlow` |
| `convex/cgmIngest.ts` | Persist diagnostics on sync complete |
| `convex/patientCgmSync.ts` | Client `getSyncStatus` query |
| `convex/cgmDiagnostics.ts` | `runLibreDiagnostic` action |
| `convex/schema.ts` | Optional diagnostic fields on `cgmSyncState` |
| `artifacts/mobile/app/(tabs)/index.tsx` | Libre status banners + sync handling |
| `artifacts/mobile/utils/cgmDiagnosticMessages.ts` | User-facing copy |
| `convex/*.test.ts` | Mocked coverage |
