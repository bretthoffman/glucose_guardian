# Doctor portal accounts migration — change 01 (Phase 2 frontend)

Phase 2 migrates the standalone doctor portal from deprecated **code-only login** to **doctor account auth** with **linked patients** and **Bearer token** access to patient/message routes.

Backend reference: `DOCTOR_ACCOUNTS_LINKED_PATIENTS_CHANGE_01.md` in the Gluco-Guardian monorepo.

## What changed (frontend)

### Auth & session

- Added `AuthProvider` (`src/context/auth-context.tsx`) for signed-in doctor state.
- Login/register use `POST /api/doctor/auth/login` and `POST /api/doctor/auth/register` with client-side `passwordHash` (same algorithm as patient/mobile auth).
- Successful login stores:
  - `gg_doc_token` — Bearer token
  - `gg_doc_expires_at` — session expiry (ms epoch)
  - `gg_doc_doctor` — cached `DoctorProfile` JSON
- Logout calls `POST /api/doctor/auth/logout` then clears session storage and redirects to `/login`.
- `customFetch` injects `Authorization: Bearer <token>` on all API requests when a token is present.

### Navigation & UX

| Route | Purpose |
|-------|---------|
| `/login` | Sign in / create account |
| `/` | Linked patient list + link-by-code form |
| `/patient/:accessCode/:tab` | Patient detail (overview, chart, insulin, messages) |

Legacy `/dashboard/*` URLs redirect to `/`.

### API client

Copied/regenerated from monorepo OpenAPI output:

- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`

New hooks used by the portal:

- `useDoctorAuthRegister`, `useDoctorAuthLogin`, `useDoctorAuthLogout`
- `useGetDoctorMe`, `useListDoctorLinkedPatients`, `useLinkDoctorPatient`
- Existing `useGetPatientData`, `useGetDoctorMessages`, `useSendDoctorMessage` (now authenticated)

## Old flow removed

| Before | After |
|--------|-------|
| `POST /api/doctor/login` via `useDoctorLogin` | `useDoctorAuthLogin` |
| `sessionStorage.gg_doc_access_code` as login credential | `sessionStorage.gg_doc_token` Bearer token |
| `sessionStorage.gg_doc_patient_name` | Doctor profile + per-patient `displayName` from linked list |
| Single-patient dashboard at `/dashboard/:tab` | Patient list at `/`, detail at `/patient/:code/:tab` |
| Unauthenticated patient/message fetches | All patient/message calls send Bearer auth |

The deprecated `useDoctorLogin` hook remains in generated client code only; the portal UI no longer uses it.

## Token auth in the portal

1. Doctor signs in → API returns `{ token, expiresAt, doctor }`.
2. Token is saved in `sessionStorage` and registered with `setAuthTokenGetter()`.
3. Every `customFetch` request adds `Authorization: Bearer <token>` when a token exists.
4. Secured routes (`/api/doctor/me/*`, `/api/doctor/patient/*`, `/api/doctor/messages/*`) require this header.
5. On logout, the server revokes the session and local storage is cleared.

## Linked patients

- Loaded via `GET /api/doctor/me/patients` on the home page (`/`).
- Each card shows `displayName`, `accessCode`, `hasData`, and `syncedAt` when available.
- Patients with `hasData: false` show a **Pending sync** state; doctors can still open the detail view (empty/waiting UI until mobile sync).

## Patient linking

- Form on `/` submits `POST /api/doctor/me/patients/link` with `{ accessCode }`.
- Access codes are normalized client-side (uppercase alphanumeric, max 6 chars).
- Success feedback distinguishes linked-with-data vs linked-pending-sync.
- List refetches after a successful link.

## Patient detail

- Clicking a patient navigates to `/patient/:accessCode/overview`.
- Data loads through authenticated routes:
  - `GET /api/doctor/patient/:accessCode`
  - `GET /api/doctor/messages/:accessCode`
  - `POST /api/doctor/messages/:accessCode`
- Existing panels (`OverviewPanel`, `ChartPanel`, `InsulinPanel`, `MessagesPanel`) are reused.

## Environment / API requirements

See `.env.example` for the full template. No secrets belong in the repo.

| Variable | When | Purpose |
|----------|------|---------|
| `VITE_API_BASE_URL` | **Vercel production** | Public API origin. Example: `https://glucose-guardian-ashen.vercel.app`. Requests go to `${VITE_API_BASE_URL}/api/doctor/...` |
| `VITE_API_PROXY_TARGET` | **Local dev only** | When `VITE_API_BASE_URL` is unset, `pnpm dev` proxies `/api/*` here (default `http://localhost:3000`) |
| `PORT` | Optional | Vite dev server port (default `5173`) |
| `BASE_PATH` | Optional | Vite `base` path (default `/`) |

**Vercel doctor-portal project:** set `VITE_API_BASE_URL` under Environment Variables (Production + Preview). Rebuild after changing.

**Backend must have Phase 1 deployed** with `CONVEX_URL` + `CONVEX_DOCTOR_API_SECRET` configured. Without that, auth routes return 503 and secured patient routes are denied.

No Convex client or backend secrets are added to this repo.

## Vercel SPA routing

`vercel.json` configures:

- `outputDirectory`: `dist/public` (Vite build output)
- **SPA rewrite**: non-file routes (`/login`, `/patient/:code/:tab`, etc.) serve `index.html` so direct URL loads work. Static assets (`/assets/*`, `/favicon.svg`, `/images/*`) are still served from the build output first.

## Manual test checklist

1. **Register** — Create account with email, password, display name → lands on patient list.
2. **Login** — Sign out, sign back in → session restored from token.
3. **Me** — Doctor name/institution shown in header (from `/api/doctor/me`).
4. **Link invalid code** — Error message shown.
5. **Link valid code** — Success message; patient appears in list.
6. **Pending patient** — `hasData: false` badge; detail view shows waiting-for-sync state.
7. **Synced patient** — Overview/chart/insulin load; data refreshes every 30s.
8. **Messages** — Load and send message with Bearer auth.
9. **Unauthorized** — Clear token manually → patient fetch returns 401 and redirects to login.
10. **Logout** — Token cleared; `/api/doctor/me` fails with old token.
11. **Legacy URLs** — `/dashboard/overview` redirects to `/`.

## Caveats / follow-up

- **Unlink UI** — `DELETE /api/doctor/me/patients/:accessCode` is in the API client but not exposed in the portal yet.
- **Token expiry** — Expired tokens are cleared on app load; mid-session 401 handling could be improved (auto-logout).
- **Password reset** — Not implemented in Phase 1 backend or this portal pass.
- **Register then login** — Registration auto-signs in; if login fails after register, user is prompted to sign in manually.
