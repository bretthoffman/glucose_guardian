# Continuous CGM Ingestion and Gap Recovery — Convex-Owned Architecture v1

Status: implemented in the working tree; **not deployed**. Mocked unit/integration tests pass.
Live scheduled ingestion has **not** been verified against real providers (see _Operational verification_).

Scope: a single Convex-owned subsystem that ingests Dexcom Share and LibreLink Up glucose
readings on a schedule — independent of whether the patient app is open — with durable
synchronization state, leasing, retry/backoff, cursor/overlap, initial backfill, interior-gap
reconciliation, and a client-callable expedited path that shares the exact same code.

---

## 1. Previous foreground-only failure mode

Before this change, CGM readings were pulled **only by the mobile app while it was in the
foreground**:

- `artifacts/mobile/app/(tabs)/index.tsx` called the api-server reading routes
  (`/api/cgm/dexcom/readings`, `/api/cgm/libre/readings`) directly on mount, on a 5-minute timer,
  and on every `AppState` "active" event.
- The app owned a **competing cursor heuristic**: it inspected its own local history length and
  oldest timestamp (`historyLenRef` / `historyOldestRef`) and decided `needsBackfill ? 288 : 5`
  readings. This guess could misfire (e.g. request only 5 after a long gap) and there was no
  server-side notion of "what have we already stored".
- Session refresh was also client-driven: on a 401 the app called `/refresh-session` and wrote the
  new session back with `setCGMConnection(...)`.

Consequences:

- **Gaps whenever the app was closed/backgrounded.** No app open ⇒ no ingestion. Caregivers and
  the doctor portal saw stale data.
- Two writers (app foreground + any other path) with **no shared cursor** ⇒ redundant fetches and
  reliance on dedupe to avoid duplication.
- No retry/backoff, no failure classification, no health state, no automated tests.
- A separate, earlier effort had begun adding **per-provider Convex crons** and **hand-edited
  generated API types**, duplicating Dexcom and Libre orchestration.

---

## 2. Final Convex-owned authority model

**Convex is the single authority** for unattended ingestion, cursor, session refresh, and health.

```
            ┌──────────────────────── Convex deployment ────────────────────────┐
            │                                                                     │
 cron 1m ──►│ cgmIngest.runDueIngest (internalAction, bounded)                   │
            │      │  seed pre-existing → list due (by_due) → claim lease         │
            │      ▼                                                              │
 mobile ───►│ cgmIngest.requestExpeditedSync (public action, force+throttle)     │
 foreground │      │                                                             │
            │      ▼   processConnection (shared)                                │
            │   claim → load creds/session → runProviderSync (cgm/core) ──┐      │
            │                                   │ login/read via adapter   │      │
            │                                   ▼ (cgm/providers)          │      │
            │                          Dexcom Share / LibreLink Up (HTTP)  │      │
            │      persist readings (dedupe) → advance cursor → complete   │      │
            │      ▼                                                       ▼      │
            │   patientGlucoseReadings (canonical)        cgmSyncState (queue)    │
            └─────────────────────────────────────────────────────────────────┘
                         ▲                              ▲
        caregiver query  │                              │  doctor portal (push payload, downstream)
   patientGlucose.listRecentForCaregiver        doctor.upsertFromSync → doctorPortalState
```

- The cron and the mobile foreground trigger run the **same** `processConnection` path, so there is
  exactly **one cursor authority**. The mobile app no longer talks to providers for ingestion and no
  longer maintains a cursor or refreshes sessions.
- Provider protocol is the **only** thing that differs between Dexcom and Libre; everything else
  (scheduling, leasing, retry/backoff, cursor, persistence, batching) is shared.

---

## 3. Dexcom and Libre boundaries

Shared (provider-agnostic):

- `convex/cgm/core.ts` — pure policy: `computeFetchPlan`, `decideSchedule`, `runProviderSync`,
  `anomalyFor`, failure taxonomy. No Convex/network imports; time is injected.
- `convex/cgmIngest.ts` — Convex binding: work queue, leases, persistence, dispatcher, expedited
  action.
- `convex/cgm/config.ts` — provider limits + tunable knobs.

Provider-specific (isolated in `convex/cgm/providers.ts`):

