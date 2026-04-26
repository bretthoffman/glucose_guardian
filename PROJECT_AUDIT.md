# Glucose Guardian — Engineering Audit (`PROJECT_AUDIT.md`)

**Scope:** This document is derived from inspection of the repository as it exists today (file contents, imports, configs). Claims labeled **inferred** are reasonable product interpretations from UX copy and flows, not confirmed product requirements.

---

## 1. Executive Summary

### What this project is

**Glucose Guardian** (also branded **Gluco Guardian** in the doctor portal UI) is a **pnpm monorepo** with three deployable application surfaces plus shared libraries:

| Surface | Role |
|--------|------|
| **`artifacts/mobile`** | Patient/caregiver **Expo** app (iOS/Android + **web export**): CGM connection (Dexcom / Libre), glucose display, insulin/food logging, AI chat companion, notifications, doctor/caregiver access codes. |
| **`artifacts/doctor-portal`** | **Vite + React** web app for clinicians: access code login, polling patient snapshots, charts, messaging UI. |
| **`artifacts/api-server`** | **Express 5** HTTP API: Dexcom/Libre proxying, glucose/insulin/food helpers, OpenAI-backed chat & food estimation, in-memory doctor sync store. |

### Product direction (inferred)

The codebase targets a **pediatric-forward diabetes companion**: parent/caregiver modes, child-friendly AI tone branches, Dexcom Share–style integration, and a separate doctor portal with messaging and “sync” semantics.

### Overall stack (observed)

- **Package manager:** `pnpm` workspaces (`pnpm-workspace.yaml`); root `npm run dev` is wired to delegate to `pnpm` and start the doctor portal.
- **Language:** TypeScript across apps/libs; **esbuild** bundles the API for serverless; **Orval** generates `@workspace/api-client-react` from OpenAPI.
- **Persistence:** **No PostgreSQL usage in application runtime** despite `lib/db` (Drizzle + `pg`) existing; API state for doctor sync and glucose history is **in-memory** in process. Mobile uses **AsyncStorage**.
- **AI:** OpenAI client (`openai` npm package) in `chat` and `food` routes, with Replit-style env names (`AI_INTEGRATIONS_OPENAI_*`).
- **Deployment signals:** Vercel-oriented `vercel.json` files under `artifacts/api-server` and `artifacts/mobile`; `artifacts/api-server/VERCEL.md` documents the Express → serverless bridge; Replit plugins and env vars appear in doctor portal and mobile.

### Maturity assessment

| Area | Assessment |
|------|----------------|
| **Patient app (mobile)** | Substantial UI and flows; native notifications guarded for web; **split-host API** partially applied (`apiUrl` helper) but **doctor sync** still uses legacy base URL logic. |
| **API** | Functional for demos and integrations; **not production-grade** for PHI (in-memory data, no real auth, credentials logged in Dexcom errors path). |
| **Doctor portal** | Polished UI; depends on **same-origin `/api`** or deployment pairing with the API host. |
| **Shared DB layer** | **Scaffold only** — `lib/db/src/schema/index.ts` exports nothing; nothing imports `@workspace/db` in TS sources. |
| **Tests & CI** | **No `*.test.*` / `*.spec.*` files** found in the repo snapshot audited. |

---

## 2. Repository / Workspace Structure

### Top-level layout

```
Gluco-Guardian/
├── package.json              # workspace root scripts (dev → doctor-portal)
├── pnpm-workspace.yaml       # globs: artifacts/*, lib/*, lib/integrations/*, scripts
├── tsconfig.base.json        # shared TS strict options
├── artifacts/
│   ├── api-server/           # Express API + Vercel serverless entry
│   ├── doctor-portal/        # Vite React clinician web app
│   ├── mobile/               # Expo Router patient app
│   └── mockup-sandbox/       # separate Vite app (design / sandbox)
├── lib/
│   ├── api-zod/              # Zod schemas/types (API contracts)
│   ├── api-spec/             # OpenAPI + orval codegen driver
×   ├── api-client-react/     # Generated hooks + customFetch (Orval)
│   ├── db/                   # Drizzle + pg (unused at runtime in app code)
│   ├── integrations-openai-ai-server/  # OpenAI helper lib (env-guarded)
│   └── integrations/…        # additional integration packages
└── scripts/                  # minimal workspace scripts package
```

