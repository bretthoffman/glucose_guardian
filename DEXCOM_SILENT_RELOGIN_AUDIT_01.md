# Dexcom silent re-login — implementation audit (read-only)

**Date:** 2026-05-13  
**Scope:** Repository as found under `artifacts/mobile`, `artifacts/api-server`, and `convex/`.  
**Goal (future):** Store Dexcom credentials server-side (Convex, private/server-only pattern), never return the password to the client, use them only for silent session refresh after Share session expiry, fall back to manual reconnect on failure. Prefer JS/backend-only (no native rebuild).

Legend:

- **CONFIRMED:** Directly observed in this repo.
- **RECOMMENDATION:** Reasonable next step not yet present in code.

---

## 1. Executive summary (CONFIRMED + RECOMMENDATION)

**CONFIRMED:** The patient CGM flow is entirely **unauthenticated at the HTTP API layer**: `/api/cgm/dexcom/connect` and `/api/cgm/dexcom/readings` accept arbitrary JSON and do not receive `userId`, Convex identity, or app session tokens. Convex is used from the **mobile app** via `ConvexHttpClient` with `userId` + `passwordHash` on patient queries/mutations, and from the **API server** only for **doctor** routes via `CONVEX_URL` + `CONVEX_DOCTOR_INGEST_SECRET` (`artifacts/api-server/internal/convex-doctor.ts`, `convex/doctor.ts`).

**CONFIRMED:** Dexcom session expiry is surfaced as HTTP **401** from `artifacts/api-server/internal/routes/cgm.ts` on the readings route; the home screen maps that to `session_expired` and shows **“Session expired · …”** in the CGM chip; **manual** sync shows an **Alert** with “Reconnect”; **silent** auto-sync does **not** show that alert.

**RECOMMENDATION:** The planned feature is **feasible without native changes** if work stays in Expo TS, Express routes, and Convex schema/functions. **Shippable as EAS Update** for the mobile bundle **if** you do not change native config, native modules, or anything requiring a new binary (CONFIRMED: no Dexcom-specific native module today—only `fetch` to your API).

**Main blockers / gaps (CONFIRMED):**

1. **No linkage today** between API CGM routes and Convex user identity.
2. **No server-side store** for Dexcom username/password; `patientCgmConnections` only stores `sessionId`, `token`, `outsideUS`, `connectedAt` (CONFIRMED in `convex/schema.ts` + `convex/patientCgm.ts`).
3. Patient Convex auth is **`passwordHash` passed from the client** on every call (CONFIRMED)—not a standard session/JWT model; treat as a **pre-existing trust boundary** when designing new API↔Convex bridges.

---

## 2. Mobile / account identity (Question A)

### How does the mobile app know which signed-in Convex user it is?

**CONFIRMED:** After `signIn` or `createAccount`, `AuthContext` keeps a `UserAccount` in React state and persists it to AsyncStorage key `@gluco_guardian_account`:

- `email: string`
- `passwordHash: string` — produced by `hashPassword()` in `artifacts/mobile/context/AuthContext.tsx` (custom string encoding, **not** bcrypt/scrypt).
- `convexUserId?: string` — string form of Convex `Id<"users">` from `api.auth.login` / `api.auth.register`.

**CONFIRMED:** `createConvexAuthClient()` in `artifacts/mobile/utils/convex-auth-client.ts` returns a plain `ConvexHttpClient` pointed at `EXPO_PUBLIC_CONVEX_URL` — no Convex Auth session token in this file.

### Exact identifiers on-device after sign-in

**CONFIRMED (from `UserAccount` + storage):**

| Identifier | Where |
|------------|--------|
| `convexUserId` | `UserAccount`, AsyncStorage `ACCOUNT_KEY` |
| `email` | same |
| `passwordHash` | same (derived from plaintext app password at sign-in) |
| `SESSION_KEY` = `"true"` | AsyncStorage — boolean session flag only |

CGM state uses **`CGMConnection`** (`type`, `sessionId`, `token`, `outsideUS`, `connectedAt`) in AsyncStorage `@gluco_guardian_cgm` and mirrored to Convex via `api.patientCgm.replace` when `convexUserId` is set.

### Which identifiers can associate stored Dexcom credentials with the correct user?

**CONFIRMED:** The natural primary key is **`userId` (`Id<"users">`)** matching `account.convexUserId`.