| Concern | Dexcom Share | LibreLink Up |
|---|---|---|
| Auth | `AuthenticatePublisherAccount` → `LoginPublisherAccountById` (accountId→sessionId) | `POST /llu/auth/login` (+ region redirect), Bearer token |
| Read | `ReadPublisherLatestGlucoseValues?minutes&maxCount` | `GET /llu/connections` → `GET /llu/connections/{patientId}/graph` |
| Window control | Accepts `minutes` + `maxCount` (`supportsWindow: true`) | Fixed recent graph window; `count`/`window` ignored (`supportsWindow: false`) |
| Timestamp | `ST`/`WT` `/Date(ms)/` → ISO | `Timestamp` (epoch seconds) × 1000 → ISO |
| Value/trend | `Value`, `Trend` → `dexcomTrend` | `ValueInMgPerDl ?? Value`, `TrendArrow` → `dexcomTrend` |
| Invalid-cred signal | `Code` ∈ {AccountPasswordInvalid, AccountNotFound}; `AccountLockout` ⇒ rate_limited (transient) | 401, or authenticated-but-no-share-token ⇒ invalid_credentials (sharing off) |
| Session expiry | 401 / `SessionNotValid` | 401 from connections/graph |

Normalization deliberately mirrors the api-server reading routes so the dedupe key (the ISO
`timestamp`) is identical across writers. `normalizeLibreReading` returns `null` for rows missing a
finite timestamp/value (more robust than the api-server, which would throw) but produces identical
output for valid rows.

---

## 4. End-to-end data flow

1. **Connect** (mobile `cgm-setup.tsx`): provider login via api-server `/connect`, then session
   stored on the `patientCgmConnections` row via `patientCgm.replace`, **and** raw credentials
   backed up to the server (`/credentials`) with retry. `replace` seeds/​resets `cgmSyncState`.
2. **Schedule**: the 1-minute cron `cgm-ingest-due` calls `cgmIngest.runDueIngest`.
3. **Seed**: pre-existing connections without a `cgmSyncState` row are lazily seeded (bounded).
4. **Select**: `listDueState` returns rows with `nextEligibleAt <= now`, oldest-due first, bounded.
5. **Claim**: `claimConnection` (serializable mutation) sets an expiring lease.
6. **Load**: `getCredsAndSession` (internal) loads password-bearing creds + current session.
7. **Plan + sync**: `runProviderSync` plans the fetch from the cursor, reuses the session (re-logs in
   + persists a fresh session on expiry), reads via the adapter, then persists.
8. **Persist**: `insertReadings` writes to `patientGlucoseReadings`, skipping existing timestamps.
9. **Advance**: the cursor advances to the newest **persisted** reading — only after persistence.
10. **Complete**: `completeSync` writes health/cursor/next-due and releases the lease, guarded by
    lease owner + generation.
11. **Read paths**: caregivers query `patientGlucoseReadings` directly; the mobile chart renders the
    canonical history returned by `requestExpeditedSync`; the doctor portal is fed downstream.

---

## 5. Schema and synchronization-state model

New table `cgmSyncState` (`convex/schema.ts`), one row per `(userId, provider)`:

| Field | Type | Purpose |
|---|---|---|
| `userId` | `id("users")` | patient |
| `provider` | `"dexcom" \| "libre"` | provider identity |
| `lastReadingTimestamp` | optional string (ISO) | cursor — newest **persisted** reading |
| `lastSuccessAt` / `lastAttemptAt` | optional number | health timestamps |
| `lastBackfillAt` | optional number | drives interior-gap reconcile cadence |
| `consecutiveFailures` | number | backoff input |
| `status` | `ok \| pending \| retrying \| needs_reconnect \| no_credentials` | health |
| `lastFailureCategory` / `lastFailureAt` | optional | **sanitized** category only (never raw text) |
| `nextEligibleAt` | number | due time; dispatcher processes rows where this ≤ now |
| `unrecoverableGap` | optional boolean | inactivity exceeded retention |
| `leaseOwner` / `leaseExpiresAt` | optional | mutual exclusion across runs |
| `generation` | number | monotonic; stale-worker guard |
| `updatedAt` | number | bookkeeping |

Indexes: `by_user_provider` (`[userId, provider]`), `by_due` (`[nextEligibleAt]`).

**Backward compatibility:** every operational field beyond identity/`status`/counters is optional, so
rows can be seeded minimally and migrated forward without a data migration. The canonical
`patientGlucoseReadings` shape is unchanged.

---

## 6. Cron and bounded-batch behavior

- `convex/crons.ts` registers a **single** cron: `crons.interval("cgm-ingest-due", { minutes: 1 },
  internal.cgmIngest.runDueIngest, {})`. No per-provider crons; no public/unbounded ingestion entry.