### Monorepo vs multiple repos

This is a **single monorepo** managed by **pnpm workspaces**, not multiple disconnected repos.

### Runtime surfaces ↔ folders

| Folder | Runtime |
|--------|---------|
| `artifacts/api-server` | Node.js (local `tsx ./dev.ts`), Vercel Node serverless (`api/index.js` → `dist/index.cjs`) |
| `artifacts/doctor-portal` | Browser (Vite dev/build) |
| `artifacts/mobile` | Expo (native), static web export (`dist/`) |
| `artifacts/mockup-sandbox` | Browser (Vite) — **unclear from code alone** whether it ships to users |

### Duplication / abandoned paths

- **`@workspace/db`**: present and built as part of `api-server`’s `pnpm run build`, but **no TS import** of `@workspace/db` in the repo — effectively **unused for persistence**.
- **`@workspace/api-client-react`** is a **dependency** of `artifacts/mobile` in `package.json` and a **TS project reference**, but **no source import** under `artifacts/mobile` was found — **dead dependency** for the mobile app today (doctor portal uses it heavily).
- **Branding inconsistency:** “Glucose Guardian” vs “Gluco Guardian” across strings.

### Config files that matter

| File | Why it matters |
|------|----------------|
| `pnpm-workspace.yaml` | Workspace boundaries; extensive `overrides` for optional native binaries (Expo ngrok, esbuild platforms, etc.). |
| `artifacts/api-server/vercel.json` | `outputDirectory: "."`, `functions` for `api/index.js`, catch-all rewrite to `/api`. |
| `artifacts/api-server/build.ts` | esbuild: `dist/index.cjs` (handler), `dist/server.cjs` (local listen). |
| `artifacts/mobile/vercel.json` | `EXPO_PUBLIC_API_BASE_URL` baked for static export; `outputDirectory: "dist"`. |
| `artifacts/doctor-portal/vite.config.ts` | `BASE_PATH`, `PORT`, Replit-only Vite plugins, build output `dist/public`. |
| `lib/db/drizzle.config.ts` | Throws if `DATABASE_URL` missing — relevant only for future schema / `drizzle-kit`. |

---

## 3. Major Application Surfaces

### 3.1 API server (`artifacts/api-server`)

**Purpose:** Central HTTP backend for CGM vendor calls, glucose/insulin/food endpoints, AI chat/vision, and doctor portal data (`/api/doctor/*`).

**Framework / runtime:** Express 5, Node.js, bundled with esbuild to CommonJS (`dist/index.cjs`).

**Entry points:**

- **Local dev:** `dev.ts` → listens (see `package.json` `"dev"`).
- **Vercel:** `api/index.js` loads `../dist/index.cjs` (see comment: avoids Vercel TS re-compile of `internal/`).
- **Express app assembly:** `internal/app.ts` — `GET /`, `app.use("/api", router)` from `internal/routes/index.ts`.

**Route mounting** (`internal/routes/index.ts`):

| Prefix | Module | Notes |
|--------|--------|-------|
| `/api/healthz` | `health.ts` | Zod-validated health |
| `/api/glucose` | `glucose.ts` | In-memory history |
| `/api/insulin` | `insulin.ts` | Formula + `/predict` |
| `/api/food` | `food.ts` | Carb DB + OpenAI image path |
| `/api/cgm` | `cgm.ts` | Dexcom Share + Libre |
| `/api/chat` | `chat.ts` | OpenAI `gpt-5.2` |
| `/api/doctor` | `doctor.ts` | In-memory sync + demo patient `DEMO` |

**How other parts talk to it:**