**RECOMMENDATION:** Any server-side credential row should be keyed by `userId`. For API calls from the app, the client can send **`userId` + `passwordHash`** so the backend can ask Convex to verify the pair (same pattern as `patientCgm.replace`) before writing or reading secrets—**RECOMMENDATION**, not implemented on API today.

### Is the auth model strong enough to trust “store credentials” / “refresh session”?

**CONFIRMED:** Convex patient functions (`patientCgm`, `patientProfile`, `patientGlucose`) use `assertPatientAuth`: load `users` row by `userId` and compare `passwordHash === user.passwordHash`. Anyone who can invoke Convex with the correct `userId` + `passwordHash` passes checks.

**CONFIRMED:** `convex/auth.getUser` accepts only `userId` and returns `{ email }` — **no** `passwordHash` check (informational leak risk for guessed IDs; separate from Dexcom).

**CONFIRMED:** The **Express CGM routes do not authenticate the caller at all**; they only proxy to Dexcom.

**RECOMMENDATION:** For “private beta” server-only storage, mirror the **doctor ingest pattern**: Convex mutations/queries that accept a **`serverSecret`** checked against `process.env.CONVEX_*_SECRET`, callable **only from your API** (which holds the env var), plus optional **`userId` + `passwordHash`** verification inside Convex for patient-scoped actions. The mobile app would **not** call those Convex functions directly for secrets—only the API would, after validating the same proof the app already uses for Convex (or a tighter future token).

---

## 3. Dexcom connect flow (Question B)

### Files implementing manual Dexcom sign-in

**CONFIRMED:**

| Role | File |
|------|------|
| UI + client request | `artifacts/mobile/app/cgm-setup.tsx` |
| Server Dexcom proxy | `artifacts/api-server/internal/routes/cgm.ts` (`POST /dexcom/connect`) |
| Persist session locally + Convex | `artifacts/mobile/context/AuthContext.tsx` — `setCGMConnection` → `commitCGMConnection` → `api.patientCgm.replace` / `clear` |

### Exact request body (mobile → API) on manual Dexcom sign-in

**CONFIRMED** (`cgm-setup.tsx`):

```json
{ "username": "<trimmed string>", "password": "<string>", "outsideUS": <boolean> }
```

Method: `POST`, `Content-Type: application/json`, URL from `apiUrl("/api/cgm/dexcom/connect")` → **`POST /api/cgm/dexcom/connect`** (CONFIRMED: `artifacts/api-server/internal/routes/index.ts` mounts `cgm` at `/cgm` under `/api`).

### Successful response handling

**CONFIRMED:** API returns JSON `{ sessionId, outsideUS }` (`cgm.ts` lines 110–110 area). Mobile parses `data.sessionId`, then:

```ts
await setCGMConnection({
  type: selectedType,
  sessionId: data.sessionId,
  token: data.token,
  outsideUS,
  connectedAt: new Date().toISOString(),
});
```

For Dexcom, `data.token` is undefined; Libre supplies `token`.

### Best place to persist Dexcom credentials server-side after success

**CONFIRMED today:** There is **no** server persistence of Dexcom password; only the session id path above.

**RECOMMENDATION (minimal change to current flow):**

1. **Option A (API-first):** After `res.ok` and before/after `setCGMConnection`, call a **new** authenticated API route (e.g. `POST /api/cgm/dexcom/credentials`) with `userId`, `passwordHash`, `username`, `password`, `outsideUS` — API uses Convex + server secret to store; response contains **no** password.
2. **Option B (inside connect):** Extend `POST /dexcom/connect` to accept optional `userId` + `passwordHash` and store after Dexcom success — couples connect to account linkage (still CONFIRMED-feasible but messier contract).

**RECOMMENDATION:** Prefer **Option A** to keep Dexcom connect response shape stable and keep account linkage explicit.

### Fields available at that hook

**CONFIRMED in UI/state at success:** `username` (trimmed), `password`, `outsideUS`, `sessionId` (from API), `connectedAt` (client ISO), `type: "dexcom"`. **CONFIRMED in scope:** `account.convexUserId`, `account.passwordHash` via `useAuth()` if you add the API call from `cgm-setup.tsx`.

**CONFIRMED NOT in `CGMConnection` type today:** Dexcom username/password are **not** part of the persisted connection object.

