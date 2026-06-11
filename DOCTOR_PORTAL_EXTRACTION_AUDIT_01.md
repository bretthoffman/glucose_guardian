# Doctor Portal Extraction Audit (01)

**Date:** 2026-06-11  
**Scope:** Read-only audit of `artifacts/doctor-portal` for standalone repo extraction. No extraction changes were made.

> **Update:** The embedded app was removed from this monorepo. The standalone copy lives in `_doctor-portal-standalone/`. See `artifacts/doctor-portal/README.md`.

---

## Executive summary

The doctor portal is a **self-contained Vite + React SPA** with almost all UI code inside `artifacts/doctor-portal/`. It has **one real monorepo coupling**: the workspace package `@workspace/api-client-react` (`lib/api-client-react/`). It does **not** import Convex, the API server, or other shared libs directly.

Extraction is **moderate difficulty**: copying the portal folder plus `lib/api-client-react` and inlining/replacing workspace tooling (`tsconfig.base.json`, pnpm catalog pins) is straightforward. The main risks are **runtime API routing** (all fetches use relative `/api/...` paths with no configurable base URL) and **OpenAPI/codegen drift** if the API client is not kept in sync with `lib/api-spec/openapi.yaml`.

**Verdict:** **Moderate** — structurally easy to split; deployment and API contract coupling need explicit decisions.

| Item | Value |
|------|--------|
| **Portal root** | `artifacts/doctor-portal/` |
| **Must move with portal** | `lib/api-client-react/`, `tsconfig.base.json` (or inline), pnpm catalog resolution (or pin versions) |
| **Stays external (HTTP)** | `artifacts/api-server/` (`/api/doctor/*`), Convex (via API server only) |
| **Build status today** | `pnpm --filter @workspace/doctor-portal run build` ✅ succeeds |
| **Typecheck status today** | `pnpm --filter @workspace/doctor-portal run typecheck` ❌ 2 pre-existing TS errors in query options |

---

## 1. Doctor portal app root

**Exact root path:** `artifacts/doctor-portal/`

| Role | Path |
|------|------|
| Package name | `@workspace/doctor-portal` |
| Entry HTML | `index.html` |
| App entry | `src/main.tsx` → `src/App.tsx` |
| Build config | `vite.config.ts` |
| TypeScript | `tsconfig.json` |
| Build output | `dist/public/` |
| Static assets | `public/` (currently only `favicon.svg`) |
| UI kit | `src/components/ui/` (shadcn/Radix) |
| Feature code | `src/pages/`, `src/components/panels/`, `src/hooks/`, `src/lib/` |

**~77 source/config files** under the portal root (excluding `node_modules/`, `dist/`).

---

## 2. Files and folders outside the portal folder that the portal depends on

### Required at build/runtime

| Path | Why |
|------|-----|
| `lib/api-client-react/` | Only workspace package imported by portal source. Provides React Query hooks, types, and `customFetch`. |
| `tsconfig.base.json` | Extended by `artifacts/doctor-portal/tsconfig.json` and `lib/api-client-react/tsconfig.json`. |
| `pnpm-workspace.yaml` (catalog section) | Portal `package.json` uses `"catalog:"` version pins for ~15 deps. Without workspace catalog, installs fail unless versions are pinned explicitly. |
| Root `pnpm-lock.yaml` | Lockfile for reproducible installs when staying on pnpm workspaces. |

### Referenced in config but not used in source imports

| Path | Why |
|------|-----|
| `attached_assets/` | Vite alias `@assets` in `vite.config.ts` points here. **No `@assets` imports exist in portal source.** Safe to drop on extraction. |
| Root `package.json` | `pnpm dev` at monorepo root runs doctor portal via filter. Not a runtime dependency. |
| `artifacts/doctor-portal/.replit-artifact/artifact.toml` | Replit deploy config with monorepo-relative paths (`artifacts/doctor-portal/dist/public`, `pnpm --filter ...`). Must be rewritten for standalone layout. |

### Optional (codegen / contract sync only)

| Path | Why |
|------|-----|
| `lib/api-spec/openapi.yaml` | OpenAPI source for Orval codegen. |
| `lib/api-spec/orval.config.ts` | Generates into `lib/api-client-react/src/generated/`. |
| `lib/api-spec/package.json` | Runs `orval --config ./orval.config.ts`. |