- **Mobile:** `fetch(apiUrl("/api/..."))` via `artifacts/mobile/utils/api-base-url.ts` when `EXPO_PUBLIC_*` set; base defaults to relative `/api` if unset.
- **Doctor portal:** Generated client uses **relative URLs** like `/api/doctor/login` (`lib/api-client-react/src/generated/api.ts`) — assumes **same host** or reverse proxy unless regenerated with absolute base URL.

**Start commands:**

```bash
pnpm --filter @workspace/api-server dev
pnpm --filter @workspace/api-server run build
```

---

### 3.2 Doctor portal (`artifacts/doctor-portal`)

**Purpose:** Web UI for care team: login with **patient access code**, view synced CGM/insulin/messages, **poll every 30s** (`refetchInterval: 30000` in `src/pages/dashboard.tsx`).

**Framework:** Vite 7, React 19, **Wouter** routing, **TanStack React Query**, Radix-based UI kit under `src/components/ui/`, Tailwind 4 (`@tailwindcss/vite`).

**Entry:** `src/main.tsx` → `src/App.tsx`.

**Routing (`src/App.tsx`):**

- `/` → `Dashboard`
- `/login` → `Login`
- `/dashboard`, `/dashboard/:tab` → `Dashboard`
- fallback → `NotFound`

**Auth model (`src/hooks/use-auth.ts`):** `sessionStorage` keys `gg_doc_access_code`, `gg_doc_patient_name` — **no cookies, no JWT**.

**API integration:** `@workspace/api-client-react` hooks (`useDoctorLogin`, `useGetPatientData`, etc.) → `customFetch` → **relative** `/api/...`.

**Run:**

```bash
pnpm --filter @workspace/doctor-portal dev   # needs PORT (defaults in vite.config) / BASE_PATH
pnpm --filter @workspace/doctor-portal build
```

Root **`npm run dev`** / **`pnpm dev`** at repo root runs doctor portal with `PORT` and `BASE_PATH` defaulted in the root script.

---

### 3.3 Mobile app (`artifacts/mobile`)

**Purpose:** Primary patient experience: auth (local), onboarding, **tabs** for home/chart/chat/food/insulin/dashboard, **CGM setup modal** route, notifications on native.

**Framework:** Expo ~54, **expo-router** (file-based), React Native + **react-native-web**, TanStack Query provider in `app/_layout.tsx`.

**Entry:** `package.json` `"main": "expo-router/entry"`.

**Routing (`app/`):**

- `_layout.tsx` — providers, auth redirects, notification listeners (**skipped on web**).
- `auth.tsx` — sign in / create account / caregiver / doctor entry.
- `onboarding.tsx` — profile setup gate.
- `(tabs)/` — `_layout.tsx` + `index.tsx` (home), `chat.tsx`, `food.tsx`, `insulin.tsx`, `dashboard.tsx`.
- `cgm-setup.tsx` — Dexcom/Libre connect.
- `+not-found.tsx`

**State:**

- **`AuthContext`** — profile, CGM connection, logs, PIN/child mode, doctor/caregiver codes, **AsyncStorage** persistence, trivial client-side “hash” for passwords.
- **`GlucoseContext`** — readings history + I:C / ISF settings in **AsyncStorage**.

**API integration:**

- Screens use **`apiUrl()`** from `utils/api-base-url.ts` for CGM, chat, food, etc.
- **Exception:** `syncToDoctor` in `context/AuthContext.tsx` still builds `apiBase` from `EXPO_PUBLIC_DOMAIN` or **`http://localhost:8080/api`** — **does not use `apiUrl`**. On **split Vercel deploys**, doctor sync from mobile web/production may **miss the real API** unless `EXPO_PUBLIC_DOMAIN` happens to match the API host (it usually will not).

**Run (from package scripts):**

- Replit-oriented: `pnpm --filter @workspace/mobile dev` (uses `REPLIT_*`, `PORT`).
- Web export: `pnpm --filter @workspace/mobile run build:web` → `serve:web`.

---

### 3.4 Mockup sandbox (`artifacts/mockup-sandbox`)

