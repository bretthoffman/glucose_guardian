# Libre silent re-login — implementation change log

**Date:** 2026-05-16  
**Scope:** JS / TypeScript only (Expo mobile, Express API server, Convex). No native dependencies, no Expo plugin or `app.json` native config changes.

---

## What changed

1. **Convex** — New table `patientLibreCredentials` stores LibreLink Up email, password, and optional `libreApiBase` per `users` row, indexed by `userId`. A new module `patientLibreSecrets` exposes **server-secret–gated** mutations (same pattern as `patientDexcomSecrets`): upsert credentials, fetch credentials for the API server only, and clear credentials. **`passwordHash` is verified against `users` before any write or read.** Nothing in this module returns the password to the mobile app.

2. **API server** — `libreLinkLogin` extracted to `internal/libre-link-login.ts` and reused by `POST /libre/connect` and `POST /libre/refresh-session`. New routes: `POST /api/cgm/libre/credentials`, `POST /api/cgm/libre/refresh-session`, `POST /api/cgm/libre/clear-credentials`. Libre readings accept optional `apiBase` (regional API host) and no longer log login response bodies.

3. **Mobile** — After a successful manual Libre connect, Convex-backed users POST credentials to the new store route (failure is non-fatal). Home tab sync: on Libre session-expired style failure, one silent `refresh-session` + `setCGMConnection` + single readings retry before showing reconnect UX. Libre disconnect triggers `clear-credentials` (non-fatal if it fails).

4. **CGM metadata** — Optional `libreApiBase` on `patientCgmConnections` / mobile `CGMConnection` so regional Libre hosts persist across sync and silent refresh (parallel to Dexcom `outsideUS`).

---

## Files changed

| Path | Change |
|------|--------|
| `convex/schema.ts` | Added `patientLibreCredentials` table; optional `libreApiBase` on `patientCgmConnections` |
| `convex/patientLibreSecrets.ts` | **New** — upsert / get for server / clear |
| `convex/patientCgm.ts` | `libreApiBase` in connection payload + `get` return |
| `convex/_generated/api.d.ts` | Registered `patientLibreSecrets` module |
| `artifacts/api-server/internal/libre-link-login.ts` | **New** — shared LibreLink Up login |
| `artifacts/api-server/internal/routes/cgm.ts` | Refactor Libre connect; new routes; readings use `apiBase`; safer logs |
| `artifacts/api-server/internal/convex-patient-backend.ts` | Comment update (shared patient backend helper) |
| `artifacts/mobile/context/AuthContext.tsx` | `libreApiBase` on `CGMConnection` |
| `artifacts/mobile/app/cgm-setup.tsx` | Store credentials after Libre connect; clear on Libre disconnect |
| `artifacts/mobile/app/(tabs)/index.tsx` | Silent Libre refresh + one retry in `performSync` |

---

## Convex storage (parallel Libre store)

**Choice:** Parallel table `patientLibreCredentials` (not merged into Dexcom table) — different credential fields and reconnect semantics; mirrors Dexcom clarity and safety with minimal risk to existing Dexcom rows.

**Table:** `patientLibreCredentials`

- `userId` — `Id<"users">`
- `libreEmail` — `string`
- `librePassword` — `string` (server-only; not exposed to client queries)
- `libreApiBase` — optional `string` (e.g. `https://api.eu.libreview.io` after regional redirect)
- `updatedAt` — `number` (ms)
- Index: `by_userId` on `["userId"]`

**Module:** `convex/patientLibreSecrets.ts`

| Function | Type | Purpose |
|----------|------|---------|
| `upsertCredentials` | mutation | `serverSecret` + `userId` + `passwordHash` + Libre fields; verifies user then upserts |
| `getCredentialsForServer` | mutation | Returns email/password/apiBase **only to callers with valid server secret and passwordHash** |
| `clearCredentials` | mutation | Verifies user then deletes row |

Uses the same `CONVEX_PATIENT_BACKEND_SECRET` gate as Dexcom (`patientDexcomSecrets`).

---

## New API routes

All mounted under `/api/cgm` (existing CGM router).

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/libre/credentials` | `userId`, `passwordHash`, `email`, `password`, `apiBase?` | `{ ok: true }` — never includes password |
| `POST` | `/libre/refresh-session` | `userId`, `passwordHash` | `{ token, accountId?, apiBase }` |
| `POST` | `/libre/clear-credentials` | `userId`, `passwordHash` | `{ ok: true }` |

**Updated (unchanged paths, extended behavior):**

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/libre/connect` | Uses `libreLinkLogin`; response adds `apiBase` |
| `POST` | `/libre/readings` | Accepts optional `apiBase`; uses regional host when provided |

If Convex patient backend env is missing, **credentials** and **refresh-session** return **503**; **clear-credentials** returns `{ ok: true }` so disconnect UX is not blocked.

---

## New environment variables

**None.** Reuses existing:

- Convex: `CONVEX_PATIENT_BACKEND_SECRET`
- API server: `CONVEX_URL`, `CONVEX_PATIENT_BACKEND_SECRET`

---

## Flows

### First successful manual Libre sign-in

1. User submits email/password in **Connect CGM**; app calls `POST /api/cgm/libre/connect`.
2. On success, app calls `setCGMConnection` with `token` and `libreApiBase` (from `apiBase` in response).
3. If `account.convexUserId` and `account.passwordHash` exist, app calls `POST /api/cgm/libre/credentials` with Libre fields + `userId` + `passwordHash`.
4. API verifies via Convex `upsertCredentials` and stores the row. If step 3 fails, the CGM connection still works; a generic warning is logged on the client.

### Later silent refresh on session expiry

1. Home tab `performSync` POSTs readings with `token` and optional `apiBase`.
2. On failure with session-expired semantics **and** Libre **and** Convex account present, app calls `POST /api/cgm/libre/refresh-session` once.
3. API loads stored credentials (server-side only), runs `libreLinkLogin`, returns `token` / `apiBase`.
4. App calls `setCGMConnection` with the new token, retries readings **once**.
5. If retry succeeds, sync continues as normal. If not, behavior matches the previous manual reconnect fallback (alerts when not silent).

### Disconnect cleanup

1. User confirms disconnect on **Libre** while signed in with `convexUserId` + `passwordHash`.
2. App calls `POST /api/cgm/libre/clear-credentials`, then `setCGMConnection({ type: null })` as before.
3. If the clear call fails, local disconnect still runs.

---

## What stayed unchanged

- Dexcom credential store, refresh, and silent sync paths (`patientDexcomSecrets`, Dexcom routes).
- Manual Libre connect URL; successful JSON still includes `token` and `accountId`, with added `apiBase`.
- Doctor Convex ingest helper and routes.
- Manual reconnect alerts and navigation to **Connect CGM** when sync fails after refresh.
- Expo plugins / `app.json` native configuration (not modified).

---

## Manual verification checklist

- [ ] Deploy Convex schema (includes `patientLibreCredentials` and `libreApiBase` on `patientCgmConnections`).
- [ ] Sign in as Convex user, connect Libre; confirm readings sync.
- [ ] Confirm Convex dashboard shows `patientLibreCredentials` row (optional).
- [ ] Invalidate `token` (e.g. stale value) and pull to sync: silent refresh restores readings without reconnect alert when credentials exist.
- [ ] Disconnect Libre: row cleared; local CGM cleared.
- [ ] Dexcom: no regression; silent refresh still works.
- [ ] User without `convexUserId`: Libre connect still works; no credential store call; session expiry still prompts reconnect as before.
- [ ] API logs: no Libre email/password; no bearer token printed.

---

*End of change document.*
