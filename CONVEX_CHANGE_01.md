# Convex change 01 — doctor snapshot persistence

## What was changed

- Added a **Convex app** at repo root (`convex/`) with one table and doctor-related **queries/mutations** that mirror the previous in-memory doctor snapshot behavior.
- Updated **`artifacts/api-server/internal/routes/doctor.ts`** to read/write that data through **`ConvexHttpClient`** when environment variables are set; otherwise it keeps the **legacy in-memory `Map`s** and DEMO seed (unchanged local behavior).
- Added a small **`artifacts/api-server/internal/convex-doctor.ts`** helper for URL/secret checks and client construction.
- Committed hand-maintained **`convex/_generated/*`** stubs so the repo typechecks and builds **before** you run `npx convex dev` / `npx convex codegen` against a real deployment (you can regenerate these after linking a project).

## Exact files changed / added

| Path | Role |
|------|------|
| `convex/schema.ts` | **New** — `doctorPortalState` table + index |
| `convex/doctor.ts` | **New** — `getState`, `upsertFromSync`, `appendMessage`, `seedDemo` |
| `convex/tsconfig.json` | **New** — Convex TS config |
| `convex/_generated/api.js`, `api.d.ts`, `server.js`, `server.d.ts`, `dataModel.d.ts` | **New** — API stubs / types |
| `artifacts/api-server/internal/convex-doctor.ts` | **New** — Convex HTTP client helpers |
| `artifacts/api-server/internal/routes/doctor.ts` | **Updated** — Convex vs memory branches |
| `artifacts/api-server/.env.example` | **New** — Convex env hints |
| `artifacts/api-server/package.json` | **Updated** — `convex` dependency (via workspace install) |
| `package.json` (root) | **Updated** — `convex` devDependency, `@types/node`, `convex:dev` / `convex:deploy` scripts |
| `CONVEX_CHANGE_01.md` | **New** — this document |

## Convex schema / tables

### `doctorPortalState`

- **Purpose:** One document per uppercase `accessCode`. Holds the doctor-portal payload: optional full patient fields after mobile sync, plus a **messages** array. Matches the former split between `patientStore` and `messagesStore` in a **single** document (messages can exist before first full sync, same as before).
- **Fields:** `accessCode`, `messages`, optional `profile`, `glucoseReadings`, `insulinLog`, `foodLog`, `alertPreferences`, `syncedAt`.
- **Index:** `by_accessCode` on `accessCode`.
- **Functions:**
  - `doctor.getState` (query) — load row by code (requires server secret).
  - `doctor.upsertFromSync` (mutation) — replace row from mobile sync payload (requires server secret).
  - `doctor.appendMessage` (mutation) — append one message; creates row with messages-only if needed (requires server secret).
  - `doctor.seedDemo` (mutation) — idempotent insert for `DEMO` demo data (requires server secret).

## Environment variables and setup

### 1. Convex project

1. From repo root: `pnpm install` (if needed).
2. Run `pnpm run convex:dev` (or `npx convex dev`) and link/create a Convex project.
3. Deploy functions: `pnpm run convex:deploy` when ready.

### 2. Convex dashboard

Add **environment variable** (Settings → Environment Variables):

- **`CONVEX_DOCTOR_INGEST_SECRET`** — long random string (same value you use on the API server).

### 3. API server (local / Vercel)

Set:

| Variable | Description |
|----------|-------------|
| **`CONVEX_URL`** | Deployment URL, e.g. `https://your-name.convex.cloud` |
| **`CONVEX_DOCTOR_INGEST_SECRET`** | Must match the Convex dashboard value exactly |

If **either** is missing or empty, the API server uses **in-memory Maps** (previous behavior) and does not call Convex.

## Behavior intentionally preserved

- HTTP paths unchanged: `/api/doctor/login`, `/api/doctor/sync`, `/api/doctor/patient/:accessCode`, `/api/doctor/messages/:accessCode` (GET/POST).
- **Message merge on sync:** incoming message IDs replace overlapping server copies; server-only messages are kept; result sorted by timestamp (same algorithm as before).
- **POST /messages:** append message; if a full patient row exists, messages stay attached to that row (Convex `appendMessage` updates the full document).
- **GET /patient:** 404 when there is no synced patient (`profile` absent), including “messages-only” rows (same as before: no `patientStore` entry).
- **DEMO patient:** still available; with Convex, **`seedDemo`** runs once at API process startup (best-effort); demo glucose points remain **randomized** per seed invocation (same as the old in-memory generator).
- **Mobile and doctor portal:** no code changes in this change set.

## Caveats / temporary limitations

- **Public Convex functions + shared secret:** Queries/mutations are **public** in Convex; protection is the **`CONVEX_DOCTOR_INGEST_SECRET`** argument checked inside functions. Use a **long, random** secret. Traffic should go through your API in normal use; direct calls to Convex with the secret would bypass Express.
- **Regenerating `_generated`:** After `npx convex dev` / `npx convex codegen` with a linked deployment, generated files may differ; commit updates if your team relies on codegen.
- **Dual mode:** Forgetting to set Convex env on production silently falls back to **ephemeral** in-memory storage (cold starts lose data). Prefer setting Convex env on deployed API servers once Convex is live.

## Manual verification checklist

1. **Convex:** Deploy succeeds; dashboard shows `doctorPortalState` table after first mutation.
2. **API with Convex env:** `POST /api/doctor/sync` with a real patient payload, then `GET /api/doctor/patient/:code` returns the same shape as before (no `_id` in JSON).
3. **Persistence:** Restart API (or wait for serverless cold start); patient data for that code **still** loads from Convex.
4. **Messages:** POST a doctor message, confirm GET `/messages` and GET `/patient` show merged messages.
5. **DEMO:** Log into doctor portal with `DEMO` after API restart; demo data still appears when Convex seed ran successfully.
6. **Fallback:** Unset `CONVEX_URL`; confirm API still runs and DEMO works from in-memory path (local dev without Convex).
