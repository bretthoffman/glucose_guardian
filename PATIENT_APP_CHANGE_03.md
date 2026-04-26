# Patient app change 03 — explicit API base URL for Expo Go

## What changed

- Documented the **mobile API env contract** with `EXPO_PUBLIC_API_BASE_URL` as the preferred variable.
- Added a **committed** `artifacts/mobile/.env.example` so local setup is obvious (copy to `artifacts/mobile/.env`).
- Clarified in `artifacts/mobile/utils/api-base-url.ts` that Expo loads env from the **mobile package root**, not the monorepo root, and why relative URLs break **Expo Go on a physical device** when the API is deployed elsewhere.
- **No** auth changes, **no** backend/route changes, **no** screen refactors, **no** endpoint contract changes. Legacy `EXPO_PUBLIC_DOMAIN` → `https://…` remains as fallback.

## Files changed

| File | Change |
|------|--------|
| `artifacts/mobile/.env.example` | **New** — example `EXPO_PUBLIC_API_BASE_URL` and notes |
| `artifacts/mobile/utils/api-base-url.ts` | JSDoc / comments only (behavior unchanged) |
| `PATIENT_APP_CHANGE_03.md` | **New** — this document |

## Intended mobile API env contract

| Variable | Required? | Meaning |
|----------|-----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | **Recommended** for real devices + deployed API | Full origin of the API server, **no trailing slash**. All `apiUrl("/api/...")` calls become `${EXPO_PUBLIC_API_BASE_URL}/api/...`. Inlined at bundle time by Expo. |
| `EXPO_PUBLIC_DOMAIN` | Optional legacy | Hostname only (no `https://`). If set and `EXPO_PUBLIC_API_BASE_URL` is unset, base becomes `https://${EXPO_PUBLIC_DOMAIN}`. |
| *(neither set)* | Web / same-origin only | `API_BASE_URL` is `""` → relative `/api/...` (fine when the app and API share an origin; **not** fine for Expo Go on a phone pointing at a separate Vercel API). |

**Where to set it:** create `artifacts/mobile/.env` (gitignored) from `.env.example`, **or** export the variable in the shell **before** `expo start`, with the working directory / package context such that Expo’s project root is `artifacts/mobile`. A `.env.local` at the **monorepo root** is **not** automatically loaded by Expo for the mobile app unless your tooling explicitly injects it.

## Exact value for current testing

```bash
EXPO_PUBLIC_API_BASE_URL=https://glucose-guardian-ashen.vercel.app
```

(No trailing slash.)

## How to verify the app hits the deployed API

1. Ensure `EXPO_PUBLIC_API_BASE_URL` is set as above (via `artifacts/mobile/.env` or shell export) and **restart Expo with cache clear** so the bundle picks up env (see below).
2. Trigger a flow that calls the API (e.g. Dexcom connect or any screen that uses `apiUrl`).
3. Confirm requests go to host **`glucose-guardian-ashen.vercel.app`** (device network inspector, proxy, or server/Vercel logs — not `localhost` or a relative path on the phone).

## Intentionally unchanged

- Auth implementation and tokens.
- Backend code and route handlers.
- Screen layout and navigation.
- `apiUrl` / URL joining logic and fallback order (only documentation and example env were added).
