# Convex patient profile persistence (incremental)

## What changed

- **Convex** now stores one **`patientProfiles`** row per Convex-backed user (`userId` → `users`), shaped to match the mobile **`UserProfile`** (including optional fields and `accessLog` with `actor`).
- **Queries/mutations** `patientProfile.get` and `patientProfile.replace` enforce auth by checking `passwordHash` on the `users` row (same pattern as login).
- **Mobile** (`AuthContext`): for accounts with **`convexUserId`**, profile **loads from Convex** after a successful session restore on boot, **writes go to Convex** via `replace`, and **AsyncStorage** (`@gluco_guardian_profile`) is kept as a **local cache** (and used when Convex is unreachable on cold start).
- **Legacy** accounts (`convexUserId` absent) are unchanged: profile stays **AsyncStorage-only** (no Convex calls).
- **Migration bridge**: on boot, if Convex has **no** profile but AsyncStorage has a **complete** local profile (`childName`, `dateOfBirth`, `diabetesType`), the app **seeds Convex once** with `replace` and keeps that data.
- **Sign-in (Convex)**: clears local profile cache and loads profile **only from Convex** (no seeding from another user’s cached file).

## Files changed

| File | Change |
|------|--------|
| `convex/schema.ts` | Added `patientProfiles` table + `by_userId` index. |
| `convex/patientProfile.ts` | `get` query, `replace` mutation, shared payload validator. |
| `convex/_generated/api.d.ts` | Registered `patientProfile` module in `fullApi`. |
| `artifacts/mobile/context/AuthContext.tsx` | Convex load/save, cache, migration bridge, `commitProfile`, sign-in profile fetch, ref sync for account/profile. |
| `CONVEX_PROFILE_CHANGE_01.md` | This document. |

## How profile loading/saving works now

### Convex-backed user (`account.convexUserId` set)

1. **Boot** (session restored, `auth.getUser` succeeds): `patientProfile.get` → if present, that object becomes `profile` and is written to AsyncStorage; if absent and local cache is migratable, `patientProfile.replace` seeds from local then keeps it; if absent and no local profile, profile is cleared and `PROFILE_KEY` removed.
2. **Convex sign-in**: `PROFILE_KEY` removed; `get` loads remote profile if any; offline leaves profile empty until network.
3. **`setupProfile` / `updateProfile`** (and flows that use them): `commitProfile` updates React state, AsyncStorage, then **`patientProfile.replace`** (errors ignored for offline).
4. **Access log / codes / doctor enter**: `commitProfile` (or `void commitProfile` for synchronous `enterDoctorMode`) so Convex stays in sync.

### Legacy user (no `convexUserId`)

- Same as before: profile only in **AsyncStorage**; `commitProfile` skips Convex.

## What remains local-only after this change

- **CGM connection** (`@gluco_guardian_cgm`)
- **Food log, insulin log, emergency contacts, alert prefs, guardian PIN, doctor messages**
- **Dexcom / API** usage and **doctor HTTP snapshot** sync (unchanged)
- **Glucose history** (not moved)
- **Account + session** keys in AsyncStorage (unchanged pattern)

## Migration behavior (existing local test data)

- **One-time seed** only when **all** are true: Convex session valid, Convex `get` returns `null`, AsyncStorage profile parses and passes **`isMigratableLocalProfile`** (non-empty `childName` + `dateOfBirth` + valid `diabetesType`).
- **Sign-in** does **not** migrate from stale AsyncStorage (cache is cleared first).
- **Offline boot**: if Convex `get` / migrate throws, the profile **left from the initial AsyncStorage read** is kept (cache fallback).

## Manual verification checklist

- [ ] Deploy or run Convex so `patientProfiles` exists (`npx convex dev` / deploy).
- [ ] **New Convex account**: create account → complete onboarding → kill app → reopen → profile matches (Convex + cache).
- [ ] **Second device / reinstall**: sign in → profile appears from Convex (not empty if you set it up before).
- [ ] **Legacy account** (if you still have one without `convexUserId`): profile still loads/saves locally only.
- [ ] **Migration**: with an existing local profile and empty Convex row, cold start seeds Convex once (check Convex dashboard).
- [ ] **Offline**: turn off network after profile exists; edits still update UI + AsyncStorage; when online, open app or trigger save to reconcile Convex.
- [ ] **Caregiver/doctor codes** and **access log**: generate codes / enter doctor mode → data survives app restart for Convex users.
- [ ] **Doctor sync** still works with current profile fields (no contract change in this task).

## Setup you must perform

1. **Push schema and functions** to your Convex deployment (e.g. `npx convex dev` or `npx convex deploy`) so `patientProfiles`, `get`, and `replace` exist.
2. Ensure **`EXPO_PUBLIC_CONVEX_URL`** is set in the mobile app env (already required for auth).

## Caveats

- Profile reads/writes pass **`passwordHash`** from the client (same tradeoff as existing `auth.login`); this is intentional for the current HTTP-auth client setup.
- **`enterDoctorMode`** calls `void commitProfile` (fire-and-forget); rare failures won’t block entering doctor mode but may leave Convex slightly stale until the next save.
- Partial local profiles (incomplete onboarding) are **not** auto-seeded to Convex; they stay local until complete or until the user saves a full profile.
