# Gluco-Guardian — Agent Instructions

Instructions for ANY coding agent (Claude, ChatGPT/Codex, etc.) working in this repo, on either partner's machine. Read fully before changing anything.

**This is a live medical app.** Real families dose insulin with it. `master` is production — there are no PR gates; a push to `master` deploys. Follow the ordering rules below exactly.

## The map — what lives where, and how each part ships

| Path | What it is | How it deploys |
|---|---|---|
| `artifacts/mobile` | Expo React Native patient app | EAS OTA (`eas update`) for JS-only changes; EAS native build otherwise — see §4 |
| `artifacts/api-server` | Express API (Dexcom proxy, doctor sync, food AI, /predict) | Vercel auto-deploys on push to `master` → `https://api.glucoseguardian.io` (old `glucose-guardian-ashen.vercel.app` stays alive for old app bundles) |
| `artifacts/doctor-portal` | React/Vite doctor portal — **self-contained pnpm project**, excluded from the outer workspace | Vercel auto-deploys on push when this folder changes → `https://portal.glucoseguardian.io` |
| `artifacts/site` | Static sales page (no build step) | Vercel auto-deploys on push when this folder changes → `https://www.glucoseguardian.io` |
| `convex/` | Convex backend: schema, functions, crons. **Prod deployment: `polished-badger-189`** | Manual: `npx convex deploy` (§6). Never auto-deploys |
| `lib/*` | Shared workspace packages (`@workspace/api-zod`, `@workspace/db`) used by the api-server | Ship via the api-server's auto-deploy |

## 1. Before ANY work: sync with the other partner

Both partners (and their agents) push directly to `master`. Before starting work:

```bash
git fetch origin
git rev-list --left-right --count master...origin/master
```

- `0 0` → up to date, proceed.
- Behind (right number > 0) → catch up first: `git pull --rebase origin master`, resolve any conflicts, re-run the relevant checks in §3 before continuing.

**Repeat this check as its own step immediately before every push, OTA publish, or Convex deploy** — and abort/catch-up if behind. This matters most for OTA: `eas update` publishes **your local working tree**, so publishing from a stale tree silently reverts the other partner's shipped changes for every user.

## 2. Edit scoping — touch only what you're changing

- **Mobile change** → edit only `artifacts/mobile`.
- **Portal change** → edit only `artifacts/doctor-portal`. It is deliberately self-contained: run `pnpm install` / `pnpm build` **inside that folder**, never add its dependencies to the outer workspace, never "fix" the `!artifacts/doctor-portal` exclusion in the root `pnpm-workspace.yaml`.
- **Site change** → edit only `artifacts/site` (plain HTML/CSS/JS, no build).
- **API change** → edit `artifacts/api-server` (and `lib/*` if the shared types/db genuinely change — knowing that pushing deploys the api immediately).
- **Backend change** → `convex/` affects everything (mobile, api, portal data). See §6 for ordering.
- Root config (`package.json`, `pnpm-workspace.yaml`, `vitest`/`tsconfig` setup) affects multiple artifacts — only change it when the task is explicitly about it.

## 3. Checks before any commit

From the repo root:

```bash
npx vitest run          # whole-repo suite; must be 0 failed
```

The summary may show dozens of "errors" alongside passing tests — that's stderr noise from doctor-route tests that deliberately exercise fail-closed paths. **Failures** are what matter: anything other than 0 failed blocks the commit.

Plus the artifact you touched:

- Mobile: `cd artifacts/mobile && npx tsc --noEmit`
- API: `pnpm --filter @workspace/api-server run typecheck`
- Portal: `cd artifacts/doctor-portal && pnpm install --frozen-lockfile && pnpm typecheck && pnpm build`
- Site: no build — just open/inspect the HTML you changed and check referenced assets exist.

## 4. Shipping mobile changes (OTA vs native build)

### OTA-safe (publish freely)
- Any TS/TSX/JS code change: components, screens, logic, styles, text.
- New or changed images/sounds loaded via `require(...)` from the JS side.
- New **pure-JS** npm dependencies.

### Requires a NATIVE BUILD — STOP and tell the user; do NOT publish an OTA
- Adding or upgrading any dependency with native code (most `react-native-*` / `expo-*` packages). The installed binary already includes `react-native-svg` — that one is fine to use.
- **Any change to `app.json`**: icons, splash, plugins, permissions, notification config/sounds, scheme, bundle IDs — and especially the `version` field. The runtime policy is `appVersion`, so bumping `version` cuts every existing install off from future OTAs until users install a new build.
- Expo SDK or React Native upgrades; `eas.json` build-profile changes.
- Rule of thumb: if the change would alter `npx expo prebuild` output (the native project), it needs a build. **Unsure → pause and ask the user.**

