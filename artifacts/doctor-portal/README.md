# Glucose Guardian — Doctor Portal

Web portal for physicians to review patient glucose data, message caregivers, and issue treatment proposals.

Merged into the `glucose_guardian` monorepo from the former `glucose-guardian-doctor-portal` repository (full history preserved via `git subtree`). This folder is a **self-contained pnpm project** — it has its own lockfile and `pnpm-workspace.yaml`, and is deliberately excluded from the root workspace.

## Develop

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build        # vite → dist/public
pnpm typecheck
```

## Deploy

Deployed on Vercel from this monorepo with Root Directory `artifacts/doctor-portal` (Output Directory `dist/public`). Pushes to `master` that don't touch this folder skip the portal build. SPA rewrites and security headers live in `vercel.json`.
