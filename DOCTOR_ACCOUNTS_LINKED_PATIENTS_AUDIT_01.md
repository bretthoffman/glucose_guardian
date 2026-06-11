# Doctor Accounts & Linked Patients — Architecture Audit (01)

**Date:** 2026-06-11  
**Scope:** Read-only audit for evolving the doctor flow from access-code-only viewing to persistent doctor accounts with linked patients. No code changes were made.

**Goal:** Extend the **existing** Gluco-Guardian Convex + API backend. Keep the doctor portal as a **separate HTTP consumer** (standalone frontend repo).

---

## Executive summary

Today the doctor experience is **not account-based**. The standalone doctor portal logs in with a **patient access code** (`doctorCode`), stores it in `sessionStorage`, and reads a **denormalized snapshot** from `doctorPortalState` via unauthenticated API routes. There is **no doctor identity**, **no link persistence**, and **no authorization** beyond knowing the 6-character code.

The patient side already has the right **sharing primitive**: each patient profile owns a `doctorCode` (generated in mobile, stored in Convex `patientProfiles`). Mobile pushes snapshots to `POST /api/doctor/sync`, keyed by that code. Clinical source-of-truth for patients lives in `users` / `patientProfiles` / `patientGlucoseReadings`; doctor viewing intentionally uses a **separate snapshot table** (`doctorPortalState`).

**Recommended direction:** Add **`doctorAccounts`** + **`doctorPatientLinks`** in Convex, expose **doctor auth + link CRUD** through the existing API server, and **gate** patient snapshot/message routes on “authenticated doctor + active link to this access code.” Keep `doctorPortalState` as the payload store; do not build a second backend.

**Verdict:** Build in **Gluco-Guardian backend + separate portal frontend**. Difficulty is **moderate** — schema/API/auth are straightforward; the biggest work is **securing existing open routes** and **portal UX migration** without breaking mobile sync.

| Area | Current state | Gap for target feature |
|------|---------------|------------------------|
| Doctor identity | None | Need `doctorAccounts` + login/session |
| Patient association | Ephemeral (portal remembers code in browser) | Need durable `doctorPatientLinks` |
| Patient data for doctors | `doctorPortalState` snapshot by `accessCode` | Keep; authorize reads via links |
| Patient access code | `patientProfiles.doctorCode` (6 chars) | Reuse as link credential; add validation index |
| API security | No auth on doctor read/sync/write | Must add doctor session + link checks |

---

## 1. Current doctor login / doctor portal backend flow

### Portal (standalone frontend)

| Step | Behavior |
|------|----------|
| Login UI | User enters **patient access code** (any string ≥3 chars accepted by API; mobile generates **6** chars). |
| `POST /api/doctor/login` | Body: `{ accessCode }`. Uppercases code. Returns `{ success, accessCode, patientName, hasData }`. **Does not authenticate a doctor.** Accepts any valid-format code even if no patient data exists. |
| Client session | `sessionStorage`: `gg_doc_access_code`, `gg_doc_patient_name` (`_doctor-portal-standalone/src/hooks/use-auth.ts`). |
| Dashboard | `GET /api/doctor/patient/:accessCode` polled every 30s. |
| Messages | `GET/POST /api/doctor/messages/:accessCode`. |

There is **no server session**, **no JWT**, **no cookie**, and **no proof** the caller is a clinician.

### API server (`artifacts/api-server/internal/routes/doctor.ts`)

Routes mounted at `/api/doctor/*` (`artifacts/api-server/internal/routes/index.ts`):

| Route | Auth today | Backend |
|-------|------------|---------|
| `POST /login` | None | Checks code format; optionally reads Convex/memory for `patientName` / `hasData` |
| `POST /sync` | **None** | Mobile → snapshot upsert |
| `GET /patient/:accessCode` | **None** | Returns full `PatientSnapshot` or 404 |
| `GET /messages/:accessCode` | **None** | Returns messages |
| `POST /messages/:accessCode` | **None** | Appends message (`sender: doctor \| guardian`) |

When `CONVEX_URL` + `CONVEX_DOCTOR_INGEST_SECRET` are set, routes call Convex via `ConvexHttpClient` (`artifacts/api-server/internal/convex-doctor.ts`). Otherwise in-memory `Map`s + `DEMO` seed.

### Mobile “doctor mode” (separate from portal)