- Per run, `runDueIngest`:
  - seeds at most `seedLimit` (default 50) missing rows,
  - selects at most `batchLimit` (default 25) due rows,
  - processes them in waves of `concurrency` (default 5) via `Promise.allSettled` so one failing or
    slow connection never aborts the batch.
- Normal per-connection cadence is ~5 min (set by `decideSchedule`); the 1-min tick just picks up
  whatever is due, fairly (oldest-due first).

---

## 7. Lease and stale-worker protection

- `claimConnection` is a Convex mutation (serializable): it denies the claim if an **unexpired**
  lease exists, sets `leaseOwner` + `leaseExpiresAt = now + leaseMs` (default 2 min), and returns the
  cursor snapshot + `generation`. Two concurrent claims cannot both succeed.
- Lease duration (2 min) is **shorter than** the cron interval pattern so a crashed worker's
  connection becomes eligible again on a later pass.
- `completeSync` applies the result **only if** `leaseOwner` matches **and** `generation` equals the
  value observed at claim time; otherwise it returns `{ applied:false, superseded:true }`. Every
  committed write bumps `generation`. This makes the expired-lease-reclaim race safe: a slow worker
  whose lease was reclaimed and completed by another worker is rejected on both the owner and
  generation checks.
- Tested: active-lease denial, abandoned-lease reclaim + stale completion rejection.

---

## 8. Cursor and overlap algorithm

- The cursor is `lastReadingTimestamp` (ISO-8601 UTC; string comparison is chronological).
- `runProviderSync` advances the cursor to `max(prevCursor, maxTimestampOfPersisted)` **after**
  persistence, and only reports `advancedCursor` when it actually moved forward. The cursor never
  regresses and never advances on login/read/persistence failure.
- `insertReadings` computes `maxTimestamp` over **all** returned entries (not just newly inserted),
  because dedupe-skipped rows are already persisted — so the cursor can advance past a fully-overlapping
  batch without re-fetching forever.
- Incremental fetches request `ceil(gapMinutes / cadence) + 2` samples and a window of
  `ceil(gapMinutes) + cadence*2` minutes (clamped). The constant **2-sample overlap** ensures
  boundary readings are never skipped; duplicates are removed by the timestamp dedupe.

---

## 9. Initial backfill

First sync (no cursor) requests a bounded initial backfill over the full retained window:
`initialBackfillCount` = 288 (Dexcom) / 300 (Libre), window = provider `maxWindowMinutes`. This is
clamped to provider `maxCount` and is **not** unbounded.

---

## 10. Recent interior-gap reconciliation

Even when newer readings exist, a connection periodically refetches the **full** retained window to
fill interior holes (e.g. provider backfilled a sensor warm-up gap, or a transient drop left a hole
inside otherwise-fresh data):

- Triggered when `lastBackfillAt` is null or older than `reconcileIntervalMs` (default 6h).
- Plan reason `reconcile`; the dedupe makes it idempotent — only genuinely missing interior readings
  are inserted; the cursor is unaffected if nothing newer appears.
- `completeSync` records `lastBackfillAt` on `initial`, `catchup`, and `reconcile` runs.
- Tested: a 7h-old `lastBackfillAt` produces a full-window request (`maxCount=288`, `minutes=1440`).

---

## 11. Provider retention limitations

Providers retain only a limited recent window (Dexcom Share ~24h, LibreLink Up graph ~12h, encoded as
`maxWindowMinutes`). If inactivity exceeds retention, the interior period is **permanently lost** at
the source:

- `computeFetchPlan` detects `gapMinutes > maxWindowMinutes`, switches to reason `catchup`, fetches
  the full retained window, and flags `expectUnrecoverableGap`.
- `completeSync` persists `unrecoverableGap = true` so the gap is recorded as known-unrecoverable
  rather than retried forever.
- Tested: 30h gap ⇒ `unrecoverableGap = true`; 3h gap ⇒ recovered, not flagged.

---

## 12. Retry and backoff

`decideSchedule` (pure) maps the sanitized failure category to the next state
(`convex/cgm/config.ts` → `RETRY_CONFIG`):

| Category | Status | Next eligibility |
|---|---|---|
| `none` (success) | `ok` | now + cadence (5 min) |
| `provider_outage`, `network_timeout`, `malformed_response`, `persistence_failure`, `internal_error`, `missing_config` | `retrying` | exponential `base(5m) * 2^(n-1)`, capped at `maxBackoffMs` (60 min) |
| `rate_limited` | `retrying` | `rateLimitBackoffMs` floor (15 min) |
| `no_credentials` | `no_credentials` | `terminalRecheckMs` (6h) |
| `invalid_credentials` | `needs_reconnect` | `terminalRecheckMs` (6h) |