**Purpose:** **Unclear from code** — parallel Vite + React stack without obvious linkage to API or mobile. Treat as **internal design/sandbox** unless product docs say otherwise.

---

### 3.5 Shared libraries (`lib/*`)

| Package | Role |
|---------|------|
| `@workspace/api-zod` | Zod schemas used by Express routes (e.g. `SubmitGlucoseReadingBody`). |
| `@workspace/api-client-react` | Orval-generated React Query client for OpenAPI **`/api/*`** paths. |
| `@workspace/api-spec` | `orval` codegen config (`pnpm run codegen`). |
| `@workspace/db` | Drizzle + PostgreSQL client — **schema empty**, **no app imports**. |

---

## 4. Tech Stack Audit

| Layer | Technology | Evidence |
|-------|------------|----------|
| **Mobile UI** | Expo 54, React Native 0.81, RN Web, expo-router | `artifacts/mobile/package.json` |
| **Web portals** | Vite 7, React 19, Wouter | `doctor-portal`, `mockup-sandbox` |
| **Styling** | Tailwind 4 (+ typography plugin doctor-portal), component primitives (Radix) | `package.json` deps |
| **API** | Express 5, esbuild bundle | `artifacts/api-server` |
| **Validation** | Zod | `@workspace/api-zod`, route handlers |
| **ORM / DB** | Drizzle + `pg` | `lib/db` — **not wired to API handlers** |
| **HTTP client (generated)** | `customFetch` wrapper | `lib/api-client-react/src/custom-fetch.ts` |
| **Server state (web)** | TanStack React Query v5 | doctor portal + mobile root |
| **Forms (doctor)** | react-hook-form, zod | doctor-portal deps |
| **AI** | `openai` SDK, model `gpt-5.2` in chat route | `internal/routes/chat.ts` |
| **Notifications** | expo-notifications | mobile; guarded on web |
| **Build** | esbuild (API), Vite (web), Expo export (mobile) | respective configs |
| **Testing** | *None found* | glob `**/*.{test,spec}.{ts,tsx,js}` → 0 files |
| **Analytics / error tracking** | *Not observed* | no Sentry/DD imports noted in sampled paths |

---

## 5. Environment + Configuration

### 5.1 By subproject

#### `artifacts/api-server`

| Variable | Where used | Required? | Notes |
|----------|------------|-----------|-------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | `internal/routes/chat.ts`, `food.ts` | **Yes** for AI routes | Non-null assertion in code — runtime failure if missing on chat/food AI paths. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Same | Optional proxy | Passed to `OpenAI` client. |
| `NODE_ENV` | esbuild define in `build.ts` | Build | Injected as `"production"` for bundle. |

#### `artifacts/mobile`

| Variable | Where used | Required? | Notes |
|----------|------------|-----------|-------|
| `EXPO_PUBLIC_API_BASE_URL` | `utils/api-base-url.ts`, `vercel.json` | **Recommended** for split deploy | Preferred absolute API origin (no trailing slash normalization in builder). |
| `EXPO_PUBLIC_DOMAIN` | `api-base-url.ts`, `AuthContext.syncToDoctor`, `scripts/build.js` | **Replit / same-origin** legacy | When set without `EXPO_PUBLIC_API_BASE_URL`, `apiUrl` uses `https://${domain}` as API root **inferred** — may or may not match where `/api` is actually served. |
| `EXPO_PUBLIC_REPL_ID` | `package.json` dev script | Dev / Replit | |
| `REPLIT_*`, `PORT` | `package.json` `dev` script | Local/Replit | |
| `BASE_PATH` | `scripts/build.js`, `server/serve.js` | Deploy path | For Replit static serving semantics. |

#### `artifacts/doctor-portal`

