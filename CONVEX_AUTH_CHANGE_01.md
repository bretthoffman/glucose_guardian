# Convex auth change 01 — mobile email/password via Convex

## What changed

- Added a **`users`** table in Convex and **`auth.register`**, **`auth.login`**, **`auth.getUser`** functions. Accounts are created and validated in Convex; the same **client-side `hashPassword`** format as before is stored in Convex for this testing phase.
- Mobile **`createAccount`** calls **`auth.register`** and persists **`convexUserId`** in `AsyncStorage` with email + hash.
- Mobile **`signIn`** calls **`auth.login`** first (works from any device with network). **Legacy fallback:** if Convex is unreachable or returns no user, sign-in still succeeds only for **old local accounts** that have **no** `convexUserId` and match the stored blob (single-device test users).
- On cold start, if the session flag is set and the account has **`convexUserId`**, the app calls **`auth.getUser`**; if the user row was deleted, the session is cleared.
- **`UserAccount`** now includes optional **`convexUserId`**. **`UserProfile`** typing was extended with optional **`carbRatio` / `targetGlucose` / `correctionFactor`** so `syncToDoctor` matches the existing implementation (type-only fix).

**Unchanged:** Dexcom/API routes, doctor routes, doctor portal, doctor Convex snapshot flow, profile/CGM/glucose persistence (still AsyncStorage + `GlucoseContext`).

## Exact files changed

| File | Change |
|------|--------|
| `convex/schema.ts` | Added `users` table + `by_email` index |
| `convex/auth.ts` | **New** — `register`, `login`, `getUser` |
| `convex/_generated/api.d.ts` | Registered `auth` module in `fullApi` |
| `artifacts/mobile/utils/convex-auth-client.ts` | **New** — `EXPO_PUBLIC_CONVEX_URL`, `createConvexAuthClient`, re-export `api` |
| `artifacts/mobile/context/AuthContext.tsx` | Convex-backed create/sign-in/load; `UserAccount` / `UserProfile` updates |
| `artifacts/mobile/app/auth.tsx` | Surface `Error.message` on signup failure (e.g. duplicate email) |
| `artifacts/mobile/package.json` | Added `convex` dependency |
| `artifacts/mobile/.env.example` | **New** — documents `EXPO_PUBLIC_CONVEX_URL` |
| `CONVEX_AUTH_CHANGE_01.md` | **New** — this document |

## New signup / sign-in flow

1. **Create account:** User submits email + password → app computes **`hashPassword(password)`** → **`mutation auth.register`** with `{ email, passwordHash }` → Convex inserts `users` row or throws **`Email already registered`** → app stores `{ email, passwordHash, convexUserId }` + session flag, clears other local keys (same as before).
2. **Sign in:** App computes hash → **`query auth.login`** → on success, stores account + `convexUserId` + session. On failure/offline, **legacy path** only if local account has no `convexUserId` and credentials match.
3. **Session persistence:** Still **`@gluco_guardian_session`** + **`@gluco_guardian_account`** in AsyncStorage; **source of truth for credentials** is Convex for accounts that have `convexUserId`.

## Still local-only after this change

- Profile, CGM connection, glucose history, bolus settings (`GlucoseContext`), food/insulin logs, emergency contacts, alert prefs, guardian PIN, doctor messages — all still **AsyncStorage** (or memory for sessions) as before.
- **`syncToDoctor`** behavior unchanged (still HTTP to `api-server`).

## Environment / setup

1. **Deploy Convex** (or use dev deployment): `pnpm run convex:deploy` from repo root (after `convex dev` link).
2. **Mobile:** Set **`EXPO_PUBLIC_CONVEX_URL`** to your deployment URL (for example `https://your-deployment.convex.cloud`) in **`artifacts/mobile/.env`** (see `.env.example`). Restart Expo with cache clear so the env is bundled.
3. **`EXPO_PUBLIC_API_BASE_URL`** remains required for Dexcom/doctor HTTP as in prior changes.

## Migration caveats for existing test users

| Situation | What to do |
|-----------|------------|
| Account **without** `convexUserId` (created before this change) | **Sign in** still works **offline-style** only on that device via legacy path, or after a failed Convex login with matching local storage. **Other devices** will not see that user until you **create account** in Convex (same email) — **`register` will fail** with duplicate if you already migrated manually; then use **sign in** only. |
| Simplest path for old testers | **Sign up again** with a **new email**, or clear app storage and register (if email not yet in Convex). |
| Email already in Convex | Use **Sign in** (not create). |

## Manual verification checklist

- [ ] `EXPO_PUBLIC_CONVEX_URL` set; Convex dashboard shows **`users`** table after signup.
- [ ] **Create account** with new email → row appears in Convex; app reaches onboarding.
- [ ] **Sign out**, **Sign in** with same credentials → success.
- [ ] Second device/simulator: **Sign in** only (no prior AsyncStorage) → success.
- [ ] Duplicate **Create account** → alert shows **Email already registered** (or Convex error text).
- [ ] Dexcom connect + sync still work (API URL unchanged).
- [ ] Doctor portal still loads patient data after mobile **syncToDoctor** (unchanged server contract).

## Caveat: offline sign-in

**Convex-backed** accounts (`convexUserId` set) require a successful **`auth.login`** call; if the device is offline, sign-in fails even if email/password are correct (legacy offline path only applies when **`convexUserId` is absent**).