`processConnection` adds randomized jitter (≤30s success / ≤60s failure) to `nextEligibleAt` to avoid
provider stampedes. Terminal credential failures back off to ~6h (not 5 min) so we never hammer a
provider with logins that cannot succeed until the user reconnects. Tested for all categories.

---

## 13. Credential backup guarantees

Unattended ingestion requires server-stored credentials (the only way to re-login when a session
expires while the app is closed).

- On connect, `cgm-setup.tsx` calls `backupCredentialsWithRetry` (retries at 0/1000/2500 ms). A
  transient backup failure is **not** treated as success; it logs a generic warning (no secret) and
  leaves the connection live.
- `patientCgm.hasCredentials` (client-callable, **booleans only**, never the password) lets the home
  screen detect a connected-but-not-backed-up patient (connect-time failure, app killed mid-connect,
  or a pre-existing connection) and show a **non-blocking reconnect banner**. The password is not
  recoverable client-side, so reconnect is the remedy.
- During ingestion, a missing creds row yields `no_credentials` (long recheck) rather than a silent
  success, surfaced via `status`.
- Raw credentials are read **only** by `internal*` Convex functions (`getCredsAndSession`) and the
  api-server `*Secrets.getCredentialsForServer` (gated by `serverSecret`). No client function returns
  a password. No secrets are logged anywhere.

---

## 14. Mobile foreground behavior

`artifacts/mobile/app/(tabs)/index.tsx`:

- Removed: oldest-history coverage math, `needsBackfill ? 288 : 5`, direct `/dexcom|libre/readings`
  calls, client-side `/refresh-session` + `setCGMConnection` writes, `FULL_WINDOW_MS`.
- `performSync` now calls `cgmIngest.requestExpeditedSync` (Convex action) and renders the canonical
  history it returns. Both providers use this one path.
- Triggers (mount, 5-min timer, `AppState` "active") funnel through `triggerSilentSync`, debounced
  client-side to once per `SILENT_SYNC_MIN_GAP_MS` (20s); the server additionally throttles real
  provider hits via `minSinceAttemptMs` (default 60s, authoritative). A burst of foreground events
  cannot create uncontrolled provider requests.
- Status mapping: `unauthorized | needs_reconnect | no_credentials` ⇒ reconnect prompt; `retrying`
  ⇒ "we'll keep retrying"; `ok` ⇒ normal. Because the app no longer writes sessions, it cannot
  clobber a newer server-refreshed session.

---

## 15. API-server compatibility decisions

`artifacts/api-server/internal/routes/cgm.ts`:

- **Retained, unchanged:** credential-capture and lifecycle routes
  (`/dexcom|libre/connect`, `/credentials`, `/clear-credentials`) — still used by `cgm-setup.tsx`
  and connection teardown.
- **Retained as deprecated compatibility surfaces:** `/dexcom|libre/readings` and
  `/dexcom|libre/refresh-session`. The current app no longer calls them, but older installed app
  builds might. They now emit a `Deprecation: true` header; no behavior was removed. They were **not**
  deleted because they cannot be proven unused by already-shipped clients.
- `artifacts/api-server/tsconfig.json` `rootDir` widened to `../..` so the type-check can follow the
  Convex generated `api` types (which now reach `convex/cgm/*`). Building is done by esbuild, not tsc,
  so this only affects the type-check's source-layout check; the build output is unchanged.

---

## 16. Existing-user handling

- Connections that predate `cgmSyncState` are **lazily seeded** by `seedMissingState` on the next
  cron tick (bounded per run) and ingested normally, even if the user never re-opens the app.
- `patientCgm.replace` reconciles state on connect/reconnect: same-provider reconnect **preserves**
  the cursor (no pointless 24h re-backfill) and clears failure/lease while bumping generation; a
  provider switch **drops** the other provider's state row and starts fresh (bounded initial
  backfill); a brand-new connection inserts a fresh row.
- `patientCgm.clear` (disconnect) deletes the user's `cgmSyncState` rows so the cron stops.
- Existing users without server-stored credentials get an actionable `no_credentials` status plus the
  mobile reconnect banner.
- Tested: seed-then-ingest of a pre-existing connection with no state row.

---

## 17. Doctor / caregiver data flow