| Variable | Where used | Required? | Notes |
|----------|------------|-----------|-------|
| `PORT` | `vite.config.ts` | Dev/preview | Defaults to `5173` if unset — **safe on Vercel build** after recent fix. |
| `BASE_PATH` | `vite.config.ts` | Deploy | Defaults `/`. |
.| `NODE_ENV`, `REPL_ID` | Vite plugins | Dev-only Replit plugins | Cartographer / dev banner gated. |
| `import.env.BASE_URL` | Vite | Build | Used in `App.tsx`, `login.tsx` for router base + assets. |

#### `lib/db`

| Variable | Where used | Required? | Notes |
|----------|------------|-----------|-------|
| `DATABASE_URL` | `lib/db/src/index.ts`, `drizzle.config.ts` | **If importing `db`** | **Throws on import** if missing — currently **no importer**, so root installs don’t execute this at runtime for API. |

#### `lib/integrations-openai-ai-server`

| Variable | Where used | Notes |
|----------|------------|-------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | throws if missing at module init | Separate from api-server routes that use `openai` package directly |

### 5.2 Secrets & external services

- **Dexcom Share** (`share1.dexcom.com` / `shareous1.dexcom.com`) — called from **`cgm.ts`** with hard-coded mobile User-Agent and application ID (observed in code).
- **LibreView API** — `api.libreview.io` in **`cgm.ts`**.
- **OpenAI** — chat + multimodal food estimation.

### 5.3 Fallback behavior (observed)

- Mobile `apiUrl`: empty base → **same-origin** relative `/api` (works only if API is colocated or proxied).
- `syncToDoctor`: if no `EXPO_PUBLIC_DOMAIN`, uses **`http://localhost:8080/api`** — almost certainly **wrong** for production mobile builds unless something proxies there.

---

## 6. Product Behavior / User Flows (code-derived)

### 6.1 Patient mobile — account (observed)

- **`auth.tsx`**: create account or sign in; email + password stored in **AsyncStorage** (`AuthContext`): password “hashed” via trivial hex encoding (`hashPassword` in `AuthContext.tsx`) — **not cryptographically secure**.
- Optional **caregiver** and **doctor** entry paths validate codes against profile-generated codes (local only).

### 6.2 Onboarding (observed)

- **`onboarding.tsx`** + `_layout.tsx` redirect: signed-in users without a stored profile go to onboarding; once `profile` exists, user lands on **`/(tabs)`**.

### 6.3 Dexcom / Libre (observed)

- **`cgm-setup.tsx`**: POST to `/api/cgm/dexcom/connect` or `/api/cgm/libre/connect`; on success saves `sessionId`/`token` via `setCGMConnection`, **navigates to `/(tabs)`** with `router.replace`.

### 6.4 Glucose home (observed)

- **`(tabs)/index.tsx`**: pulls Dexcom readings on a timer / pull-to-refresh via **`/api/cgm/dexcom/readings`** (and Libre equivalents in `cgm.ts`); merges into `GlucoseContext`; schedules local notifications via **`scheduleGlucoseAlert`** on native.
- **`AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000`** — periodic sync (inferred: battery/network tradeoff).

### 6.5 Insulin / food (observed)

- **`(tabs)/insulin.tsx`** — uses API insulin calculator (`/api/insulin`).
- **`(tabs)/food.tsx`** — food carb estimation (`/api/food`).
- Food route uses large static carb dictionary + optional OpenAI path (read more of `food.ts` if extending).

### 6.6 AI chat (observed)

- **`(tabs)/chat.tsx`** posts conversation + rich **context** (child name, glucose, trend, ratios) to **`/api/chat`**; system prompt construction lives in **`internal/routes/chat.ts`** with explicit **safety and tone** rules.

### 6.7 Doctor portal (observed)

- **`login.tsx`**: `useDoctorLogin` → `POST /api/doctor/login`; stores code in **sessionStorage**.
- **`dashboard.tsx`**: `useGetPatientData` polls **`GET /api/doctor/patient/:accessCode`** every 30s.
- Empty state tells user to open mobile app and sync (**inferred** operational model).

### 6.8 Caregiver / clinician from mobile (observed)

