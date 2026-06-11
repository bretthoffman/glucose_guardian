# Doctor accounts + linked patients — change 01 (Phase 1 backend)

Phase 1 adds **persistent doctor accounts**, **durable doctor–patient links**, and **authenticated access** to doctor snapshot/message routes. The standalone doctor portal repo is **not** updated in this pass.

Reference design: `DOCTOR_ACCOUNTS_LINKED_PATIENTS_AUDIT_01.md`.

## What changed

- **Convex:** New tables for doctor accounts, sessions, and patient links; new `convex/doctorAccounts.ts` module (separate from snapshot ingest in `convex/doctor.ts`).
- **API server:** Doctor auth + link HTTP routes; Bearer session middleware; secured patient/message routes.
- **OpenAPI / codegen:** Contract and generated clients updated for new routes and auth scheme.
- **Security:** Open code-only access to patient snapshots/messages is **closed** when doctor accounts are configured. Legacy `POST /api/doctor/login` remains but is explicitly deprecated and does not substitute for auth on secured routes.

## Schema additions

### `doctorAccounts`

| Field | Type | Notes |
|-------|------|-------|
| `email` | string | Lowercased on register |
| `passwordHash` | string | Client-computed hash (same style as patient auth) |
| `displayName` | string | |
| `institution` | string? | |
| `createdAt` | number | |
| `updatedAt` | number | |

**Index:** `by_email` on `email`.

### `doctorSessions`

Stores hashed Bearer tokens for API auth (not exposed to clients).

| Field | Type |
|-------|------|
| `doctorId` | `Id<"doctorAccounts">` |
| `tokenHash` | string (SHA-256 of opaque token) |
| `expiresAt` | number |
| `createdAt` | number |

**Indexes:** `by_tokenHash`, `by_doctorId`.

### `doctorPatientLinks`

| Field | Type | Notes |
|-------|------|-------|
| `doctorId` | `Id<"doctorAccounts">` | |
| `accessCode` | string | Normalized 6-char uppercase alphanumeric |
| `patientUserId` | `Id<"users">`? | Set from `patientProfiles` at link time |
| `displayName` | string? | Snapshot of patient name |
| `linkedAt` | number | |
| `revokedAt` | number? | Soft unlink |

**Indexes:** `by_doctorId`, `by_doctorId_accessCode`, `by_accessCode`.

### `patientProfiles`

**New index:** `by_doctorCode` on `doctorCode` (used to validate link codes).

### Unchanged

- **`doctorPortalState`** — still the doctor-view snapshot store (mobile sync target).
- **Patient `users` / patient auth** — separate from doctor accounts.

## Convex functions (`convex/doctorAccounts.ts`)

All gated by **`CONVEX_DOCTOR_API_SECRET`** (distinct from **`CONVEX_DOCTOR_INGEST_SECRET`**).

| Function | Type | Purpose |
|----------|------|---------|
| `register` | mutation | Create doctor account |
| `login` | query | Validate email + passwordHash |
| `getById` | query | Doctor profile by id |
| `createSession` | mutation | Store session token hash |
| `validateSession` | query | Resolve doctor from token hash |
| `revokeSession` | mutation | Logout (delete session row) |
| `createLink` | mutation | Link patient by access code |
| `listLinks` | query | Active linked patients + snapshot status |
| `revokeLink` | mutation | Soft-unlink patient |
| `assertCanAccess` | query | Check active link for doctor + code |

**Access code normalization:** trim → uppercase → strip non-alphanumeric → max 6 chars (must be exactly 6 for linking).

**Link validation:** Code must match `patientProfiles.doctorCode` via `by_doctorCode`; rejects collision with caregiver code; idempotent for active links; reactivates revoked links.

## New API routes