---

## 4. Dexcom readings / sync flow (Question B continued + C)

### Readings pipeline

**CONFIRMED:**

| Step | Location |
|------|----------|
| Sync trigger | `artifacts/mobile/app/(tabs)/index.tsx` — `performSync` |
| Endpoint | `POST /api/cgm/dexcom/readings` |
| Request body | `{ sessionId, outsideUS, count }` — `count` 288 or 5 based on backfill heuristic |
| Server | `artifacts/api-server/internal/routes/cgm.ts` — GET to Dexcom Share URL with `sessionId` |
| On success | `bulkAddReadings` → `GlucoseContext` may flush to Convex `patientGlucose.upsertBatch` with `userId` + `passwordHash` |

### Session expiration detection

**CONFIRMED (server):** `cgm.ts` `/dexcom/readings`: non-OK response → `401` + error message; string/array responses containing session invalid patterns → `401`.

**CONFIRMED (client):** `index.tsx` `performSync`:

- Treats as session expired if `res.status === 401` **or** error message matches `/session|expired|reconnect/i`.
- Sets `lastSyncResult` to `{ status: "session_expired", ... }`.
- If `!silent`: `Alert.alert` with “Reconnect” → `router.push("/cgm-setup")`.
- If `silent`: **no** alert — user still sees chip text **“Session expired · …”** via `syncResultLabel`.

### Triggers for sync

**CONFIRMED:** `useEffect` when `isConnected`: immediate `performSync(true)`, interval **5 minutes**, `AppState` **active** → `performSync(true)`. Manual: pull-to-refresh / sync control calls `performSync(false)`.

### Best place for silent re-login logic

**RECOMMENDATION:** Centralize in **`performSync`** (or a small helper it calls): on readings **401** / session message, **once** attempt refresh (new API route that uses stored credentials), update `sessionId` via `setCGMConnection`, retry readings, then if still failing set `session_expired` and keep current UX for manual reconnect.

**RECOMMENDATION (safety / invasiveness):** Prefer **“on failed sync with 401”** (and optionally one retry path on foreground) over aggressive refresh on every launch—**CONFIRMED:** foreground already runs `performSync(true)`; adding refresh **inside** that path avoids new timers.

---

## 5. Convex / data model (Question D)

### Tables / functions related to auth, profile, CGM

**CONFIRMED (`convex/schema.ts`):**

| Table | Purpose |
|-------|---------|
| `users` | `email`, `passwordHash`, timestamps |
| `patientProfiles` | Profile fields keyed by `userId` |
| `patientCgmConnections` | CGM metadata per `userId` |
| `patientGlucoseReadings` | Readings per `userId` |
| `doctorPortalState` | Doctor portal + secret-gated ingest |

**CONFIRMED (`convex/auth.ts`):** `register`, `login`, `getUser`.

**CONFIRMED (`convex/patientCgm.ts`):** `get`, `replace`, `clear` — all require matching `passwordHash`.

### Where should Dexcom credentials live?

**CONFIRMED:** Putting the Dexcom **password** in `patientCgmConnections` would be unsafe unless **every** read path is guaranteed never to expose it—today `patientCgm.get` returns the full connection payload to the client (minus password only because it was never stored).

**RECOMMENDATION:** **New dedicated table** (e.g. `patientDexcomCredentials`) with **no** client-facing query that returns the password. Writes/reads only through Convex functions that either:

- require **`serverSecret`** (API-only), and optionally verify `userId` + `passwordHash`, or
- use Convex **internal** functions + HTTP actions (heavier change).

Simplest alignment with this repo: **duplicate the `doctor.ts` `requireIngestSecret` pattern** for a new `convex/patientDexcomSecrets.ts` (name illustrative).

### Minimal schema shape (RECOMMENDATION)

| Field | Notes |
|-------|--------|
| `userId` | `v.id("users")`, index `by_userId` |
| `dexcomUsername` | string |
| `dexcomPassword` | string (see Security section) |
| `outsideUS` | boolean |
| `updatedAt` | number (ms) |

**RECOMMENDATION:** Optionally `createdAt`; clear row on disconnect.

### Functions needed later

**RECOMMENDATION:**