- Codes generated in profile (`generateCaregiverCode`, `generateDoctorCode`); doctor mode tracks access log locally.
- **`syncToDoctor`** pushes a JSON snapshot to **`POST /api/doctor/sync`** (see §5 — **base URL risk** on Vercel).

---

## 7. Data Flow + System Architecture

### 7.1 ASCII diagram (logical)

```
┌─────────────────────┐     HTTPS (fetch)      ┌──────────────────────────┐
│  Expo mobile / web  │ ─────────────────────► │  api-server (Express)   │
│  AsyncStorage state │ ◄───────────────────── │  /api/cgm, glucose, ...   │
└──────────┬──────────┘                        └────────────┬─────────────┘
           │                                                   │
           │  syncToDoctor (POST /doctor/sync)                   │ in-memory
           │  *base URL must match deploy*                      ▼
           │                                      ┌─────────────────────────┐
           │                                      │ Map<> patient snapshots │
┌──────────▼──────────┐     fetch /api/doctor/*  │ + demo "DEMO" patient   │
│   Doctor portal     │ ◄──────────────────────► │ (ephemeral per instance)│
│  sessionStorage     │                            └─────────────────────────┘
└─────────────────────┘

External:
  Dexcom Share APIs ────────►  cgm.ts
  LibreView API ───────────►  cgm.ts
  OpenAI ───────────────────►  chat.ts, food.ts
```

### 7.2 Auth flow

- **Mobile:** entirely **client-side** session flags + AsyncStorage — **no server session**.
- **Doctor portal:** **access code** mapped to in-memory store; login returns **`hasData`** even when snapshot missing (`doctor.ts` login handler).

### 7.3 Where data is persisted today

| Data | Storage |
|------|---------|
| Patient profile, logs, CGM session | **Device AsyncStorage** |
| Doctor-visible snapshot | **Server RAM** (`patientStore` in `doctor.ts`) |
| Glucose history API | **Server RAM** (`glucoseHistory` array in `glucose.ts`) |
| PostgreSQL | **Not used** in handlers |

### 7.4 Polling / background

- Doctor portal: **30s** React Query refetch.
- Mobile home: **5 min** auto-sync interval + manual refresh + AppState hooks (see `index.tsx`).

---

## 8. API Audit

### 8.1 Surface area

**Global middleware** (`internal/app.ts`): CORS, JSON body (25mb), urlencoded.

**Health:** `GET /api/healthz`.

**Glucose** (`/api/glucose`): POST `/`, GET `/history`, DELETE `/history` — Zod types from `@workspace/api-zod`.

**Insulin** (`/api/insulin`): POST `/` (standard bolus), POST `/predict` (trend-adjusted).

**Food** (`/api/food`): carb estimation + AI; large embedded dictionary.

**CGM** (`/api/cgm`): Dexcom connect + readings; Libre connect + readings (see full `cgm.ts` beyond line 200 for Libre + any extras).

**Chat** (`/api/chat`): OpenAI completions, **hard dependency** on env key.

**Doctor** (`/api/doctor`):

- `POST /login`, `POST /sync`, `GET /patient/:accessCode`, `GET /messages/:accessCode`, `POST /messages/:accessCode`
- **Seeded demo** patient **`DEMO`** with synthetic CGM data and canned messages.

### 8.2 Auth model (API)

- **No Bearer tokens, no cookies** on these routes in the audited files.
- Doctor routes trust **access codes in body/URL** — suitable only for demo/trusted network.

### 8.3 Security / privacy observations

- **Dexcom:** `console.log` of auth/readings response snippets — **credential/session leakage risk** in production logs.
- **Patient health data** held in **unencrypted server memory** with **no per-user isolation** beyond access code string.
- Mobile password storage: **weak encoding**, not bcrypt/Argon2.

### 8.4 Placeholder / fragility

- **Cold start / multi-instance:** Vercel serverless instances each have **separate memory** — doctor sync **will not** be consistent across invocations without external DB.
- Demo doctor login returns success even when **`hasData` misleading** — check `doctor.ts` login: returns `has !!snapshot` but codes could exist without snapshot in edge cases (rare for normal flow).