Mobile auth screen supports **in-app doctor mode** via `enterDoctorMode(code)` — validates against the **local/Convex profile’s** `doctorCode`, sets in-memory `doctorSession`. This is **not** the same as portal login; it does not call `/api/doctor/login`. See `artifacts/mobile/app/auth.tsx`, `AuthContext.tsx`.

### OpenAPI contract

`lib/api-spec/openapi.yaml` documents the five doctor routes above. Generated clients: `lib/api-client-react`, `lib/api-zod`.

---

## 2. Current doctor-related Convex tables / functions

### Table: `doctorPortalState` (`convex/schema.ts`)

One document per **uppercase `accessCode`**.

| Field | Purpose |
|-------|---------|
| `accessCode` | Primary lookup key (matches mobile `doctorCode`) |
| `messages` | Doctor ↔ guardian thread (always present once row exists) |
| `profile`, `glucoseReadings`, `insulinLog`, `foodLog`, `alertPreferences`, `syncedAt` | Optional until first successful mobile sync |

**Index:** `by_accessCode` on `accessCode`.

### Functions: `convex/doctor.ts`

All gated by `CONVEX_DOCTOR_INGEST_SECRET` (server-side shared secret, not doctor identity):

| Function | Type | Purpose |
|----------|------|---------|
| `getState` | query | Load row by `accessCode` |
| `upsertFromSync` | mutation | Replace snapshot from mobile sync |
| `appendMessage` | mutation | Append message; create messages-only row if needed |
| `seedDemo` | mutation | Idempotent `DEMO` patient |

**Important:** These are **public Convex functions** protected only by the ingest secret passed from the API server. They are **not** callable safely from the doctor portal directly.

### No doctor account tables exist today

There is no `doctors`, `doctorSessions`, or `doctorPatientLinks` in `convex/schema.ts`.

---

## 3. Current patient access code model

### Where the code lives

| Location | Field | Notes |
|----------|-------|-------|
| Convex `patientProfiles` | `doctorCode`, `doctorCodeIssuedAt` | Source of truth when patient uses Convex-backed profile |
| Mobile `UserProfile` | Same fields | Synced via `commitProfile` → `patientProfile.replace` |
| `doctorPortalState` | `accessCode` | Snapshot key; set from mobile sync (`doctorCode.toUpperCase()`) |

### Generation & sharing (mobile)

- **`generateDoctorCode()`** — 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`AuthContext.tsx`).
- Shown on Dashboard → “Access Management”; parent shares with doctor.
- **`syncToDoctor`** uses `currentProfile.doctorCode.toUpperCase()` as `accessCode` in sync payload.

### Validation gaps

- **`patientProfiles` has no `by_doctorCode` index** — cannot efficiently verify “this code belongs to an active patient” from Convex without scan (caregiver codes use `by_caregiverCode`).
- **`POST /api/doctor/login`** does not check `patientProfiles` at all — only snapshot presence for `hasData`.
- **Portal accepts codes ≥3 chars**; mobile generates **6** — inconsistent validation.
- **Caregiver codes** are also 6-char alphanumeric with a dedicated index — theoretical collision if same string used for both (separate fields, no cross-check).

### Code rotation / revocation

- Regenerating `doctorCode` updates the patient profile but **does not** delete or rename existing `doctorPortalState` rows keyed on the old code.
- No server-side “revoke all doctor links” when code rotates (links do not exist yet anyway).

---

## 4. How patient data is stored and retrieved for doctor viewing

### Write path (mobile → backend)

```
Dashboard tab mounted
  → syncToDoctor(glucoseReadings)  [immediate + every 120s]
  → POST /api/doctor/sync
  → Convex doctor.upsertFromSync (or in-memory Map)
  → doctorPortalState[accessCode] = full PatientSnapshot
```

**Gates:** `profile.doctorCode` set, `history.length > 0`, Dashboard mounted. See `DOCTOR_SYNC_TRACE.md`.

**Sync payload is denormalized:** profile subset, last ~300 glucose points, insulin/food logs, messages, alert prefs. **Not** a live join from `patientGlucoseReadings`.

### Read path (portal → backend)

```
GET /api/doctor/patient/:accessCode
  → doctor.getState
  → 404 if no profile on snapshot (messages-only rows don't count as “patient data”)
```

Messages merged on sync (server-only message IDs preserved). Doctor-sent messages via `appendMessage`.

### Relationship to canonical patient data

| Store | Role for doctors today |
|-------|------------------------|
| `patientProfiles` + `patientGlucoseReadings` | **Not read** by doctor routes |
| `doctorPortalState` | **Only** store doctor portal/API reads |