- **Caregiver:** `patientGlucose.listRecentForCaregiver` reads canonical `patientGlucoseReadings`
  via `by_user_time`. Because Convex now ingests unattended, caregivers see fresh data with no app
  open. Tested end-to-end (cron run → caregiver query returns the ingested rows).
- **Doctor:** unchanged push-payload model — `doctor.upsertFromSync` writes a snapshot into
  `doctorPortalState` (gated by `CONVEX_DOCTOR_INGEST_SECRET`); the portal reads that table. This is
  downstream of the canonical readings and was not modified by this work.
- `patientGlucose.upsertBatch` (legacy writer) uses the identical `(userId, timestamp)` dedupe as the
  cron's `insertReadings`, so the two writers never duplicate rows.

---

## 18. Security and privacy boundaries

- Passwords/tokens are read only by `internal*` Convex functions and the `serverSecret`-gated
  api-server secret mutations. No client-callable function returns a raw credential; `hasCredentials`
  returns booleans.
- Provider/network errors are mapped to a **sanitized** `FailureCategory` enum before storage or
  logging; raw provider text never reaches `cgmSyncState` or logs.
- Logging audited: `cgmIngest` logs only aggregate counts and a sanitized worker-error string; the
  api-server credential routes log only `err.message`/"unknown"; the mobile backup failure logs a
  generic message. No secrets are logged.
- `requestExpeditedSync` authenticates by `userId` + `passwordHash` and returns only `status`,
  `inserted`, and canonical readings.

---

## 19. Configuration values and locations

Provider limits and retry policy — `convex/cgm/config.ts`:

- Dexcom: cadence 5m, maxCount 288, window 1440m, supportsWindow true, initialBackfill 288,
  reconcile 6h.
- Libre: cadence 5m, maxCount 300, window 720m, supportsWindow false, initialBackfill 300,
  reconcile 6h.
- Retry: base 5m, max 60m, rate-limit 15m, terminal recheck 6h.

Operational knobs (Convex environment variables; defaults in `ingestConfig`):

| Env var | Default | Meaning |
|---|---|---|
| `CGM_INGEST_BATCH_LIMIT` | 25 | due connections per run |
| `CGM_INGEST_SEED_LIMIT` | 50 | pre-existing rows seeded per run |
| `CGM_INGEST_LEASE_MS` | 120000 | lease duration |
| `CGM_INGEST_CONCURRENCY` | 5 | in-run concurrency |
| `CGM_EXPEDITED_MIN_INTERVAL_MS` | 60000 | server-side expedited throttle |

Cron cadence: `convex/crons.ts` (1 minute).

---

## 20. Dependency / test tooling changes

- Root `package.json` devDependencies added: `vitest@^2.1.9`, `convex-test@^0.0.38`,
  `@edge-runtime/vm@^4.0.4`; scripts `test` (`vitest run`) and `test:watch`.
- `vitest.config.ts`: `environment: "edge-runtime"`, inlines `convex-test`, includes
  `convex/**/*.test.ts`.
- `convex/tsconfig.json`: also excludes `**/*.test.ts` from the production type-check.
- **esbuild override** (`pnpm-workspace.yaml`): `0.27.3 → 0.27.0`. The `@esbuild/*` platform packages
  are intentionally disabled in this workspace, so esbuild uses its bundled binary; the JS host must
  match that binary. vitest/vite require esbuild, and 0.27.3-host-vs-0.27.0-binary throws a version
  mismatch. There is a single `esbuild:` override key (no duplicate). The api-server esbuild build was
  verified to succeed under 0.27.0.
- **Lockfile churn note:** `pnpm install` also pruned several orphaned entries unrelated to this work
  (`wouter`, `react-icons`, `@tailwindcss/typography`, `@replit/vite-plugin-dev-banner`, `mitt`,
  `regexparam`, `cssesc`, `postcss-selector-parser`) — leftovers from the earlier doctor-portal
  removal — and switched esbuild to 0.27.0. The **mockup-sandbox importer block in the lockfile is
  byte-for-byte identical** before and after, so no app's resolved dependency graph relevant to the
  CGM work changed except the intended esbuild pin + the added test stack.

---

## 21. Generated Convex type status

- `convex/_generated/api.d.ts` was **manually reconciled** to add the new modules
  (`cgm/config`, `cgm/core`, `cgm/providers`, `cgmIngest`, `crons`). The module list matches the
  actual function files **exactly**, and the file is complete and syntactically valid (the Convex
  type-check passes against it).