### OTA publish procedure (strict order)
1. Sync check (§1) as its own step — abort if behind.
2. **Verify `artifacts/mobile/.env` exists** — it is git-ignored, so a fresh clone (every cloud session) does NOT have it. Publishing without it bakes EMPTY `EXPO_PUBLIC_*` values into the bundle and breaks the app for every user. If missing: `cp artifacts/mobile/.env.example artifacts/mobile/.env` (its values are public-by-design and current).
3. Checks (§3) pass.
4. Commit and push to `master`.
5. Publish:
   ```bash
   cd artifacts/mobile
   npx eas-cli update --branch production --message "<what changed>" --non-interactive
   ```
   Auth: an `EXPO_TOKEN` environment variable (cloud/CI sessions — set in the session's environment config) or a logged-in Expo account (`npx eas-cli whoami`). If neither works, tell the user; don't retry blindly.
6. If the change calls a **new** Convex function, deploy Convex FIRST (§6) — before step 4.

**Every OTA a user could notice gets a "What's new" entry** at the TOP of `artifacts/mobile/constants/releaseNotes.ts` (new unique `id`, plain patient-friendly words, no em dashes), committed in the same push as the change. The app combines every note a device hasn't seen into one sheet, so someone who skipped several updates sees them all at once. Never edit or reorder older entries; to announce something that missed its note, add a NEW top entry. Pure bug fixes nobody would notice are the only exception.

**Every such update also updates Help Mode** (`artifacts/mobile/utils/helpScripts.ts`), in the same push. Help Mode must always explain what the app can do now: add a step for anything new (with a `useHelpAnchor` on the element it spotlights) and fix any step whose wording changed (device names, renamed buttons, new controls). One tour per tab page, the Dashboard included; steps whose element isn't on screen are skipped automatically, so it is fine to cover conditional UI. Plain patient-friendly words, no em dashes.

Env note: the `EXPO_PUBLIC_*` values in `artifacts/mobile/.env` are **inlined into the OTA bundle at publish time**. Never point them at a different backend before publishing.

## 5. Shipping api / portal / site changes

All three deploy automatically when you push `master` — the push IS the deploy:

- **API**: deploys on every push. If the change calls new Convex functions, deploy Convex FIRST (§6), then push — the reverse order serves errors to live users.
- **Portal / Site**: deploy only when their folder changed (Vercel skips otherwise).
- Verify after ~2 minutes with a request to the live URL, e.g. `curl -sI https://portal.glucoseguardian.io` (200) or a relevant `curl` against `https://api.glucoseguardian.io`.

## 6. Convex backend changes

**What requires a Convex deploy:** any change under `convex/` — and it must land **before** any client (OTA, api push, portal push) that references the new/changed functions.

**Prod deploy** (what live users and the api actually run — deployment `polished-badger-189`):

```bash
git pull --rebase origin master   # never deploy functions the other partner hasn't got / vice versa
npx convex deploy                 # from the repo root
```

Confirm the output names `polished-badger-189` / prod before treating it as done.

**Auth:** deploys use a production `CONVEX_DEPLOY_KEY` — as an environment variable (cloud/CI sessions: set in the session's environment config) or a line in the **git-ignored root `.env.local`** on a local machine (each machine/environment gets its own key, generated by the project owner in the Convex dashboard: project → Settings → URL & Deploy Key). The CLI picks it up automatically and it works regardless of which account `npx convex login` is on. A quick access probe: `npx convex function-spec --prod`. If the deploy fails with a login/access error and there's no deploy key, **STOP and tell the user** — never work around it, and never print or commit the key.

**`npx convex dev --once` is NOT a prod deploy.** It pushes to the personal dev deployment named in the root `.env.local` (`CONVEX_DEPLOYMENT`, currently `dev:clean-ptarmigan-904`) — live users never see it. Use it only for testing against the dev backend.

**Schema changes** that delete/rename fields or tables: pause and discuss a migration with the user first. Live data is involved.

## 7. Vercel, DNS, and env vars are HUMAN-ONLY

- Never install/run the Vercel CLI, never create/modify Vercel projects, settings, domains, or env vars, never touch DNS. If a change needs any of that (e.g. a new env var on the api), write exact click-by-click instructions for the user instead.
- Secrets: never print them to the terminal/chat and never commit them. The api-server's local secrets live in git-ignored `artifacts/api-server/.env.local` (e.g. `USDA_FDC_API_KEY`) — if missing, ask the user; production values live in Vercel (user-managed).

## 8. When a push fails (account drift)

- `git push` returns 403 → the machine's active GitHub credential lacks write access (`gh auth status` to inspect). Tell the user to re-auth (`gh auth login`, then `gh auth setup-git`). **Never force-push, never rewrite master history.**
- Convex access errors → §6, stop and tell the user.

## 9. Architecture invariants — do not break these

- **Dose settings are server-owned.** Only the Convex mutation `patientProfile.setDoseSettings` may change ratios; every change is recorded in `doseSettingsAudit`. Never re-introduce any device→server dose-settings sync or client-side backfill — that exact pattern caused silent ratio resets in production.
- **Caregiver sessions confirm before writing logs** into another person's profile. Keep that confirmation on every log-creating path.
- **CORS:** the api only allows browser origins listed in the `DOCTOR_PORTAL_ORIGINS` env var (comma-separated, exact origins — set in Vercel by the user).
- **Dose-calculation logic** (`artifacts/mobile/utils/dose.ts` and friends): treat as medical-critical. Flag any behavioral change to the user explicitly, with tests, even when they asked for it.

## 10. Always pause and ask the user before

- Anything in the native-build list (§4).
- Bumping the app version or anything in `app.json`.
- Convex schema migrations that remove/rename data.
- Anything requiring Vercel/DNS/env-var changes (§7).
- Deleting data, force-pushing, or any destructive/irreversible operation.