---

## 9. Mobile App Audit

| Topic | Finding |
|-------|---------|
| **Framework** | Expo 54 + expo-router 6 |
| **Navigation** | Stack + tabs; modal `cgm-setup` |
| **Auth/session** | Local AsyncStorage; `signOut` clears keys (also caregiver/doctor flags per recent changes — verify in full `AuthContext` for your branch) |
| **API layer** | Ad-hoc `fetch` + `apiUrl()`; **not** using generated `@workspace/api-client-react` despite dependency |
| **Dexcom** | Session ID stored on device; re-auth on 401 from readings |
| **Notifications** | `expo-notifications`; **root layout** guards native-only APIs when **`Platform.OS === "web"`** |
| **Web vs native** | `build:web` static export; **`Alert.alert`** dead on some web flows — **some screens still use only `Alert`** (e.g. CGM validation) — may need same treatment as dashboard sign-out where critical. |
| **Store readiness** | **Inferred:** Expo config present; production would need app store assets, privacy policy, HIPAA posture — **not assessed** from code alone |

---

## 10. Doctor Portal Audit

| Topic | Finding |
|-------|---------|
| **Framework** | Vite + React + Wouter |
| **Pages** | Login, Dashboard (+ tab param), Not found |
| **Auth** | SessionStorage access code — lost on tab close / new browser |
| **Data** | From API polling; charts in `ChartPanel`, etc. |
| **Separation** | Distinct SPA; **must** point `customFetch` base URL to API host if portal and API are on different origins **unless** reverse proxy merges them |
| **Production viability** | UI is production-styled; **backend model is demo-grade** |

---

## 11. Shared Code / Reuse Opportunities

**Already shared:**

- `@workspace/api-zod` — server + codegen types alignment.
- `@workspace/api-client-react` — doctor portal consumption of OpenAPI.

**Duplication / gaps:**

- Mobile reimplements fetch paths instead of using generated client — **opportunity** to unify on Orval + `customFetch` with configurable base URL (or wrap `apiUrl` in one place).
- **Two OpenAI integration styles:** direct `openai` in routes vs `lib/integrations-openai-ai-server` — consolidate if both evolve.

**Suggested package (if scaling):**

- `@workspace/api-base` or env config module consumed by mobile, doctor portal codegen, and scripts.

---

## 12. Deployment / DevOps Audit

| App | Intended hosting (observed) | Fit |
|-----|-----------------------------|-----|
| **api-server** | Vercel serverless (`api/index.js`, rewrites) | Works for **stateless** APIs; **poor fit** for in-memory doctor store / glucose history unless single instance (not true on Vercel). |
| **doctor-portal** | Static Vite build (`dist/public`) | Typical static host; must solve **API base URL** vs same-origin assumption. |
| **mobile web** | Static `expo export` to `dist/` | Good for preview; native remains Expo/EAS **inferred**. |

**Local dev commands (summary):**

```bash
pnpm install
pnpm dev                                    # doctor portal (root)
pnpm --filter @workspace/api-server dev     # API locally
pnpm --filter @workspace/mobile dev         # Expo (needs Replit env for scripted domain)
```

**Likely issues:**

- Doctor portal + API on **different Vercel projects** without env/proxy → **CORS + wrong paths** (API enables `cors()` — browser calls may work **if** absolute URL configured in generated client — **currently not**).
- **`syncToDoctor`** mobile → wrong host in production (see §5).

**Docs in repo:** `artifacts/api-server/VERCEL.md` is **accurate and valuable** for the API deployment shape.

---

## 13. Code Quality + Risk Audit