### Not required by the portal

| Path | Notes |
|------|-------|
| `convex/` | Portal never imports Convex. API server calls Convex for doctor persistence. |
| `artifacts/api-server/` | Backend for `/api/doctor/*`. Consumed over HTTP only. |
| `lib/api-zod/` | Generated from same OpenAPI; used by API server, not portal. |
| `lib/db/` | Not referenced. |
| `lib/integrations-*` | Not referenced. |
| `scripts/` | Not referenced. |
| `artifacts/mobile/` | Syncs data *to* the API; no code import from portal. |

---

## 3. All imports from outside the doctor portal folder

### Source-code imports (TypeScript/TSX)

Only **`@workspace/api-client-react`** crosses the portal boundary:

| File | Import |
|------|--------|
| `src/pages/login.tsx` | `useDoctorLogin` |
| `src/pages/dashboard.tsx` | `useGetPatientData` |
| `src/components/panels/MessagesPanel.tsx` | `useGetDoctorMessages`, `useSendDoctorMessage` |
| `src/components/panels/OverviewPanel.tsx` | `type PatientSnapshot` |
| `src/components/panels/ChartPanel.tsx` | `type PatientSnapshot` |
| `src/components/panels/InsulinPanel.tsx` | `type PatientSnapshot` |

All other imports are npm packages (`react`, `wouter`, `lucide-react`, `recharts`, Radix, etc.) or internal `@/*` aliases within `src/`.

### Config-level references outside the folder

| File | Reference |
|------|-----------|
| `tsconfig.json` | `"extends": "../../tsconfig.base.json"` |
| `tsconfig.json` | Project reference `"path": "../../lib/api-client-react"` |
| `package.json` | `"@workspace/api-client-react": "workspace:*"` |
| `vite.config.ts` | `@assets` → `../../attached_assets` |
| `vite.config.ts` | Replit cartographer `root: path.resolve(..., "..")` (parent = `artifacts/`, not repo root) |

**No relative imports** like `../../lib/...` or `../../convex/...` in portal source.

---

## 4. Shared packages, libs, types, configs, scripts, env

### Shared packages

| Package | Used by portal? | Notes |
|---------|-----------------|-------|
| `@workspace/api-client-react` | **Yes** | Required. Monolithic Orval output includes all API endpoints; portal uses 4 doctor hooks + `PatientSnapshot` type. |
| `@workspace/api-spec` | No (codegen only) | Needed only to regenerate the client. |
| `@workspace/api-zod` | No | |
| `@workspace/db` | No | |

### Types

Doctor-related types live in `lib/api-client-react/src/generated/api.schemas.ts`:

- `DoctorLoginRequest`, `DoctorLoginResponse`
- `DoctorMessage`, `DoctorMessagesResponse`, `SendMessageRequest`
- `PatientSnapshot`, `PatientProfile`, `CGMReading`, `InsulinLogEntry`, `FoodLogEntry`, etc.

Portal panels type against `PatientSnapshot` only.

### Config files the portal relies on

| Config | Location | Coupling |
|--------|----------|----------|
| `tsconfig.base.json` | Repo root | Strict TS defaults + `"customConditions": ["workspace"]` |
| `pnpm-workspace.yaml` | Repo root | Workspace membership + dependency catalog |
| `components.json` | Portal root | shadcn aliases (self-contained) |
| `vite.config.ts` | Portal root | `PORT`, `BASE_PATH`, Replit plugins, `@` alias |
| `.replit-artifact/artifact.toml` | Portal root | Monorepo deploy paths |
| `.vercel/project.json` | Portal root (gitignored) | Linked Vercel project metadata |

### Scripts

Portal defines its own scripts in `package.json`:

```json
"dev": "vite --config vite.config.ts --host 0.0.0.0",
"build": "vite build --config vite.config.ts",
"serve": "vite preview --config vite.config.ts --host 0.0.0.0",
"typecheck": "tsc -p tsconfig.json --noEmit"
```

Monorepo root `package.json` `"dev"` script is a convenience wrapper targeting `@workspace/doctor-portal` only.

### Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `PORT` | `vite.config.ts` | Dev/preview server port (default `5173`) |
| `BASE_PATH` | `vite.config.ts` | Vite `base` (default `/`; Replit uses `/doctor-portal/`) |
| `NODE_ENV` | `vite.config.ts` | Gates Replit-only Vite plugins |
| `REPL_ID` | `vite.config.ts` | Enables Replit cartographer + dev banner |
| `import.meta.env.BASE_URL` | `App.tsx`, `login.tsx` | Vite-injected base for router and static image path |

**No `VITE_*` API URL variable exists.** The generated client hardcodes relative paths (`/api/doctor/...`).

`.env.local` exists locally (gitignored) with Vercel CLI OIDC token — not used by app runtime.

---

## 5. Dependency checklist

| Dependency | Portal depends? | Details |
|------------|-----------------|---------|
| **Root `package.json`** | Indirectly | Workspace scripts and root `typescript`/`prettier`/`convex` devDeps. Portal does not import root package; standalone repo needs its own root `package.json` with `typescript` if typechecking. |
| **pnpm workspace config** | **Yes** | Portal is workspace member via `artifacts/*`. Uses `workspace:*` for api-client and `catalog:` for many deps. |
| **tsconfig base** | **Yes** | `extends ../../tsconfig.base.json` |
| **Shared lib packages** | **Yes — one** | `@workspace/api-client-react` only |
| **Convex code** | **No (direct)** | Backend concern. API server → `convex/doctor.ts` when `CONVEX_URL` + `CONVEX_DOCTOR_INGEST_SECRET` set. |
| **API client code** | **Yes** | `lib/api-client-react/` |
| **Vercel config** | Partial | No `vercel.json` in portal. `.vercel/project.json` links to project `glucose-guardian-doctor-portal`. Static SPA needs `/* → /index.html` rewrite (Replit artifact.toml has this; Vercel project may configure separately). |
| **Env vars** | Minimal | `PORT`, `BASE_PATH`, Replit vars. **Missing: API base URL for cross-origin deploy.** |

---

## 6. What must be copied for standalone build and run

### Minimum viable standalone repo

```
doctor-portal-standalone/
├── package.json              # root: workspace or single-package
├── pnpm-workspace.yaml       # if keeping api-client as packages/api-client-react
├── pnpm-lock.yaml            # regenerated after layout change
├── tsconfig.base.json        # copy from monorepo root (or inline into tsconfigs)
├── packages/
│   └── api-client-react/     # copy lib/api-client-react/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── custom-fetch.ts
│           ├── index.ts
│           └── generated/
└── apps/doctor-portal/       # copy artifacts/doctor-portal/ (or flatten to repo root)
    ├── package.json          # update paths + replace catalog: with pinned versions
    ├── tsconfig.json         # fix extends/reference paths
    ├── vite.config.ts        # remove @assets alias; fix cartographer root if kept
    ├── src/
    ├── public/
    │   ├── favicon.svg
    │   └── images/login-bg.png   # MISSING in monorepo — add or remove reference
    └── ...
```

### Copy checklist

- [ ] Entire `artifacts/doctor-portal/` (exclude `node_modules/`, `dist/`, `.env*.local`, `.vercel/`)
- [ ] Entire `lib/api-client-react/src/` (+ `package.json`, `tsconfig.json`)
- [ ] `tsconfig.base.json` (or merge settings into local tsconfigs)
- [ ] Resolve `catalog:` deps → explicit semver in `package.json`
- [ ] Add `public/images/login-bg.png` or update `login.tsx` to not require it
- [ ] Add `.env.example` documenting `PORT`, `BASE_PATH`, and **proposed** `VITE_API_BASE_URL`
- [ ] Add `vercel.json` (or equivalent) for SPA fallback routing

### Recommended (contract maintenance)

- [ ] `lib/api-spec/openapi.yaml` + `orval.config.ts` (adjust output paths)
- [ ] Script: `pnpm codegen` to regenerate api-client after API changes

### Do not copy

- `convex/`, `artifacts/api-server/`, `artifacts/mobile/`, `lib/api-zod/`, `lib/db/`, `attached_assets/`
- Monorepo root `package.json` convex scripts
- `artifacts/doctor-portal/.replit-artifact/artifact.toml` without path rewrites