For linked-patient accounts, **keep this snapshot model** for portal performance and parity with current UI. Link records should **point at `accessCode`**, not duplicate clinical rows.

---

## 5. Recommended schema additions (minimal)

Add to **`convex/schema.ts`** (names illustrative; pick one convention and stick to it):

### `doctorAccounts`

| Field | Type | Notes |
|-------|------|-------|
| `email` | string | Unique, normalized lowercase |
| `passwordHash` | string | Match patient pattern (client-side hash) **or** upgrade to server bcrypt later |
| `displayName` | string | e.g. “Dr. Jane Smith” |
| `institution` | optional string | |
| `createdAt` / `updatedAt` | number | |

**Indexes:** `by_email` (unique).

### `doctorSessions` (if not using stateless JWT only)

| Field | Type | Notes |
|-------|------|-------|
| `doctorId` | Id<`doctorAccounts`> | |
| `tokenHash` | string | Opaque session token |
| `expiresAt` | number | |
| `createdAt` | number | |

**Indexes:** `by_tokenHash`, `by_doctorId`.

*Alternative:* Issue signed JWT from API server only (no Convex session table) — simpler for Vercel serverless.

### `doctorPatientLinks`

| Field | Type | Notes |
|-------|------|-------|
| `doctorId` | Id<`doctorAccounts`> | |
| `accessCode` | string | Uppercase; matches `doctorPortalState.accessCode` / `patientProfiles.doctorCode` |
| `patientUserId` | optional Id<`users`> | Set when link validated against `patientProfiles` |
| `displayName` | optional string | Snapshot of `childName` at link time for list UI |
| `linkedAt` | number | |
| `revokedAt` | optional number | Soft unlink |

**Indexes:**

- `by_doctorId` — list my patients
- `by_doctorId_accessCode` — **unique** composite (prevent duplicate links)
- `by_accessCode` — optional: audit which doctors linked a patient

### `patientProfiles` enhancement

- **Add index `by_doctorCode`** on `doctorCode` — required for O(1) link validation (“does this code belong to a real patient?”).

### Convex functions (new module e.g. `convex/doctorAccounts.ts`)

| Function | Purpose |
|----------|---------|
| `register` / `login` | Doctor email + passwordHash (mirror `convex/auth.ts` pattern) |
| `createLink` | Authenticated doctor + accessCode → validate code → insert link |
| `listLinks` | By doctorId |
| `revokeLink` | Soft revoke |
| `assertDoctorCanAccess` | Internal helper: doctorId + accessCode → active link exists |

Keep existing **`doctorPortalState`** and **`convex/doctor.ts`** ingest functions unchanged for mobile sync; add **separate** doctor-auth functions callable from API with doctor session (not ingest secret).

---

## 6. Recommended API route additions / changes

### New routes (doctor-authenticated)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/doctor/auth/register` | Create doctor account |
| `POST` | `/api/doctor/auth/login` | Returns session token / Set-Cookie |
| `POST` | `/api/doctor/auth/logout` | Invalidate session |
| `GET` | `/api/doctor/me` | Current doctor profile |
| `GET` | `/api/doctor/me/patients` | Linked patients (code, displayName, lastSyncedAt from snapshot) |
| `POST` | `/api/doctor/me/patients/link` | Body: `{ accessCode }` — validate & persist link |
| `DELETE` | `/api/doctor/me/patients/:accessCode` | Revoke link |

### Change existing routes

| Route | Change |
|-------|--------|
| `POST /api/doctor/login` | **Deprecate** or repurpose as alias for link+open; replace portal login with doctor auth + patient list |
| `GET /api/doctor/patient/:accessCode` | Require **doctor session** + **active link** to `accessCode` |
| `GET/POST /api/doctor/messages/:accessCode` | Same authorization |
| `POST /api/doctor/sync` | **Keep unauthenticated from mobile** OR require patient auth (future hardening); out of scope for doctor accounts but note security debt |

### OpenAPI / codegen

Update `lib/api-spec/openapi.yaml` → regenerate `api-client-react` / `api-zod` for standalone portal.

### Authorization middleware (API server)

Add `requireDoctorSession` Express middleware:

1. Parse Bearer token or session cookie.
2. Resolve `doctorId`.
3. For `:accessCode` routes, call Convex `assertDoctorCanAccess(doctorId, accessCode)`.

---

## 7. How doctor auth should fit alongside patient auth

### Patient auth (existing)

