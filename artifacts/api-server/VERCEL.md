# Deploying `@workspace/api-server` on Vercel

## Why Vercel failed after `pnpm run build` (“Emit skipped” on `src/routes/health.ts`)

Vercel’s **zero-configuration Express** integration looks for known entry filenames (for example `src/index.ts`, `src/app.ts`, `src/server.ts`, etc.). When it finds one, it runs a **second** TypeScript compile over the **Express dependency graph** (including every `import`ed route module). That pass is **not** your `esbuild` step; it happens **after** `dist/index.cjs` is already built. Your route files then hit the earlier `bundler`/`emit` tsconfig mismatch → **`health.ts: Emit skipped`**.

This deployment shape fixes that by:

1. **Removing** Express entry files from Vercel’s discovery paths (no `src/index.ts` / `src/app.ts`).
2. Putting the app under **`internal/`** (not scanned as a default Express entry).
3. Using a **single serverless entry**: **`api/index.js`** (plain JavaScript) that **`require()`s** the **pre-bundled** `dist/index.cjs` only.
4. **`vercel.json`** rewrites all traffic to that **`/api`** function.

Local development uses **`pnpm run dev`** → **`dev.ts`** (long-running `listen`). The esbuild step produces:

- **`dist/index.cjs`** — Express app **only** (from `internal/handler.ts`), loaded by **`api/index.js`** on Vercel.
- **`dist/server.cjs`** — app + **`listen`** (from `dev.ts`), for Replit/Docker/VM-style hosts that run `node dist/server.cjs`.

## TypeScript / libs (still relevant)

- `artifacts/api-server/tsconfig.json` uses **`noEmit: true`** for `tsc` checks; JS output is **esbuild** only.
- The build script still runs **`@workspace/api-zod`** and **`@workspace/db`** `tsc` emits so composite `.d.ts` stay valid for local typechecking.

## “No Output Directory named `public` found”

For **Framework Preset: Other**, Vercel still runs the **static** deployment step and may default the **Output Directory** to **`public`**. This API project does not produce a static site in `public/`, so the build fails unless the output directory is overridden.

**Fix (in repo):** [`vercel.json`](vercel.json) sets **`"outputDirectory": "."`** so the static step uses the **project root** instead of requiring a `public/` folder (see [Configure a Build → Output Directory](https://vercel.com/docs/deployments/configure-a-build#output-directory) and [`outputDirectory` in vercel.json](https://vercel.com/docs/project-configuration/vercel-json#outputdirectory)). The same file declares **`functions`** for **`api/index.js`** so the deployment is explicitly **function-based**.

If you ever pinned **Output Directory** to `public` in the dashboard, remove that override so **`vercel.json`** controls the value.

## Single set of Vercel project settings

Use **one** project configuration (do **not** also enable a separate “Express” framework preset that re-scans `src/`).

| Setting | Value |
|--------|--------|
| **Root Directory** | **`artifacts/api-server`** (recommended) |
| **Framework Preset** | **Other** |
| **Install Command** | `pnpm install` (monorepo root; lockfile at repo root) |
| **Build Command** | `pnpm run build` |
| **Output Directory** | **Leave override OFF** — [`vercel.json`](vercel.json) sets `outputDirectory` to **`.`** |
| **Node.js version** | 20.x (or match your `package.json` / team standard) |

**Do not** set a custom “Output” to `dist` as a static site. The runtime is the **`api/`** serverless bundle + `dist/index.cjs`.

If the project was previously imported with **Framework = Express** or custom settings that pointed at `src/`, **clear** those: use **Other**, Root **`artifacts/api-server`**, and rely on **`vercel.json`** + **`api/index.js`** only.

### Monorepo root as Root Directory (optional)

If Root Directory is the **repo root** instead:

| Setting | Value |
|--------|--------|
| **Root Directory** | *(repo root)* |
| **Build Command** | `pnpm --filter @workspace/api-server run build` |

## Verify locally

```bash
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit
```

Optional:

```bash
cd artifacts/api-server && npx vercel build
```