Base path: `/api/doctor` (as mounted by the API server).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/register` | — | Register doctor account |
| POST | `/auth/login` | — | Login; returns Bearer token |
| POST | `/auth/logout` | Bearer | Revoke session |
| GET | `/me` | Bearer | Current doctor profile |
| GET | `/me/patients` | Bearer | List linked patients |
| POST | `/me/patients/link` | Bearer | Link patient by `accessCode` |
| DELETE | `/me/patients/:accessCode` | Bearer | Revoke link |

### Secured existing routes (require Bearer + active link)

| Method | Path |
|--------|------|
| GET | `/patient/:accessCode` |
| GET | `/messages/:accessCode` |
| POST | `/messages/:accessCode` |

### Intentionally unchanged

| Method | Path | Notes |
|--------|------|-------|
| POST | `/sync` | Mobile snapshot ingest; still uses ingest secret path |
| POST | `/login` | **Deprecated** legacy code-only probe (see below) |

## Auth / session model

- **Approach:** Opaque **Bearer token** (32 random bytes, hex-encoded), **not JWT**.
- **Login:** `POST /api/doctor/auth/login` with `{ email, passwordHash }` returns `{ token, expiresAt, doctor }`.
- **Requests:** `Authorization: Bearer <token>`.
- **Storage:** API server hashes token with SHA-256; Convex `doctorSessions` stores `tokenHash` + `expiresAt` (30-day TTL).
- **Logout:** `POST /api/doctor/auth/logout` deletes the session row.
- **Password handling:** Same pattern as patient auth — client sends **`passwordHash`**; server never receives raw passwords on these routes.
- **Secrets:** Convex doctor-account functions require **`CONVEX_DOCTOR_API_SECRET`** on both API server and Convex dashboard. Snapshot sync still uses **`CONVEX_DOCTOR_INGEST_SECRET`**.

## Doctor–patient linking

1. Doctor registers/logs in and obtains a Bearer token.
2. Patient shares their **doctor access code** (`patientProfiles.doctorCode` from the mobile app).
3. Doctor calls `POST /api/doctor/me/patients/link` with `{ accessCode }`.
4. Server normalizes code, validates against `patientProfiles.by_doctorCode`, creates or reactivates `doctorPatientLinks` row.
5. If `doctorPortalState` already has data for that code, link response includes `hasData: true` and `syncedAt`; otherwise link is valid with `hasData: false` (pending until mobile sync).
6. Doctor accesses snapshot/messages only for **linked** codes via secured routes.

## Legacy `POST /api/doctor/login`

**Status:** Deprecated, kept for backward compatibility during portal migration.

- Returns `Deprecation: true` header and JSON fields `deprecated: true` + `migration` hint.
- Validates/normalizes access code and may report whether snapshot data exists.
- **Does not** grant access to secured routes; those require account login + link + Bearer token.
- **Security note:** When `CONVEX_URL` + `CONVEX_DOCTOR_API_SECRET` are set, unauthenticated snapshot/message access is **denied** (401/403). The old open GET/POST paths are closed.

## Files changed / added

| Path | Role |
|------|------|
| `convex/schema.ts` | Doctor tables + `patientProfiles.by_doctorCode` |
| `convex/doctorAccounts.ts` | **New** — account, session, link Convex functions |
| `convex/_generated/api.d.ts` | Module registration for `doctorAccounts` |
| `artifacts/api-server/internal/convex-doctor-accounts.ts` | **New** — client + env helpers |
| `artifacts/api-server/internal/doctor-auth.ts` | **New** — Bearer auth middleware |
| `artifacts/api-server/internal/routes/doctor.ts` | Auth/link routes; secure patient/message routes |
| `artifacts/api-server/.env.example` | **New** — env var documentation |
| `lib/api-spec/openapi.yaml` | OpenAPI contract |
| `lib/api-client-react/src/generated/*` | Regenerated React client |
| `lib/api-zod/src/generated/*` | Regenerated Zod types |
| `DOCTOR_ACCOUNTS_LINKED_PATIENTS_CHANGE_01.md` | This document |

## Environment variables

### Convex dashboard

| Variable | Purpose |
|----------|---------|
| `CONVEX_DOCTOR_API_SECRET` | Gates `doctorAccounts.*` functions |
| `CONVEX_DOCTOR_INGEST_SECRET` | Unchanged; gates `doctor.*` snapshot ingest |

Use **different** random values for each secret.

### API server (local / Vercel)

| Variable | Required for | Description |
|----------|--------------|-------------|
| `CONVEX_URL` | Doctor accounts + snapshots | Convex deployment URL |
| `CONVEX_DOCTOR_API_SECRET` | Doctor accounts + auth | Must match Convex dashboard |
| `CONVEX_DOCTOR_INGEST_SECRET` | Snapshot sync + secured reads | Must match Convex dashboard |

If `CONVEX_URL` + `CONVEX_DOCTOR_API_SECRET` are missing, doctor account routes return **503**. Secured patient/message routes also require doctor accounts to be configured.

## Setup steps

1. `pnpm install` (if needed).
2. Deploy Convex schema/functions: `pnpm run convex:deploy` (or `convex dev` locally).
3. Set `CONVEX_DOCTOR_API_SECRET` in Convex dashboard **and** API server env.
4. Regenerate clients after OpenAPI edits: `pnpm --filter @workspace/api-spec run codegen`.
5. Verify: `pnpm --filter @workspace/api-server run typecheck`.

## Migration notes — standalone doctor portal (Phase 2)

The portal in `_doctor-portal-standalone/` still uses deprecated code-only login and unauthenticated patient fetches. After this backend is deployed with doctor accounts configured:

1. Replace login with `POST /api/doctor/auth/login` (email + passwordHash).
2. Add “link patient” flow via `POST /api/doctor/me/patients/link`.
3. List patients with `GET /api/doctor/me/patients`.
4. Send `Authorization: Bearer <token>` on all patient/message API calls.
5. Copy/regenerate API client from updated `lib/api-spec/openapi.yaml`.
6. Stop relying on `POST /api/doctor/login` for dashboard access.

**Caveat:** Linked-but-not-yet-synced patients appear in the patient list with `hasData: false`; UI should handle empty/pending state until mobile sync populates `doctorPortalState`.

## Manual verification checklist

1. **Deploy:** Convex deploy succeeds; dashboard shows `doctorAccounts`, `doctorSessions`, `doctorPatientLinks`.
2. **Register:** `POST /api/doctor/auth/register` with email, passwordHash, displayName → 201 + doctorId.
3. **Login:** `POST /api/doctor/auth/login` → token + doctor profile.
4. **Me:** `GET /api/doctor/me` with Bearer → profile.
5. **Link (invalid):** `POST /api/doctor/me/patients/link` with bad code → 404.
6. **Link (valid):** Use a real `doctorCode` from a patient profile → 201, `hasData` reflects snapshot state.
7. **List:** `GET /api/doctor/me/patients` → linked patient(s).
8. **Unauthorized snapshot:** `GET /api/doctor/patient/:code` without Bearer → 401.
9. **Forbidden snapshot:** Bearer but no link → 403.
10. **Authorized snapshot:** Bearer + link → 200 (or 404 if no sync data yet, depending on route behavior).
11. **Messages:** Same auth/link rules for GET/POST messages.
12. **Unlink:** `DELETE /api/doctor/me/patients/:code` → subsequent snapshot access 403.
13. **Logout:** `POST /api/doctor/auth/logout` → token no longer works.
14. **Sync unchanged:** `POST /api/doctor/sync` from mobile still works without doctor Bearer auth.
15. **Legacy login:** `POST /api/doctor/login` returns deprecated markers; does not bypass secured routes.