| Aspect | Implementation |
|--------|----------------|
| Identity | `users` table — email + `passwordHash` |
| Client | Mobile calls **`convex/auth`** directly (`register`, `login`, `getUser`) |
| Authorization | Every patient mutation/query passes `userId` + `passwordHash` |
| Secondary access | **Caregiver code** — public `getByCaregiverCode` query; code **is** the credential |

### Doctor auth (recommended)

| Aspect | Recommendation |
|--------|----------------|
| Identity | **Separate `doctorAccounts` table** — do **not** reuse `users` |
| Client | Doctor portal → **API server only** (not direct Convex), same as ideal for mobile long-term |
| Credential | Email + password (hash pattern aligned with patients for consistency) |
| Session | HTTP-only cookie or Bearer JWT issued by API server; store in portal memory/localStorage |
| Patient linking | **Access code is a one-time linking credential** (like adding a friend by code), not the login session |
| Post-login UX | Doctor sees **linked patient list** immediately from `doctorPatientLinks`; click → existing patient dashboard |

### Parallel with caregiver model

| Role | Login | Persistent relationship |
|------|-------|-------------------------|
| Caregiver | 6-char code → in-app session (not persisted server-side) | None — re-enter code each time |
| Doctor (today) | Patient code in portal | None — code in sessionStorage |
| Doctor (target) | Doctor email/password | **Links** table survives across sessions |

### Mobile `enterDoctorMode`

Unchanged initially — in-app read-only mode is orthogonal to portal accounts. Long term, consider aligning messaging sync so portal messages and in-app doctor chat share one thread (already via `doctorPortalState.messages`).

---

## 8. Security risks and model collisions

### Critical (existing)

1. **Unauthenticated snapshot read** — Anyone who knows/guesses `accessCode` gets full CGM/insulin/food data (`GET /patient/:accessCode`).
2. **Unauthenticated sync write** — `POST /sync` accepts arbitrary payloads for any `accessCode` (spoofing / poisoning snapshots).
3. **Short access code entropy** — 6-char custom alphabet ≈ 32^6 (~1B); brute-forceable without rate limits.
4. **No rate limiting** on doctor routes.

### Introduced by new model (mitigate in design)

| Risk | Mitigation |
|------|------------|
| Doctor account takeover | Email verification (phase 2), strong password policy, session expiry |
| Linking without patient consent | Require code match on **`patientProfiles.doctorCode`** (proves patient generated it); optional future “approve link” push |
| Stale links after code rotation | On `generateDoctorCode`, invalidate links where `accessCode != new code` (mobile + Convex mutation) |
| Same code, multiple doctors | Allowed by design (multiple clinicians); document HIPAA/access policy |
| `users` vs `doctorAccounts` collision | Separate tables + separate login endpoints |
| Caregiver vs doctor code collision | Extremely unlikely; add assert `code != caregiverCode` on link validation |
| Dual auth on Convex | Doctor auth functions must **not** use `CONVEX_DOCTOR_INGEST_SECRET` — separate auth path |
| Direct Convex calls from portal | **Forbidden** — portal only talks to API; keeps secrets server-side |

### Model collision: two meanings of “doctor login”

| Name today | Meaning |
|------------|---------|
| `POST /api/doctor/login` | Patient access code check |
| `convex/auth.login` | Patient email login |
| Mobile `enterDoctorMode` | In-app code gate |

Rename new endpoint to **`/api/doctor/auth/login`** and deprecate old “login” to avoid confusion.

---

## 9. Recommended minimal architecture

```
┌─────────────────────┐         ┌──────────────────────────┐
│  Doctor portal      │  HTTPS  │  artifacts/api-server    │
│  (standalone repo)  │ ──────► │  /api/doctor/auth/*      │
│                     │         │  /api/doctor/me/patients*│
└─────────────────────┘         │  /api/doctor/patient/:code│ (authz)
                                └───────────┬──────────────┘
                                            │ ConvexHttpClient
                                            ▼
                                ┌──────────────────────────┐
                                │  Convex                  │
                                │  doctorAccounts          │
                                │  doctorPatientLinks      │
                                │  doctorPortalState       │◄── mobile sync
                                │  patientProfiles         │◄── doctorCode source
                                └──────────────────────────┘
                                            ▲
┌─────────────────────┐                     │
│  Mobile app         │ ─ POST /doctor/sync ┘
└─────────────────────┘
```

### Phase 1 — Backend (this repo)