| Operation | Pattern |
|-----------|---------|
| Save / upsert credentials | `mutation` with `serverSecret` + `userId` + `passwordHash` + creds — verify hash, write row, return `{ ok: true }` only |
| Fetch credentials for refresh | **No client query.** `query`/`mutation` with **only** `serverSecret` + `userId` returning password **only** to server-side caller — still visible in Convex dashboard logs if logged; see Security |
| Clear on disconnect | Same as save, or delete by `userId` after `patientCgm.clear` from app |

**CONFIRMED achievable:** Password **never returned to mobile** if mobile only calls your **Express** API and API uses Convex with a server secret and you **do not** add any query the app calls that returns the secret.

---

## 6. Backend / API routes (Question E)

### Routes to add or change (RECOMMENDATION)

| Route | Purpose |
|-------|--------|
| `POST /api/cgm/dexcom/credentials` (or similar) | After manual connect success — store username/password/outsideUS in Convex via server secret + verify `userId`/`passwordHash` |
| `POST /api/cgm/dexcom/refresh-session` | Read stored creds from Convex (server-side), run same Dexcom auth as `connect`, return `{ sessionId, outsideUS }` only |
| Optional: `DELETE` or POST clear | On disconnect — clear secret row |

### How the backend talks to Convex today

**CONFIRMED:** Only **doctor** flow: `ConvexHttpClient` + `CONVEX_URL` + `CONVEX_DOCTOR_INGEST_SECRET` in `artifacts/api-server/internal/convex-doctor.ts`, used from `artifacts/api-server/internal/routes/doctor.ts` with `api.doctor.*` and `serverSecret` in args.

**CONFIRMED:** **`cgm.ts` does not import Convex.**

### Reusable pattern

**CONFIRMED:** `createConvexDoctorHttpClient()` — new sibling e.g. `internal/convex-patient-backend.ts` with `CONVEX_URL` + **`CONVEX_PATIENT_BACKEND_SECRET`** (RECOMMENDATION: new env name) and Convex functions gated like `requireIngestSecret` in `convex/doctor.ts`.

### API knowing which user’s creds

**CONFIRMED gap:** Today the API cannot know. **RECOMMENDATION:** Require body `{ userId, passwordHash }` (or headers) on new routes; Convex verifies against `users` before read/write secrets.

---

## 7. Security and safety (Question F)

### Safest server-side-only pattern in *this* codebase

**CONFIRMED available pattern:** Shared-secret-gated Convex mutations/queries (`convex/doctor.ts` + API env).

**RECOMMENDATION for beta:** Same pattern for Dexcom secrets; **never** expose a Convex function that returns `dexcomPassword` to the `ConvexHttpClient` used in the mobile app.

### Can the password stay off client read paths?

**CONFIRMED:** Yes **if** you only add API↔Convex paths that omit password from JSON responses and you do not extend `patientCgm.get` / mobile types to include it.

### Logging / leak surfaces

**CONFIRMED:** `artifacts/api-server/internal/routes/cgm.ts`:

- `console.log("Dexcom auth response:", ..., authText.slice(0, 200))` — response is Dexcom-side (typically account id string), not the user’s submitted password; still avoid logging full bodies.
- `console.log("Dexcom login response:", ..., loginText.slice(0, 200))` — session id string risk (sensitive); rotate / redact in production (**RECOMMENDATION**).
- `console.log("Dexcom readings response:", ..., rawText.slice(0, 300))` — may contain glucose data.

**CONFIRMED:** No `console.log(req.body)` in `cgm.ts`.

**CONFIRMED:** `food.ts` logs base64 prefix (not Dexcom).

**Other risks (RECOMMENDATION):** Dexcom passwords in Convex are **plaintext at rest** unless you add application-layer encryption (KMS, etc.). `passwordHash` for **app** login is a **deterministic encoding**, not a slow password hash—weak against offline guessing if DB is compromised (pre-existing).

---

## 8. OTA / rebuild risk (Question G)

**CONFIRMED:** Dexcom integration uses **JavaScript** `fetch` only; no Swift/Kotlin Dexcom SDK in `artifacts/mobile/package.json` for Share login.

**RECOMMENDATION:** If implementation touches only:

- `artifacts/mobile/**/*.tsx` (and related TS),
- `artifacts/api-server/**/*.ts`,
- `convex/**/*.ts`,

and you do **not** add native dependencies or change `app.json` / plugins in a way that requires a new binary, this aligns with **EAS Update** eligibility for the JS bundle.