---

## 7. What can remain external (URL / remote access)

These stay in the Gluco-Guardian monorepo (or their deployed URLs) and are accessed over HTTP:

| Service | Endpoints used by portal | Monorepo location |
|---------|--------------------------|-------------------|
| **API server** | `POST /api/doctor/login` | `artifacts/api-server/internal/routes/doctor.ts` |
| | `GET /api/doctor/patient/:accessCode` | |
| | `GET /api/doctor/messages/:accessCode` | |
| | `POST /api/doctor/messages/:accessCode` | |
| **Convex** (via API) | Doctor state persistence | `convex/doctor.ts`, table `doctorPortalState` |
| **Mobile app** | Syncs patient data to API | `artifacts/mobile/` — no portal import |
| **Google Fonts** | CSS `@import` / `<link>` | CDN URLs in `index.html` and `index.css` |

OpenAPI contract (`lib/api-spec/openapi.yaml`) can remain in the monorepo if the standalone repo vendors a snapshot of the generated client and regenerates only when the API changes (CI or manual).

---

## 8. Risky hidden couplings

### High impact

1. **Same-origin `/api` assumption**  
   Generated URLs are `/api/doctor/login`, `/api/doctor/patient/:code`, etc. (`lib/api-client-react/src/generated/api.ts`). Browser `fetch` resolves against the **portal origin**.  
   - Works when API is reverse-proxied on the same host (Replit path routing, some Vercel setups).  
   - **Breaks** when portal is on `doctor.example.com` and API on `api.example.com` unless you add a configurable base URL (Vite proxy in dev, env var in prod, or Vercel rewrites to external API).

2. **No dev API proxy in Vite**  
   `vite.config.ts` has no `server.proxy`. Local portal dev on `:5173` will call `:5173/api/...` unless API runs behind same origin or you add proxy config.

3. **Monolithic API client**  
   `@workspace/api-client-react` includes mobile/patient endpoints the portal never uses. Extraction copies dead code unless you split Orval output or publish a doctor-only package.

### Medium impact

4. **pnpm `catalog:` pins**  
   Standalone `package.json` cannot resolve `"vite": "catalog:"` without a workspace catalog. Must pin versions explicitly.

5. **`tsconfig.base.json` + project references**  
   Paths break if folder layout changes without updating `extends` and `references`.

6. **OpenAPI drift**  
   If API schemas change in monorepo but standalone client is not regenerated, runtime/type mismatches appear silently.

7. **Missing login background asset**  
   `login.tsx` references `${import.meta.env.BASE_URL}images/login-bg.png` but `public/images/login-bg.png` does not exist in the repo (only documented in `requirements.yaml`). Broken image in production (non-fatal).

8. **Replit cartographer root**  
   Points at `artifacts/` parent, not repo root — wrong scope after extraction.

### Low impact

9. **Pre-existing typecheck failures**  
   `dashboard.tsx` and `MessagesPanel.tsx` pass partial React Query options missing `queryKey` (strict TS). Build still succeeds via Vite/esbuild.

10. **Root `pnpm dev` script**  
    Monorepo default dev command runs doctor portal only — coworkers may not realize other apps exist. Extraction clarifies ownership.

11. **Vercel project linkage**  
    `.vercel/project.json` is local/gitignored. New repo needs `vercel link` or fresh project.

12. **Session auth only**  
    `sessionStorage` keys `gg_doc_access_code` / `gg_doc_patient_name` — no server session. Expected behavior, not a monorepo coupling.

---

## 9. Recommended extraction plan (minimal disruption)

### Phase 0 — Decisions (before moving files)

1. **Deployment model:** same-origin API proxy vs cross-origin API with `VITE_API_BASE_URL` (recommended for standalone Vercel + separate API deploy).
2. **API client strategy:**  
   - **Option A (fastest):** Copy `lib/api-client-react` as-is into standalone repo.  
   - **Option B (cleaner):** Orval filter/tag to generate doctor-only client; smaller bundle, less drift surface.
3. **Repo layout:** small pnpm workspace (`apps/portal` + `packages/api-client-react`) vs single package with vendored `src/api/`.

