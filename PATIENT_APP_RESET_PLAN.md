# PATIENT_APP_RESET_PLAN

## 1) Goal of the reset

### What the patient app currently is

**Observed facts**
- `artifacts/mobile` is an Expo Router app (`artifacts/mobile/package.json` has `main: "expo-router/entry"`).
- It includes true mobile-native features: notifications, camera/photo analysis, file export/share, haptics, safe areas, native tabs (`artifacts/mobile/app/_layout.tsx`, `artifacts/mobile/services/notifications.ts`, `artifacts/mobile/app/(tabs)/food.tsx`, `artifacts/mobile/app/(tabs)/dashboard.tsx`, `artifacts/mobile/app/(tabs)/_layout.tsx`).
- It also contains web/static-hosting and deployment scaffolding inside the mobile package: `vercel.json`, `scripts/build.js`, `server/serve.js`, `server/templates/landing-page.html`, committed `dist/` output, and `.replit-artifact/artifact.toml`.
- Auth/session is currently local-device account state in `AsyncStorage` plus local caregiver/doctor access-code flows (`artifacts/mobile/context/AuthContext.tsx`).

### What it should become

**Target direction (aligned to your decision)**
- `artifacts/mobile` should be a clean Expo-first iOS/Android app execution path first (dev client/Expo Go/EAS build/TestFlight path), with web/static-hosting concerns removed from its core runtime.
- It should keep product behavior (glucose tracking, CGM sync, food/insulin/chat flows), but not be architected around Vercel/Replit deployment assumptions.
- It should be migration-ready for Clerk auth and Convex backend without coupling to local-auth semantics.

### Why move away from Vercel/web-shaped assumptions for patient app

**Observed facts**
- Mobile scripts and config are currently mixed with web deployment concerns:
  - `artifacts/mobile/package.json` has `build`, `serve`, `build:web`, `serve:web`, and Replit-shaped `dev`.
  - `artifacts/mobile/vercel.json` hardcodes `EXPO_PUBLIC_API_BASE_URL` and output directory.
  - `artifacts/mobile/scripts/build.js` is a custom static Expo Go bundle/export pipeline coupled to Replit domain env vars.
  - `artifacts/mobile/server/serve.js` hosts manifest/static assets and landing page for browser/QR flows.
- This creates runtime ambiguity: are we building a native app or hosting static artifacts to launch Expo Go remotely?

**Inference**
- Keeping both shapes active increases drift risk (dev/test behavior can differ from eventual TestFlight binaries) and makes migration sequencing harder (auth/backend work gets entangled with deployment plumbing).

### What “Expo-first mobile app” means here (practical terms)

For this repo, Expo-first should mean:
- `artifacts/mobile` is optimized for iOS/Android app runtime and EAS/TestFlight release path.
- API configuration is explicit and mobile-oriented (single env contract for backend base URL), not inferred from Replit/Vercel host context.
- Mobile app startup, routing, auth guards, and core features run without requiring web manifest server utilities.
- Web export/server files may exist temporarily only if intentionally retained, but they do not define the primary app architecture.

---

## 2) Current patient app audit (`artifacts/mobile`)

### Current framework/runtime shape

**Observed facts**
- Expo SDK 54 + React Native 0.81 + Expo Router (`artifacts/mobile/package.json`, `artifacts/mobile/app.json`).
- Typical Expo config and toolchain are present (`app.json`, `babel.config.js`, `metro.config.js`, Expo tsconfig).
- App is mobile-capable with native plugins and entitlements (notifications critical alerts in iOS `infoPlist`/entitlements in `app.json`).

### Current routing shape

**Observed facts**
- File-based Expo Router with guarded auth/onboarding/tab stacks:
  - Root stack in `artifacts/mobile/app/_layout.tsx`.
  - Auth and onboarding routes: `app/auth.tsx`, `app/onboarding.tsx`.
  - Main tab routes in `app/(tabs)` (`index`, `insulin`, `food`, `chat`, `dashboard`).
- Route guarding is driven by local auth state (`isSignedIn`, `isLoggedIn`, caregiver/doctor session flags) in `app/_layout.tsx`.

### Current auth/session shape