**RECOMMENDATION:** EAS Update still depends on your Expo project config and runtime version policy—**not** fully verifiable from this audit alone; codebase structure supports “JS-only” intent.

---

## 9. Existing helpers to reuse (Question 10)

**CONFIRMED:**

- `apiUrl()` — `artifacts/mobile/utils/api-base-url.ts`
- `createConvexAuthClient` + `api` — `artifacts/mobile/utils/convex-auth-client.ts`
- `commitCGMConnection` / `setCGMConnection` — `AuthContext.tsx` for persisting new `sessionId` to AsyncStorage + `patientCgm.replace`
- Dexcom auth HTTP logic — refactor from inline `cgm.ts` into a shared helper **within api-server** for `connect` and `refresh-session` (**RECOMMENDATION**)
- Secret-gated Convex + `ConvexHttpClient` on server — `convex-doctor.ts` + `convex/doctor.ts`

---

## 10. Blockers and architectural gaps

**CONFIRMED:**

1. API CGM routes are **anonymous** — must add an **explicit** patient trust channel for credential storage and refresh.
2. **No** credential table or functions exist yet.
3. `getUser` exposes email for any `userId` without re-auth (**CONFIRMED**).

**RECOMMENDATION / product:** Storing third-party medical vendor passwords increases compliance and incident-response obligations even for a private beta.

---

## 11. Explicit answers to your question list (checklist)

### A. Mobile / account identity

| Subquestion | Answer |
|-------------|--------|
| How app knows Convex user | **CONFIRMED:** `UserAccount.convexUserId` from Convex `auth.login` / `auth.register`, persisted in AsyncStorage. |
| Identifiers on-device | **CONFIRMED:** `convexUserId`, `email`, `passwordHash`, session flag. |
| Safe association key | **RECOMMENDATION:** `userId` (`Id<"users">`); verify with `passwordHash` when invoking new API. |
| Strong enough auth | **CONFIRMED:** Custom hash passed from client to Convex; **CONFIRMED:** API has no auth today. **RECOMMENDATION:** Add server-secret + hash verification for any credential API. |

### B. Dexcom connect

| Subquestion | Answer |
|-------------|--------|
| Files | **CONFIRMED:** `cgm-setup.tsx`, `api-server/.../cgm.ts`, `AuthContext.tsx`. |
| Request body | **CONFIRMED:** `{ username, password, outsideUS }`. |
| Success handling | **CONFIRMED:** `setCGMConnection` with `sessionId`, `outsideUS`, `connectedAt`. |
| Best persist hook | **RECOMMENDATION:** After successful API connect, before navigation—call new secure API with creds + `userId` + `passwordHash`. |
| Fields available | **CONFIRMED:** username, password, outsideUS, sessionId, connectedAt, convexUserId/passwordHash from auth context. |

### C. Session expired

| Subquestion | Answer |
|-------------|--------|
| Detection files | **CONFIRMED:** `cgm.ts` readings; `index.tsx` `performSync`. |
| UI | **CONFIRMED:** Chip `Session expired · …`; manual alert with Reconnect. |
| Silent re-login place | **RECOMMENDATION:** Inside `performSync` retry path after 401. |
| Launch / foreground / 401 | **CONFIRMED:** Already syncs on mount and foreground; **RECOMMENDATION:** Add refresh on **401** (minimal), optionally single retry after refresh. |

### D. Convex

| Subquestion | Answer |
|-------------|--------|
| Existing tables | **CONFIRMED:** `users`, `patientProfiles`, `patientCgmConnections`, `patientGlucoseReadings`, `doctorPortalState`. |
| Where creds live | **RECOMMENDATION:** New table, not mixed into client-read `patientCgm.get` payload. |
| Schema | **RECOMMENDATION:** `userId`, dexcom username/password, `outsideUS`, `updatedAt`. |
| Functions | **RECOMMENDATION:** Server-secret mutations + no client password reads. |
| Password never to client | **CONFIRMED feasible** with API-only access pattern. |

### E. Backend

| Subquestion | Answer |
|-------------|--------|
| Routes | **RECOMMENDATION:** credentials save, refresh-session, optional clear — see §6. |
| Convex from API | **CONFIRMED:** Doctor pattern only today; extend similarly. |
| Issues | **CONFIRMED:** No user identity on CGM routes currently. |

