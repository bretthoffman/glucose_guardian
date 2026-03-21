# Deploying `@workspace/api-server` on Vercel

## What was failing

Vercel runs a TypeScript pass on the Express app **after** your `build` script (esbuild → `dist/index.cjs`). The api-server `tsconfig` inherited `moduleResolution: "bundler"` from the monorepo base while also declaring `outDir` / `rootDir`, which led to **per-file “Emit skipped”** errors during that step.

**Fix:** `artifacts/api-server/tsconfig.json` sets **`compilerOptions.noEmit: true`**, matching how this package is built in production (**esbuild** in `build.ts`, not `tsc` emit).

> **Note:** `module` / `moduleResolution` were **not** switched to `NodeNext` here: that would require `.js` extensions on every relative import and would fight the workspace’s `bundler`-style setup. `noEmit` alone avoids the bad emit path on Vercel without rewriting imports.

## Vercel project settings (pnpm workspace)

| Setting | Recommended value |
|--------|---------------------|
| **Root Directory** | `artifacts/api-server` (or repo root if you use a filtered build — see below) |
| **Install Command** | `pnpm install` (run from the **repository root** where `pnpm-lock.yaml` lives; Vercel usually detects the monorepo lockfile) |
| **Build Command** | `pnpm run build` |
| **Output Directory** | Leave **empty** / default (this is a Node serverless bundle, not a static export) |
| **Framework Preset** | **Other** (or Vercel’s Express detection if offered) |

If **Root Directory** is the monorepo root instead of `artifacts/api-server`:

- **Build Command:** `pnpm --filter @workspace/api-server run build`

## Workspace libs (`@workspace/api-zod`, `@workspace/db`)

The api-server `build` script runs **`pnpm --filter @workspace/api-zod run build`** and **`pnpm --filter @workspace/db run build`** first so **composite `.d.ts` outputs** exist for TypeScript project references.

`@workspace/api-zod`’s barrel **`src/index.ts`** exports only **`./generated/api`** (Zod schemas). Orval also generates **interfaces** under `./generated/types` with **duplicate names** (e.g. `DoctorLoginResponse`) which used to break `export *` from both barrels (**TS2308**). TS-only types are available from **`@workspace/api-zod/types`**.

## Verify locally before push

```bash
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit
```

Package `typecheck` script:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Optional, closest to Vercel’s pipeline (requires [Vercel CLI](https://vercel.com/docs/cli)):

```bash
cd artifacts/api-server && npx vercel build
```