**Observed facts**
- No external auth provider yet in mobile runtime.
- Auth is local and persisted with `AsyncStorage`:
  - Local account object + hashed password (custom reversible-style hex encoding, not cryptographic auth).
  - Session boolean.
  - Profile, caregiver/doctor access codes, guardian PIN, logs/messages all local.
  - Implemented in `artifacts/mobile/context/AuthContext.tsx`.
- Doctor and caregiver “sessions” are code-entry modes, not server-issued identities (`app/auth.tsx` + context methods).

### Current API usage shape

**Observed facts**
- Mobile currently calls backend endpoints for:
  - Chat: `/api/chat` (`app/(tabs)/chat.tsx`)
  - Food estimate/photo: `/api/food/estimate`, `/api/food/analyze-photo` (`app/(tabs)/food.tsx`)
  - Insulin prediction: `/api/insulin/predict` (`app/(tabs)/food.tsx`)
  - CGM connect/readings: `/api/cgm/*` (`app/cgm-setup.tsx`, `app/(tabs)/index.tsx`)
  - Doctor sync snapshot: `${apiBase}/doctor/sync` in `AuthContext` (note: this path is built differently from `apiUrl()` usage).
- Backend endpoints are currently served by `artifacts/api-server` Express routes (`internal/routes/cgm.ts`, `chat.ts`, `food.ts`, `insulin.ts`, `doctor.ts`).

### Web/Vercel/Replit-specific assumptions/hacks still present

**Observed facts**
- Replit runtime env assumptions in mobile dev/build scripts (`REPLIT_*`, `EXPO_PUBLIC_DOMAIN`) in `artifacts/mobile/package.json` and `scripts/build.js`.
- Vercel config inside mobile package (`artifacts/mobile/vercel.json`).
- Custom static bundle and manifest hosting system in mobile package (`scripts/build.js`, `server/serve.js`, landing template).
- `app.json` has Expo Router plugin origin set to Replit URL.
- Many UI files carry web-safe layout branches (`Platform.OS === "web"` padding/behavior adjustments); these are minor and not the main architectural issue.

### Files/patterns apparently added to make mobile behave like web deployment

**Observed facts**
- `artifacts/mobile/vercel.json`
- `artifacts/mobile/scripts/build.js`
- `artifacts/mobile/server/serve.js`
- `artifacts/mobile/server/templates/landing-page.html`
- `artifacts/mobile/dist/*` (export artifact output committed in repo)
- `artifacts/mobile/.replit-artifact/artifact.toml`
- `artifacts/mobile/package.json` scripts: `build`, `serve`, `build:web`, `serve:web`, Replit-shaped `dev`
- `artifacts/mobile/app.json` Expo Router plugin option `{ origin: "https://replit.com/" }`

### Parts already clean Expo-native

**Observed facts**
- Router architecture and screen composition are proper Expo Router patterns.
- Native module usage is extensive and coherent (notifications, haptics, camera/image tools, print/file/share).
- Metro and Babel config are straightforward Expo defaults.
- Core app logic (glucose, food, insulin, dashboard flows) runs as native RN code; not web-only components.

---

## 3) Risks and constraints

### What could break if we remove web/serverless assumptions carelessly

**Observed risks**
- API base resolution breakage:
  - Some calls use `apiUrl(...)` (`utils/api-base-url.ts`), but doctor sync in `AuthContext` manually builds URL from `EXPO_PUBLIC_DOMAIN`/localhost.
  - If env logic changes partially, some API calls may silently fail while others still work.
- Dev workflow disruption:
  - Current `pnpm --filter @workspace/mobile run dev` expects Replit env vars in script.
- Team confusion:
  - If `vercel.json`/server/build scripts are removed before replacement dev docs/scripts, local workflows may break.
- Doctor sync behavior loss:
  - `dashboard.tsx` auto-calls `syncToDoctor` every 2 minutes when doctor code exists; removing old API contracts without stubbing breaks provider sync.

### What likely needs to remain temporarily

**Inference (recommended temporary keeps)**
- Existing `/api/*` contract usage from mobile screens until backend migration phase.
- Current local auth/profile/session model until Clerk integration phase starts.
- Existing doctor sync endpoints and access-code bridge while doctor portal remains web app and still depends on `/api/doctor/*`.

### Where auth, Dexcom integration, doctor sync depend on old backend behavior

