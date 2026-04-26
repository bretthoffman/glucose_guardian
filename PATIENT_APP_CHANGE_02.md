# PATIENT_APP_CHANGE_02

## What was changed

- Made standard Expo local development the default workflow in `artifacts/mobile`.
- Updated mobile scripts so `dev` now runs plain Expo start (no Replit-specific env assumptions).
- Added explicit Expo convenience scripts for local development targets (`start`, `start:clear`, `ios`, `android`, `web`).
- Kept the previous Replit-coupled development command as a legacy script (`dev:replit`) instead of deleting it.
- Removed the Replit-specific Expo Router plugin origin setting from `app.json`.

## Exact files changed

- `artifacts/mobile/package.json`
- `artifacts/mobile/app.json`

## New recommended local dev workflow

From repo root:

1. Install dependencies (if needed):
   - `pnpm install`
2. Start the mobile app (recommended):
   - `pnpm --filter @workspace/mobile run dev`
3. Helpful alternatives:
   - `pnpm --filter @workspace/mobile run ios`
   - `pnpm --filter @workspace/mobile run android`
   - `pnpm --filter @workspace/mobile run web`
   - `pnpm --filter @workspace/mobile run start:clear` (if Metro cache issues appear)

## What was intentionally left unchanged

- Did not migrate auth (no Clerk changes).
- Did not migrate backend/data layer (no Convex changes).
- Did not alter screen logic or feature behavior.
- Did not remove existing build/serve/web export scripts (`build`, `serve`, `build:web`, `serve:web`).
- Did not remove Replit artifact/config files; only demoted Replit assumptions from the default local dev path.

## Remaining workflow confusion/residue still present

- Legacy Replit/web deployment artifacts still exist and can still be used (`dev:replit`, `scripts/build.js`, `server/serve.js`, `vercel.json`, `.replit-artifact/*`), but they are no longer the default local development path.
- The package still carries both Expo-native and web/static-serving workflows; this is intentional for now and should be cleaned in later reset phases.

## Manual test checklist (local)

- [ ] Run `pnpm --filter @workspace/mobile run dev` and verify Expo starts without requiring Replit env vars.
- [ ] Open in Expo Go (or simulator) and verify app boots to auth/onboarding as expected.
- [ ] Run `pnpm --filter @workspace/mobile run ios` (or `android`) and confirm target launch works.
- [ ] Optional: run `pnpm --filter @workspace/mobile run start:clear` if Metro cache issues appear.
- [ ] Confirm API-backed flows still function in your current environment (no script-level regressions).
- [ ] Confirm legacy script still exists for old environments: `pnpm --filter @workspace/mobile run dev:replit`.
