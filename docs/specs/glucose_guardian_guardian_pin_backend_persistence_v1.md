# Glucose Guardian — Guardian PIN Backend Persistence (v1)

## Summary

Guardian Mode previously stored the four-digit PIN as **plaintext in AsyncStorage only** (`@gluco_guardian_pin`). There was **no Convex table or API** for PIN verification. This caused known PINs to fail after sign-in, device change, reinstall, or logout — while Guardian protection still appeared required for minor profiles.

This spec documents the backend-authoritative PIN architecture introduced on branch `feature/dark-clinical-ui`.

---

## Previous failure mode

| Symptom | Cause |
|--------|--------|
| Known PIN no longer works | PIN lived only in local AsyncStorage; not loaded/synced from Convex |
| No PIN row in Convex dashboard | PIN was never persisted server-side |
| Cross-device failure | New device has no AsyncStorage PIN blob |
| Sign-in / logout edge cases | `logout()` clears `@gluco_guardian_pin`; sign-in does not restore from cloud |

Verification was client-side string equality against in-memory `guardianPin` (`AuthContext.unlockGuardian`).

---

## Root cause

**Local-only, plaintext PIN storage** with no durable backend verifier tied to the authenticated patient account (`users` row).

---

## Authoritative PIN owner

**One Guardian PIN per Convex patient account** (`users._id`).

- Scope: authenticated **account owner** (parent/adult signed in with `userId` + `passwordHash`)
- Not per device, not per caregiver relationship, not per `patientProfiles` row (though profiles are 1:1 with users today)
- Caregivers with a caregiver code **cannot** set, reset, or verify the owner PIN (they lack `passwordHash`)

---

## Data model

Table: `patientGuardianPins`

| Field | Type | Client visible |
|-------|------|----------------|
| `userId` | `Id<"users">` | No (implicit via auth) |
| `pinHash` | string (base64 scrypt) | **Never** |
| `pinSalt` | string (base64) | **Never** |
| `hashVersion` | number | No |
| `state` | `"active"` | Safe status only via query |
| `failedAttempts` | number | No |
| `lastFailedAt` | number? | No |
| `lockoutUntil` | number? | Remaining ms via safe status when locked |
| `createdAt` / `updatedAt` | number | No |
| `migrationMarker` | string? | No (sanitized internal marker) |

Index: `by_userId` (unique row per user)

**Public safe states** (`patientGuardianPin.getStatus`):

- `not_set` — no active verifier (setup required)
- `active` — PIN configured
- `temporarily_locked` — includes `lockoutRemainingMs`
- `unauthorized` — invalid account credentials

---

## Hash / verifier method

- **Algorithm:** Node `crypto.scrypt` (Convex `"use node"` action runtime)
- **Parameters:** N=16384, r=8, p=1, keylen=32 (see `convex/guardianPin/config.ts`)
- **Salt:** 16 random bytes per PIN (unique per row)
- **Comparison:** `timingSafeEqual` on derived key
- **Version:** `hashVersion: 1`
- **No new npm dependencies**

Raw PIN is hashed only inside `patientGuardianPinActions` (Node actions). Never written to DB, logs, or API responses.

---

## Client / server boundaries

| Operation | Client | Server |
|-----------|--------|--------|
| PIN format check | Optional pre-check (`^\d{4}$`) | Authoritative in actions |
| Setup | `setupGuardianPin(pin, confirm)` → action | `patientGuardianPinActions.setupPin` |
| Verify / unlock | `verifyGuardianPin` / `unlockGuardian` → action | `patientGuardianPinActions.verifyPin` |
| Status | `refreshGuardianPinStatus` → query | `patientGuardianPin.getStatus` |
| Change PIN | (future UI) | `patientGuardianPinActions.changePin` |
| Unlock session | `isGuardianUnlocked` in React state only | Not persisted |

Auth on all server paths: existing `userId` + `passwordHash` pattern (same as profile/CGM/glucose modules).

---

## Rate limiting / lockout

Configured in `convex/guardianPin/config.ts`:

- **MAX_FAILED_ATTEMPTS:** 5
- **LOCKOUT_MS:** 15 minutes

Behavior:

- Failed verify increments `failedAttempts`
- At threshold, sets `lockoutUntil`
- Successful verify resets failures and lockout
- Lockout is temporary (not permanent account lock)
- Generic client errors (`Incorrect PIN`, `Too many attempts`) — no PIN existence leak

---

## Setup flow

1. Authenticated owner enters 4-digit PIN + confirmation (onboarding or Dashboard “Set Guardian PIN”)
2. Client calls `setupGuardianPin` → Convex action
3. Server validates format, match, and authorization
4. If no row or legacy recovery: persist scrypt hash
5. If active PIN already exists: `already_active` (must use `changePin` with current PIN)
6. On success: client clears legacy AsyncStorage key `@gluco_guardian_pin`
7. Raw PIN cleared from component state after completion