**Observed facts**
- Auth: mobile login/create-account is entirely local today (`AuthContext` + `auth.tsx`), so Clerk migration requires replacing root guard semantics and persisted session keys.
- Dexcom/Libre integration: mobile depends on `artifacts/api-server/internal/routes/cgm.ts` proxy behavior and session/token contract (`/api/cgm/dexcom/connect`, `/readings`, `/libre/*`).
- Doctor sync:
  - Mobile pushes snapshot to `/doctor/sync` with local doctor code (`AuthContext.syncToDoctor`).
  - Backend stores snapshots in in-memory maps (`artifacts/api-server/internal/routes/doctor.ts`), including demo seed data and code-based lookup.
  - Doctor message model currently mirrors this snapshot/store approach, not durable database-backed identity.

---

## 4) Exact reset plan (phased)

## Phase 1: Remove deployment/runtime confusion

- **Objective:** Make `artifacts/mobile` unambiguously “mobile app package first.”
- **Likely files:** `artifacts/mobile/package.json`, `artifacts/mobile/vercel.json`, `artifacts/mobile/scripts/build.js`, `artifacts/mobile/server/serve.js`, `artifacts/mobile/server/templates/landing-page.html`, `artifacts/mobile/app.json`, possibly committed `artifacts/mobile/dist`.
- **Should change:**
  - Define clear mobile dev/build scripts (`expo start`, EAS-friendly scripts) without Replit-specific env coupling.
  - Mark web-static tooling as deprecated or move it out of primary scripts.
  - Remove/retire `vercel.json` from mobile package path.
  - Remove Replit-specific Expo Router origin config from `app.json` unless still required for a temporary environment.
- **Should NOT change yet:**
  - Feature screens, routing, auth behavior, or API endpoint semantics.
  - Doctor portal contracts.
- **Verify success:**
  - Clean local `expo start` works for iOS/Android without Replit env vars.
  - No runtime dependency on `server/serve.js` or static manifest landing flow for primary development.

## Phase 2: Stabilize mobile-only execution path

- **Objective:** Ensure one consistent mobile runtime path for network calls and platform behavior.
- **Likely files:** `artifacts/mobile/utils/api-base-url.ts`, `artifacts/mobile/context/AuthContext.tsx`, `artifacts/mobile/app/(tabs)/index.tsx`, `chat.tsx`, `food.tsx`, `cgm-setup.tsx`, `dashboard.tsx`, any env docs.
- **Should change:**
  - Unify all API calls through one base URL helper; eliminate one-off base URL logic (`syncToDoctor` currently bypasses `apiUrl`).
  - Normalize mobile env contract (`EXPO_PUBLIC_API_BASE_URL` as single source).
  - Keep web-specific UI branches only where harmless; avoid web-only control flow in core business logic.
- **Should NOT change yet:**
  - Endpoint paths and payload contracts to existing API server.
  - Local auth model.
- **Verify success:**
  - All API-backed features (CGM connect/sync, chat, food photo analysis, insulin prediction, doctor sync) work using unified base URL path.
  - No call sites rely on `EXPO_PUBLIC_DOMAIN`/Replit fallback behavior.

## Phase 3: Prepare auth migration (to Clerk)

- **Objective:** Decouple app navigation/session guards from local account emulation.
- **Likely files:** `artifacts/mobile/context/AuthContext.tsx`, `artifacts/mobile/app/_layout.tsx`, `app/auth.tsx`, onboarding/profile persistence boundaries.
- **Should change:**
  - Split auth identity/session from profile/data context concerns.
  - Introduce an auth adapter boundary so Clerk can replace local sign-in without rewriting every screen.
  - Keep caregiver/doctor role UX but re-anchor to real authenticated identities later.
- **Should NOT change yet:**
  - Full screen-level feature logic; Dexcom endpoints; doctor portal API model.
- **Verify success:**
  - App can run with local adapter + new auth boundary without regressions.
  - Route guards no longer assume local password-hash account semantics internally.

## Phase 4: Prepare backend migration (to Convex)

- **Objective:** Isolate backend contracts from UI components and move toward durable data model.
- **Likely files:** API call sites in `app/(tabs)` and contexts, plus new service layer in `artifacts/mobile`.
- **Should change:**
  - Centralize API/domain calls (chat, cgm, food, insulin, doctor sync) behind service modules.
  - Define interfaces for data sources (current Express API vs future Convex functions).
  - Begin replacing in-memory doctor sync semantics with durable backend model design.