- No other generated file needs editing: `api.js` is the module-agnostic `anyApi` stub, and
  `dataModel.d.ts` derives the new `cgmSyncState` table automatically from `schema.ts`
  (`DataModelFromSchemaDefinition<typeof schema>`).
- **Honesty:** this was **not** produced by an official `convex codegen` run (which needs deployment
  access that was unavailable). Because codegen output for added modules is deterministic, an operator
  run should reproduce this `api.d.ts` (or an equivalent). Operators **must** run codegen before/at
  deploy — see below.

---

## 22. Deployment procedure (operator actions — deliberate)

> Nothing below has been executed. No deploy, no production cron registration.

1. Set Convex environment variables if overriding defaults (Section 19), plus the existing
   `CONVEX_PATIENT_BACKEND_SECRET` / `CONVEX_DOCTOR_INGEST_SECRET`.
2. Regenerate types officially and type-check:
   ```sh
   npx convex codegen          # or: npx convex dev (writes convex/_generated/*)
   npx tsc -p convex/tsconfig.json --noEmit
   git diff --stat convex/_generated   # expect no change vs the reconciled api.d.ts
   ```
3. Deploy Convex (registers the schema + the `cgm-ingest-due` cron):
   ```sh
   npx convex deploy
   ```
4. Deploy/rebuild the api-server (compatibility routes unchanged) and ship the mobile build.

---

## 23. Operational verification (after deploy)

- Confirm the `cgm-ingest-due` cron appears in the Convex dashboard and that `runDueIngest` logs
  `processed/inserted/failures/seeded` each minute.
- For a **test patient** (explicit consent), confirm `cgmSyncState` advances `lastReadingTimestamp`,
  `status: "ok"`, and that `patientGlucoseReadings` grows **with the app closed**.
- Verify a forced session expiry results in a silent re-login (connection `sessionId`/`token`
  changes) and ingestion continues.
- Verify a wrong-credentials patient lands in `needs_reconnect` with ~6h backoff (not every cycle).
- Verify the mobile expedited path returns canonical history and the reconnect/backup banners behave.

---

## 24. Rollback procedure

- **Disable ingestion without code rollback:** remove/comment the `crons.interval(...)` in
  `convex/crons.ts` and redeploy, or set the connections' `nextEligibleAt` far in the future.
  `requestExpeditedSync` can be left available or disabled by reverting the mobile call.
- **Full rollback:** revert the working-tree changes (none are committed yet) or
  `git revert` the eventual commit. The `cgmSyncState` table can remain (unused) or be dropped; the
  canonical `patientGlucoseReadings` is untouched by rollback. Re-deploy the previous mobile/api-server
  builds; the deprecated reading/refresh routes still exist for the old app path.

---

## 25. Known limitations

- **Seeding scans the connections table each tick.** `seedMissingState` reads up to 500 connections
  + a point lookup per row every minute, even once everything is seeded. Fine at current scale;
  see _Deferred work_.
- **Libre window is fixed** (no `minutes`/`count` control); interior reconciliation is limited to
  what `/graph` returns (~12h). Gaps older than that are unrecoverable (flagged).
- **No push/webhook ingestion** — polling only; freshness is bounded by the ~5-min cadence (plus the
  1-min due tick) and provider availability.
- **Generated types are a manual reconciliation** until an operator runs codegen (Section 21).
- **mockup-sandbox type-check fails (pre-existing, unrelated).** Duplicate `@types/react` (19.1.17
  from the Expo/RN mobile stack vs 19.2.14 from the web catalog) breaks shadcn `calendar.tsx`/
  `spinner.tsx`. Proven independent of this work: the mockup-sandbox lockfile importer block is
  byte-identical before/after, its `package.json` is unchanged, and no CGM file touches it. Not fixed
  here to avoid unrelated dependency churn.

---

## 26. Deferred work

- Make seeding event-driven or index-driven (e.g. a `seeded` flag / dedicated index) to avoid the
  per-tick full scan at scale.
- Optional surfacing of `cgmSyncState.status`/`unrecoverableGap` to caregivers/doctor for richer
  connection-health UX.
- Consider provider push/webhooks if/when available to cut latency and polling cost.
- Resolve the pre-existing mockup-sandbox `@types/react` duplication separately (e.g. a single
  pinned `@types/react` for the web app or a `packageExtensions`/override scoped to that package).
- Operator-run `convex codegen` to replace the manually-reconciled `api.d.ts` with an official one.