1. Schema: `doctorAccounts`, `doctorPatientLinks`, `by_doctorCode` index.
2. Convex: doctor register/login, link CRUD, access assertion.
3. API: auth middleware + new routes; **secure** existing patient/message GET/POST.
4. OpenAPI + codegen update.
5. Rate limit `/link` and `/auth/login`.

### Phase 2 — Portal (standalone repo)

1. Replace access-code login with email/password.
2. Patient list screen after login.
3. “Add patient” → enter access code → `POST .../link`.
4. Patient detail reuses existing panels; pass `accessCode` from selected link.
5. Session token + `VITE_API_BASE_URL` (already supported).

### Phase 3 — Hardening (optional)

1. Authenticate `POST /sync` with patient session or signed sync token.
2. Invalidate links on doctor code regeneration.
3. Patient notification when a doctor links.
4. Move doctor auth to Convex Auth / OAuth (enterprise SSO).

### What **not** to do

- Do **not** create a second doctor backend or duplicate snapshot storage in link rows.
- Do **not** serve doctor UI from this monorepo (already extracted).
- Do **not** merge doctor accounts into `users` without a `role` redesign.

---

## Files inspected

| Path | Relevance |
|------|-----------|
| `convex/schema.ts` | All tables; `doctorPortalState`, `patientProfiles.doctorCode`, `users` |
| `convex/doctor.ts` | Snapshot CRUD, ingest secret gate |
| `convex/auth.ts` | Patient register/login pattern |
| `convex/patientProfile.ts` | Profile CRUD, caregiver code lookup pattern |
| `artifacts/api-server/internal/routes/doctor.ts` | All doctor HTTP routes |
| `artifacts/api-server/internal/routes/index.ts` | Router mount |
| `artifacts/api-server/internal/convex-doctor.ts` | Convex client + env gate |
| `lib/api-spec/openapi.yaml` | Doctor API contract |
| `lib/api-client-react/src/generated/api.ts` | Generated doctor hooks |
| `artifacts/mobile/context/AuthContext.tsx` | `generateDoctorCode`, `syncToDoctor`, `enterDoctorMode` |
| `artifacts/mobile/app/(tabs)/dashboard.tsx` | Sync trigger, code UI |
| `artifacts/mobile/app/auth.tsx` | In-app doctor mode entry |
| `artifacts/doctor-portal/README.md` | Portal moved to standalone |
| `_doctor-portal-standalone/src/hooks/use-auth.ts` | Portal session model (reference) |
| `DOCTOR_SYNC_TRACE.md` | Sync preconditions |
| `CONVEX_CHANGE_01.md` | Doctor snapshot persistence design |
| `DOCTOR_PORTAL_EXTRACTION_AUDIT_01.md` | Portal/backend boundary |

---

## Implementation checklist (when building)

- [ ] Add Convex tables + indexes
- [ ] Implement doctor auth (mirror patient auth separation)
- [ ] Implement link validation against `patientProfiles.doctorCode`
- [ ] Add API auth middleware
- [ ] Lock down `GET/POST` patient/message routes
- [ ] Add list/link/unlink endpoints
- [ ] Update OpenAPI + regenerate clients
- [ ] Update standalone portal login UX
- [ ] Document env vars / session cookie CORS for cross-origin portal
- [ ] Add integration tests: register → login → link → read patient

---

## Biggest implementation risks

1. **Securing legacy open routes** — Changing `GET /patient/:accessCode` breaks any client still using code-only auth (portal must ship with backend).
2. **Cross-origin doctor sessions** — Standalone portal on different domain requires explicit cookie (`SameSite=None; Secure`) or Bearer tokens + CORS.
3. **Link validation without snapshot** — Patient may have `doctorCode` but no sync yet; list UI should show “pending sync” (existing portal empty state).
4. **Code rotation** — Without invalidating links, doctors retain access via old `accessCode` rows in `doctorPortalState`.
5. **Ingest secret vs doctor auth** — Team must keep two Convex authorization models distinct to avoid accidental public exposure.

---

## Answer: where to build

| Layer | Location |
|-------|----------|
| **Backend (accounts, links, authz, snapshots)** | **Gluco-Guardian monorepo** — `convex/`, `artifacts/api-server/`, `lib/api-spec/` |
| **Doctor portal UI** | **Separate repo** — `_doctor-portal-standalone/` (HTTP consumer only) |
| **Mobile** | Minimal changes Phase 1; optional link-revocation on code regen Phase 3 |

This matches the stated goal: **one backend**, **no second doctor server**, portal remains a **thin client**.