- **Should NOT change yet:**
  - Full endpoint migration in one step; keep compatibility shims.
- **Verify success:**
  - UI consumes a stable service contract; backend implementation can swap without rewriting screens.

## Phase 5: Prepare TestFlight readiness

- **Objective:** Harden native release path and remove leftover prototype assumptions.
- **Likely files:** `artifacts/mobile/app.json`, app assets, permissions/entitlements, env handling, release scripts/docs.
- **Should change:**
  - Finalize app identifiers, release config, iOS capabilities, and production env strategy.
  - Validate push-notification permission/critical alert flows on real devices.
  - Confirm file export/share, camera/photo workflows, and CGM connectivity under release builds.
- **Should NOT change yet:**
  - Major feature additions; keep focus on stability/reliability.
- **Verify success:**
  - Successful internal iOS archive/TestFlight run with core flows passing smoke tests.
  - No hidden dependence on web server artifacts for runtime behavior.

---

## 5) Web/Vercel/Replit residue checklist

- [ ] Review/remove `artifacts/mobile/vercel.json` (Vercel env and output assumptions inside mobile package).
- [ ] Review/deprecate `artifacts/mobile/scripts/build.js` (custom static Expo Go deployment pipeline; Replit domain coupling).
- [ ] Review/deprecate `artifacts/mobile/server/serve.js` (Node static host for manifests/landing page).
- [ ] Review/deprecate `artifacts/mobile/server/templates/landing-page.html` (browser QR/deep-link flow).
- [ ] Remove or stop tracking `artifacts/mobile/dist` artifacts as app architecture dependencies.
- [ ] Review `artifacts/mobile/.replit-artifact/artifact.toml` and decide if repo should keep Replit artifact integration.
- [ ] Update `artifacts/mobile/package.json` scripts to remove Replit-coupled `dev` and non-primary web serving scripts from default workflow.
- [ ] Review `artifacts/mobile/app.json` plugin option `expo-router.origin: "https://replit.com/"`.
- [ ] Normalize `artifacts/mobile/utils/api-base-url.ts` and all callers to one mobile API env contract.
- [ ] Replace manual URL build in `artifacts/mobile/context/AuthContext.tsx` (`syncToDoctor`) with shared URL helper.
- [ ] Keep temporary web UI branches (`Platform.OS === "web"`) only if harmless, but treat them as compatibility, not architecture.

---

## 6) Recommended first code change (single best next task)

**Recommendation**
- Unify mobile backend URL resolution by refactoring `AuthContext.syncToDoctor` to use `apiUrl("/api/doctor/sync")` (or equivalent shared helper) instead of manual `EXPO_PUBLIC_DOMAIN`/localhost logic.

**Why this first**
- Small and safe (one focused code path).
- High leverage: removes the most obvious split-runtime network assumption currently bypassing shared API config.
- Reduces migration risk for all later phases (auth/backend migration and environment cleanup).

**Scope of that next task**
- Touch `artifacts/mobile/context/AuthContext.tsx` and (if needed) `artifacts/mobile/utils/api-base-url.ts`.
- Keep endpoint/payload unchanged.
- Add a quick smoke verification: doctor sync still posts successfully with current backend.

---

## 7) Open questions before Clerk/Convex phases

- Should doctor/caregiver “code entry mode” stay as a product feature, or be replaced by identity-based sharing/invitations under Clerk?
- For Convex, what is the desired canonical patient data ownership model (single patient owner with shared viewers/editors, or caregiver-primary accounts)?
- Should CGM credentials/tokens remain mobile-managed temporarily, or move server-side first during backend migration?
- Is `artifacts/api-server` staying as a temporary compatibility layer during Convex rollout, or do we plan direct mobile-to-Convex calls early?
- Do we need to keep any web-preview/QR install experience from `artifacts/mobile/server/*`, or can it be fully removed now?
- What is the production API environment strategy for mobile builds (`development`, `preview`, `production`) and where will secrets/config live?
- Should doctor portal continue consuming the current `/api/doctor/*` snapshot model during migration, or should that be the first backend domain moved to Convex?
- For TestFlight readiness, which exact release milestone defines “feature complete enough” for first internal build (must-have flow checklist)?

---

## Facts vs Inferences note

- Sections labeled **Observed facts** come directly from inspected files in this repo.
- Sections labeled **Inference** are recommended interpretations and sequencing choices based on those facts.
