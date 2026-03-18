# Gluco Guardian — AI Diabetes Companion

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/mobile` (`@workspace/mobile`)

Expo React Native app — "Gluco Guardian" diabetes companion for kids.

Key screens:
- `app/onboarding.tsx` — 6-step signup for parents (role → parent name → child name → DOB → diabetes type + insulin + carb ratio → guardian PIN for minors), 4-step for adults (role → name → DOB → diabetes type). DOB determines `isMinor` (under 18).
- `app/auth.tsx` — Login / sign-up screen. Includes "Caregiver Access" panel: enter 6-char code to access a read-only caregiver view without a full account.
- `app/(tabs)/index.tsx` — Home: glucose gauge, CGM sync button, simulate reading, trend chart.
- `app/(tabs)/food.tsx` — Food & Carbs: camera photo → AI carb analysis (OpenAI vision), search by name, insulin dose suggestion, log to food diary. Includes "I Took X Units" dose-log button.
- `app/(tabs)/dashboard.tsx` — Dashboard: stats, trend chart, insulin settings, doctor sharing, food diary. Age-gated: minors see all data but cannot edit settings. Multi-role features: Child View Mode toggle (parent-only, Guardian-PIN protected), Caregiver Access code generation (parent-only), mode banners for child/caregiver views, settings hidden in restricted modes.
- `app/(tabs)/insulin.tsx` — Insulin calculator.
- `app/(tabs)/chat.tsx` — AI chat assistant. Mode-aware: parent accounts see parent-mode greeting ("Hi Sarah! Emma's glucose is…"), parent-specific quick suggestions (correction/care-focused), and the API receives `speakingToParent`/`parentName`/`isChildMode` context so the AI uses caregiver language (third-person about the child). Notification reply: `fromParent` URL param pre-sends the user's typed notification reply. Header subtitle dynamically shows "Managing {name}'s care" in parent mode.
- `app/cgm-setup.tsx` — Connect Dexcom (Share API) or FreeStyle Libre (LibreLink Up).

Contexts:
- `context/AuthContext.tsx` — Profile (name, parentName, DOB, diabetesType, accountRole, caregiverCode, childModeEnabled), CGM connection, food log, insulin log. Computes `isMinor`/`ageYears` from DOB. Multi-role: `caregiverSession` (in-memory), `isChildMode`, `setChildMode`, `generateCaregiverCode`, `enterCaregiverMode`, `exitCaregiverMode`.
- `context/GlucoseContext.tsx` — Glucose history, carb ratio, target glucose, correction factor (all persisted in AsyncStorage).

Services:
- `services/notifications.ts` — Push notification service using expo-notifications. Registers GLUCOSE_ALERT category with Reply (text input) and Dismiss actions. `scheduleGlucoseAlert()` fires an immediate local notification when glucose crosses thresholds. `handleNotificationResponse()` routes Reply-action responses to `/(tabs)/chat` with the typed text as `prompt` param. `_layout.tsx` registers the listener and requests permissions when `alertPrefs.notificationsEnabled` is true. `index.tsx` triggers notifications after each CGM sync with a 15-minute cooldown.

Constants:
- `constants/insulin.ts` — 16 brand options including Lispro Junior (new addition), grouped by type (rapid, long, ultra-long, regular, intermediate, premixed).

Backend routes added:
- `POST /api/food/analyze-photo` — OpenAI GPT vision analyzes base64 food photo, returns carbs + insulin recommendation.
- `POST /api/cgm/dexcom/connect` + `POST /api/cgm/dexcom/readings` — Dexcom Share API proxy.
- `POST /api/cgm/libre/connect` + `POST /api/cgm/libre/readings` — LibreLink Up API proxy.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
