# Dexcom silent re-login — implementation change log

**Date:** 2026-05-13  
**Scope:** JS / TypeScript only (Expo mobile, Express API server, Convex). No native dependencies, no Expo plugin or `app.json` native config changes.

---

## What changed

1. **Convex** — New table `patientDexcomCredentials` stores Dexcom Share username, password, and `outsideUS` per `users` row, indexed by `userId`. A new module `patientDexcomSecrets` exposes **server-secret–gated** mutations/queries (same pattern as `doctor.ts`): upsert credentials, fetch credentials for the API server only, and clear credentials. **`passwordHash` is verified against `users` before any write or read.** Nothing in this module returns the password to the mobile app (the mobile app never calls these functions).

2. **API server** — `dexcomShareLogin` extracted to `internal/dexcom-share-login.ts` and reused by `POST /dexcom/connect` and `POST /dexcom/refresh-session`. New Convex helper `internal/convex-patient-backend.ts` (mirrors doctor helper, separate env vars). New routes: `POST /api/cgm/dexcom/credentials`, `POST /api/cgm/dexcom/refresh-session`, `POST /api/cgm/dexcom/clear-credentials`. Dexcom readings logging no longer dumps response bodies or session identifiers.

3. **Mobile** — After a successful manual Dexcom connect, Convex-backed users POST credentials to the new store route (failure is non-fatal). Home tab sync: on Dexcom session-expired style failure, one silent `refresh-session` + `setCGMConnection` + single readings retry before showing reconnect UX. Dexcom disconnect triggers `clear-credentials` (non-fatal if it fails).

---

## Files changed

| Path | Change |
|------|--------|
| `convex/schema.ts` | Added `patientDexcomCredentials` table + `by_userId` index |
| `convex/patientDexcomSecrets.ts` | **New** — upsert / get for server / clear |
| `convex/_generated/api.d.ts` | Registered `patientDexcomSecrets` module |
| `artifacts/api-server/internal/convex-patient-backend.ts` | **New** — Convex HTTP client + env for patient backend |
| `artifacts/api-server/internal/dexcom-share-login.ts` | **New** — shared Dexcom Share login |
| `artifacts/api-server/internal/routes/cgm.ts` | Refactor connect; new routes; safer Dexcom readings logs |
| `artifacts/mobile/app/cgm-setup.tsx` | Store credentials after connect; clear on Dexcom disconnect |
| `artifacts/mobile/app/(tabs)/index.tsx` | Silent refresh + one retry in `performSync` |

---

## New Convex table / functions

**Table:** `patientDexcomCredentials`

- `userId` — `Id<"users">`
- `dexcomUsername` — `string`
- `dexcomPassword` — `string` (server-only storage; not exposed to client queries)
- `outsideUS` — `boolean`
- `updatedAt` — `number` (ms)
- Index: `by_userId` on `["userId"]`

**Module:** `convex/patientDexcomSecrets.ts`

| Function | Type | Purpose |
|----------|------|---------|
| `upsertCredentials` | mutation | `serverSecret` + `userId` + `passwordHash` + Dexcom fields; verifies user then upserts |
| `getCredentialsForServer` | mutation | `serverSecret` + `userId` + `passwordHash`; returns username/password/outsideUS **only to callers with valid server secret and passwordHash** |
| `clearCredentials` | mutation | `serverSecret` + `userId` + `passwordHash`; verifies user then deletes row |

---

## New API routes

All mounted under `/api/cgm` (existing CGM router).

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/dexcom/credentials` | `userId`, `passwordHash`, `username`, `password`, `outsideUS` | `{ ok: true }` — never includes password |
| `POST` | `/dexcom/refresh-session` | `userId`, `passwordHash` | `{ sessionId, outsideUS }` |
| `POST` | `/dexcom/clear-credentials` | `userId`, `passwordHash` | `{ ok: true }` |

If Convex patient backend env is missing, **credentials** and **refresh-session** return **503**; **clear-credentials** returns `{ ok: true }` so disconnect UX is not blocked.

---

## New environment variables

Set these **in both places** with the **same secret string**:

1. **Convex dashboard** (environment variables for the deployment)  
   - `CONVEX_PATIENT_BACKEND_SECRET` — must match the API server value so `patientDexcomSecrets` `requirePatientBackendSecret` passes.

2. **API server host** (e.g. Replit, Fly, Railway, etc.)  
   - `CONVEX_URL` — already used for doctor flows; same deployment URL.  
   - `CONVEX_PATIENT_BACKEND_SECRET` — shared with Convex (distinct from `CONVEX_DOCTOR_INGEST_SECRET`).

**Do not** put `CONVEX_PATIENT_BACKEND_SECRET` in the Expo app; the mobile client only sends `userId` + `passwordHash` (already used for Convex patient APIs).

---

## Flows

### First successful manual Dexcom sign-in

1. User submits username/password in **Connect CGM**; app calls existing `POST /api/cgm/dexcom/connect`.
2. On success, app calls `setCGMConnection` (unchanged metadata path to Convex `patientCgm` via `AuthContext`).
3. If `account.convexUserId` and `account.passwordHash` exist, app calls `POST /api/cgm/dexcom/credentials` with Dexcom fields + `userId` + `passwordHash`.
4. API verifies via Convex `upsertCredentials` and stores the row. If step 3 fails, the CGM connection still works; a generic warning is logged on the client.

### Later silent refresh on session expiry

1. Home tab `performSync` POSTs readings as today.
2. On failure with session-expired semantics **and** Dexcom **and** Convex account present, app calls `POST /api/cgm/dexcom/refresh-session` once.
3. API loads stored credentials (server-side only), runs `dexcomShareLogin`, returns `sessionId` / `outsideUS`.
4. App calls `setCGMConnection` with the new session, retries readings **once**.
5. If retry succeeds, sync continues as normal (chip shows success). If not, behavior matches the previous manual reconnect fallback (alerts when not silent).

### Disconnect cleanup

1. User confirms disconnect on **Dexcom** while signed in with `convexUserId` + `passwordHash`.
2. App calls `POST /api/cgm/dexcom/clear-credentials`, then `setCGMConnection({ type: null })` as before.
3. If the clear call fails, local disconnect still runs.

---

## What stayed unchanged

- Manual Dexcom connect URL and successful JSON shape `{ sessionId, outsideUS }`.
- Libre routes and behavior.
- Doctor Convex ingest helper and routes.
- Manual reconnect alerts and navigation to **Connect CGM** when sync fails after refresh.
- `patientCgmConnections` schema (no Dexcom password stored there).
- Expo plugins / `app.json` native configuration (not modified).

---

## Manual verification checklist

- [ ] Set `CONVEX_PATIENT_BACKEND_SECRET` on Convex + API; deploy Convex schema.
- [ ] Sign in as Convex user, connect Dexcom; confirm readings sync.
- [ ] Confirm Convex dashboard / table editor shows `patientDexcomCredentials` row (optional).
- [ ] Invalidate `sessionId` (e.g. stale value) and pull to sync: silent refresh restores readings without reconnect alert when credentials exist.
- [ ] Disconnect Dexcom: row cleared (or clear endpoint returns ok); local CGM cleared.
- [ ] Libre: no calls to Dexcom refresh; behavior unchanged.
- [ ] User without `convexUserId`: connect still works; no credential store call; session expiry still prompts reconnect as before.
- [ ] API logs: no Dexcom username/password; no full session id printed.

---

*End of change document.*