### Phase 1 — Scaffold standalone repo (no monorepo deletion yet)

1. Create new repo with copied portal + `api-client-react` + `tsconfig.base.json`.
2. Replace all `catalog:` entries with pinned versions from `pnpm-workspace.yaml`.
3. Update `tsconfig.json` paths; remove unused `@assets` alias from `vite.config.ts`.
4. Add `VITE_API_BASE_URL` support in `custom-fetch.ts` (prefix relative URLs when set).
5. Add Vite dev proxy: `/api` → local API server URL.
6. Add `public/images/login-bg.png` or remove background `<img>`.
7. Add root `README.md` with `pnpm install`, `pnpm dev`, `pnpm build`, env vars.
8. Add `vercel.json` SPA rewrite + document API URL env for production.
9. Verify: `pnpm build`, manual login against staging API.

### Phase 2 — Wire CI and contract sync

1. Copy or submodule `lib/api-spec/openapi.yaml`; add `pnpm codegen` script.
2. Optional: CI job diff-checks generated client vs OpenAPI on API PRs in monorepo.

### Phase 3 — Cut over monorepo

1. Remove `artifacts/doctor-portal/` from monorepo (or replace with README pointer to new repo).
2. Remove `@workspace/doctor-portal` from `pnpm-workspace.yaml` and root `dev` script.
3. Update Replit/Vercel deploy configs in respective repos.
4. Grant coworker access to standalone repo only.

### Phase 4 — Optional hardening

1. Fix React Query `queryKey` typecheck errors.
2. Split doctor-only Orval output to shrink bundle (~770 KB JS today).
3. Add `.env.example` and document `DEMO` access code behavior (API seeds demo via Convex).

---

## API surface reference (portal consumption)

| Hook / type | HTTP | Used in |
|-------------|------|---------|
| `useDoctorLogin` | `POST /api/doctor/login` | `login.tsx` |
| `useGetPatientData` | `GET /api/doctor/patient/:accessCode` | `dashboard.tsx` (30s poll) |
| `useGetDoctorMessages` | `GET /api/doctor/messages/:accessCode` | `MessagesPanel.tsx` (10s poll) |
| `useSendDoctorMessage` | `POST /api/doctor/messages/:accessCode` | `MessagesPanel.tsx` |
| `PatientSnapshot` | (response type) | Overview, Chart, Insulin panels |

Backend implementation: `artifacts/api-server/internal/routes/doctor.ts` → optional Convex via `artifacts/api-server/internal/convex-doctor.ts` → `convex/doctor.ts`.

---

## Suggested standalone environment template

```bash
# Dev server
PORT=5173
BASE_PATH=/

# API (recommended addition — not in monorepo today)
VITE_API_BASE_URL=http://localhost:3000   # or empty for same-origin /api

# Replit-only (omit elsewhere)
# REPL_ID=...
```

Production API server (stays in monorepo deploy): `CONVEX_URL`, `CONVEX_DOCTOR_INGEST_SECRET` — **not needed in portal repo**.

---

## Files inventory: portal-internal vs external

### Stays inside portal folder (self-contained)

- All of `src/` including UI kit, pages, hooks, utils
- `index.html`, `vite.config.ts`, `components.json`, `requirements.yaml`
- `public/favicon.svg`

### Must accompany portal in new repo

- `lib/api-client-react/` (entire package)
- `tsconfig.base.json` (or inlined equivalent)

### Optional but strongly recommended

- `lib/api-spec/openapi.yaml` + Orval config for regeneration

### Remains in Gluco-Guardian monorepo

- `artifacts/api-server/`
- `convex/`
- `artifacts/mobile/`
- All other `lib/*` packages

---

## Next steps (recommended order)

1. Decide API base URL strategy (same-origin proxy vs `VITE_API_BASE_URL`).
2. Scaffold standalone repo with portal + `api-client-react` + pinned deps.
3. Add dev proxy and production env for API URL; verify against running API server.
4. Add missing `login-bg.png` or remove reference.
5. Document coworker onboarding (clone, install, env, dev, deploy).
6. Remove portal from monorepo only after standalone repo is verified in CI and staging.