### F. Security

| Subquestion | Answer |
|-------------|--------|
| Safest pattern here | **CONFIRMED:** Server secret + Convex gate (doctor pattern). |
| Password off client reads | **CONFIRMED:** Yes if designed as above. |
| Logging leaks | **CONFIRMED:** Verbose Dexcom response logging in `cgm.ts` — tighten before storing secrets (**RECOMMENDATION**). |

### G. OTA

| Subquestion | Answer |
|-------------|--------|
| JS/backend/Convex only | **CONFIRMED:** No native Dexcom module; feasible in principle. |
| EAS Update | **RECOMMENDATION:** Likely yes if native unchanged; confirm against your EAS channel/runtime. |

---

## 12. Future implementation plan (ordered) — **RECOMMENDATION** (not in repo)

1. **Convex:** Add `patientDexcomCredentials` table + mutations: `upsertCredentials({ serverSecret, userId, passwordHash, username, password, outsideUS })`, `getCredentialsForServer({ serverSecret, userId })` returning password **only** to trusted server flows, `clearCredentials(...)`. Mirror `requireIngestSecret` from `convex/doctor.ts`.
2. **Convex:** Add env `CONVEX_PATIENT_BACKEND_SECRET` (deployed in Convex dashboard + API host).
3. **API:** Add `internal/convex-patient-backend.ts` (clone pattern from `convex-doctor.ts`). Wire `POST /api/cgm/dexcom/credentials` and `POST /api/cgm/dexcom/refresh-session`. Refactor Dexcom login steps from `cgm.ts` into a shared module used by `connect` and `refresh-session`.
4. **Mobile — save hook:** In `cgm-setup.tsx`, after successful connect, if `account?.convexUserId`, call credentials API with `userId`, `passwordHash`, Dexcom fields; handle failure non-blockingly or show warning (**product choice**).
5. **Mobile — silent refresh:** In `index.tsx` `performSync`, on session-expired detection, call `refresh-session`, then `setCGMConnection` with new `sessionId`, retry readings once; on failure keep `session_expired` + existing manual UX.
6. **Success / failure:** Success: update chip, normal sync. Failure: leave expired state, optional toast; manual reconnect unchanged.
7. **Disconnect:** `cgm-setup.tsx` `disconnect` → extend to call API clear credentials when Convex-backed user (**RECOMMENDATION**); local `setCGMConnection({ type: null })` **CONFIRMED** already clears Convex CGM via `patientCgm.clear`.
8. **Tests to run manually:** Dexcom connect → credentials row exists; readings OK; force invalid `sessionId` → refresh restores; wrong `passwordHash` → store/refresh denied; disconnect → secrets removed; silent sync path no duplicate alerts; logs contain no password.

---

## 13. Files inspected (highest signal)

**CONFIRMED read for this audit:**

- `artifacts/mobile/app/cgm-setup.tsx`
- `artifacts/mobile/app/(tabs)/index.tsx`
- `artifacts/mobile/context/AuthContext.tsx`
- `artifacts/mobile/context/GlucoseContext.tsx`
- `artifacts/mobile/utils/convex-auth-client.ts`
- `artifacts/mobile/utils/api-base-url.ts`
- `artifacts/mobile/app/_layout.tsx`
- `artifacts/api-server/internal/routes/cgm.ts`
- `artifacts/api-server/internal/routes/index.ts`
- `artifacts/api-server/internal/app.ts`
- `artifacts/api-server/internal/convex-doctor.ts`
- `artifacts/api-server/internal/routes/doctor.ts` (partial grep)
- `convex/schema.ts`
- `convex/auth.ts`
- `convex/patientCgm.ts`
- `convex/patientProfile.ts`
- `convex/patientGlucose.ts`
- `convex/doctor.ts`

---

## 14. Confirmed vs recommendation summary

| Topic | Status |
|-------|--------|
| Current Dexcom connect/readings paths and payloads | **CONFIRMED** |
| Session expiry → 401 + UI behavior | **CONFIRMED** |
| No API-side user auth on CGM | **CONFIRMED** |
| No Dexcom password storage | **CONFIRMED** |
| Doctor Convex + server secret pattern | **CONFIRMED** |
| New table, new API routes, `performSync` retry, EAS eligibility | **RECOMMENDATION** |

---

*End of audit document.*