**UI entry points:**

- Onboarding `guardian_pin` step (minor profiles)
- Dashboard “Set Guardian PIN” card when `guardianPinStatus === "not_set"`

---

## Verification flow

1. User enters 4 digits in Guardian modal
2. Client calls `verifyGuardianPin` (async)
3. Server verifies scrypt hash; applies lockout policy
4. On `verified`: client sets `isGuardianUnlocked = true` (session-only)
5. Protected settings remain gated by existing `isGuarded` logic

Unlock duration: **until Lock tapped or sign-out** (unchanged session semantics).

---

## Legacy existing-account recovery

Accounts with Guardian UI expectations but **no** `patientGuardianPins` row:

- `getStatus` → `not_set`
- Verify → `setup_required` (not “invalid old PIN”)
- Owner sees **Set Guardian PIN** — no impossible old-PIN prompt
- Legacy AsyncStorage plaintext is **not** auto-uploaded
- After successful backend setup, local key is removed

Malformed/incomplete rows (missing hash/salt): setup allowed with `migrationMarker: "legacy_recovery_setup"`.

---

## Authorization for PIN setup / reset

| Actor | Setup | Reset / change |
|-------|-------|----------------|
| Signed-in account owner (`passwordHash`) | Yes | Yes (`changePin` + current PIN) |
| Caregiver session | No | No |
| Doctor session | No | No |
| Device possession alone | No | No |

No “Forgot PIN?” for restricted guardians.

---

## Sign-out behavior

- **Clears:** `isGuardianUnlocked` (temporary unlock)
- **Preserves:** backend PIN verifier
- **Does not clear:** `@gluco_guardian_account` / session (sign-out only removes session flag)
- **logout():** clears local storage including legacy PIN key (full local wipe)

---

## Local storage behavior

| Key | After this change |
|-----|-------------------|
| `@gluco_guardian_pin` | Deprecated; removed on successful backend setup; not source of truth |
| `isGuardianUnlocked` | React state only |
| Plaintext PIN in React state | Removed — no `guardianPin` string in context |

Legacy single-device accounts without `convexUserId` retain minimal local fallback until cloud sign-in (documented limitation).

---

## Security / privacy boundaries

- Plaintext PIN never in Convex, logs, analytics, or client-readable queries
- Hash/salt only in internal queries / DB
- Caregiver code auth cannot access PIN mutations
- Cross-account isolation enforced by `userId` + `passwordHash`

---

## Deployment steps (operator)

1. Review diff on `feature/dark-clinical-ui`
2. Run `npx convex codegen` and `pnpm test -- convex/patientGuardianPin.test.ts`
3. Deploy Convex schema + functions: `npx convex deploy` (operator action — **not run in this change**)
4. Ship mobile app build pointing at deployed Convex
5. Existing users: first signed-in owner session prompts **Set Guardian PIN** if `not_set`

---

## Migration / lazy recovery

- **No live migration** of old PIN values (impossible without plaintext)
- **Lazy recovery:** first owner setup on each account creates row
- No batch job required

---

## Operational verification (post-deploy)

1. Sign in as owner with minor profile, no PIN row → Dashboard shows Set Guardian PIN
2. Set PIN `0042` → status `active`, unlock works
3. Sign out → unlock cleared; sign in on same device → verify `0042` works
4. Wrong PIN 5× → temporary lockout message
5. Convex dashboard: `patientGuardianPins` has hash/salt, not plaintext

---

## Rollback

1. Revert Convex deploy to prior functions/schema (table can remain orphaned)
2. Revert mobile to prior build (local PIN behavior returns — not recommended)

---

## Known limitations

- Legacy offline-only accounts (no `convexUserId`) still use deprecated local PIN until cloud sign-in
- `changePin` action exists; dedicated Change PIN UI not added in this pass
- Account password hashing remains legacy client-side scheme (separate from PIN work)
- Live production verification not performed in this implementation session

---

## Deferred work

- Dedicated Change PIN settings UI
- Clerk / Convex Auth migration for account password (replace client `passwordHash` transport)
- Optional PIN setup reminder push notification
- Admin support tooling for lockout reset (requires stronger identity proof)

---

## Files (implementation)

- `convex/schema.ts` — `patientGuardianPins` table
- `convex/patientGuardianPin.ts` — safe status query
- `convex/patientGuardianPinActions.ts` — setup / verify / change actions
- `convex/guardianPin/*` — config, validate, hash, internal mutations
- `convex/patientGuardianPin.test.ts` — automated tests
- `artifacts/mobile/context/AuthContext.tsx` — client integration
- `artifacts/mobile/app/(tabs)/dashboard.tsx` — setup + async verify UI
- `artifacts/mobile/app/onboarding.tsx` — backend setup on onboarding
