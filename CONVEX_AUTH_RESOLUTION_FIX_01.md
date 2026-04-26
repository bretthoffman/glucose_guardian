# Convex auth resolution fix 01 — Metro + monorepo `convex/_generated`

## What caused the module resolution failure

Metro’s **project root** is **`artifacts/mobile`**. Imports such as:

`artifacts/mobile/utils/convex-auth-client.ts` → `../../../convex/_generated/api.js`

point at files **outside** that root (under the **repo-root** `convex/` folder). With the default Expo Metro config, those paths are **not part of Metro’s watch / resolution graph**, so the bundler reports that it **cannot resolve** the module when running in **Expo Go**.

This is a **monorepo layout** issue, not a problem with Convex’s generated file contents.

## What was changed

**Metro** was configured so the bundler:

1. **Watches the monorepo root** (`watchFolders`), so files under `convex/` (including `_generated`) are visible to the bundler.
2. **Resolves `node_modules` from both** the mobile package and the **workspace root**, so dependencies like `convex` continue to resolve consistently with pnpm’s layout.

**No changes** were made to `convex-auth-client.ts`, `AuthContext.tsx`, Dexcom/API/doctor code, or Convex functions for this fix.

## Exact files changed

| File | Change |
|------|--------|
| `artifacts/mobile/metro.config.js` | Set `watchFolders` to repo root; set `resolver.nodeModulesPaths` for mobile + root `node_modules` |
| `CONVEX_AUTH_RESOLUTION_FIX_01.md` | This document |

## Fix type: Metro config, import path, or both?

- **Metro config only** — import paths stay `../../../convex/_generated/...`.

## Follow-up setup

- Restart the dev server after changing Metro (see checklist).
- Ensure **`EXPO_PUBLIC_CONVEX_URL`** is still set in `artifacts/mobile/.env` for runtime auth (unchanged).

## Manual verification checklist

- [ ] From repo: `pnpm --filter @workspace/mobile run start:clear` (or `expo start --clear`).
- [ ] Open app in **Expo Go** — no red screen for `Unable to resolve module ../../../convex/_generated/api.js`.
- [ ] Sign-in / sign-up still hits Convex (smoke test).

## Caveats

- Any future imports from **outside** `artifacts/mobile` may also require staying under the watched monorepo root (or further Metro tweaks).
- If you move the Convex folder, update **`watchFolders`** / paths accordingly.