| Risk | Detail |
|------|--------|
| **PHI / HIPAA** | Health data flows through logs, memory, third-party AI, and device storage — **no** BAA or encryption story in code. |
| **In-memory API state** | Data loss on deploy/restart; inconsistent in serverless. |
| **Weak password handling** | `hashPassword` in mobile `AuthContext.tsx` is obfuscation only. |
| **Logging** | Dexcom responses logged (`cgm.ts`). |
| **AI safety** | Prompt engineering attempts mitigation; still **not** a medical device validation. |
| **Dependency bloat** | `mobile` lists `@workspace/api-client-react` unused — confusing for engineers. |
| **`syncToDoctor` URL** | Hardcoded localhost fallback — **high bug risk** on Vercel web. |
| **No automated tests** | Regressions likely on multi-surface changes. |

---

## 14. Architecture Assessment

**What works well**

- Clear **separation of surfaces** (patient vs clinician vs API).
- **Orval + Zod** move toward contract-driven development.
- **esbuild + `api/index.js`** is a pragmatic Vercel adaptation (documented in `VERCEL.md`).

**What is fragile**

- **Serverless + in-memory state** is an architectural contradiction for doctor sync.
- **Split-deploy URL handling** is inconsistent (`apiUrl` vs `syncToDoctor` vs generated client relative paths).

**What appears missing for a serious product**

- Real **identity provider** / HIPAA-grade storage / audit logging.
- **Postgres** (or other) actually wired to routes.
- **Test pyramid**, staging config, secret management.

---

## 15. Open Product + Engineering Decisions

1. **Persistence:** Will doctor sync and glucose history ever move to **Postgres** (or per-tenant store), and how will **mobile offline** sync work?
2. **Hosting:** Should **stateful** doctor endpoints move off **Vercel serverless** to a long-lived Node service or container?
3. **Auth:** Is **local-only mobile auth** acceptable, or should accounts be **server-backed** (OAuth, Cognito, etc.)?
4. **API client:** Should mobile adopt **`@workspace/api-client-react`** or a shared fetch wrapper with one **base URL** strategy?
5. **Monorepo:** Keep as one repo or split **mobile** vs **web** release cycles?
6. **AI:** Single vendor (OpenAI) vs abstraction? **PHI** allowed to hit model or must use **de-identification**?
7. **Dexcom integration:** Continue **Share REST emulation** vs official partner APIs / regulatory path?
8. **Doctor portal distribution:** **Public web** only, or needs **enterprise SSO**?

---

## 16. Recommended Immediate Next Actions

1. **Fix `syncToDoctor` base URL** to use the same resolution rules as `apiUrl()` (or call `apiUrl("/api/doctor/sync")`) — critical for split Vercel.
2. **Decide doctor portal API origin:** regenerate Orval with `baseUrl` / mutator, or deploy behind a **single domain** with reverse proxy to `/api`.
3. **Remove or use** `@workspace/api-client-react` in mobile to reduce confusion.
4. **Replace in-memory doctor store** with database **or** document explicitly as **demo-only** and gate features.
5. **Reduce logging** of vendor responses in production builds.
6. **Add minimal integration tests** (e.g. health + doctor login + one CGM mock) before large refactors.
7. **Security pass:** password hashing, TLS pinning **(inferred optional)**, cookie/session strategy for doctor portal.
8. **Consolidate branding** (Glucose vs Gluco) in user-visible strings.

---

## Appendix: Key file index

| Concern | Path |
|---------|------|
| Express app | `artifacts/api-server/internal/app.ts` |
| Route table | `artifacts/api-server/internal/routes/index.ts` |
| Vercel entry | `artifacts/api-server/api/index.js` |
| Mobile API base | `artifacts/mobile/utils/api-base-url.ts` |
| Mobile auth | `artifacts/mobile/context/AuthContext.tsx` |
| Mobile routing | `artifacts/mobile/app/_layout.tsx` |
| Doctor portal router | `artifacts/doctor-portal/src/App.tsx` |
| Generated API client | `lib/api-client-react/src/generated/api.ts` |
| Zod contracts | `lib/api-zod/src/index.ts` (and generated under package) |
| DB scaffold | `lib/db/src/schema/index.ts` |

---

*End of audit. Regenerate or extend this document when major architecture (persistence, auth, deployment topology) changes.*
