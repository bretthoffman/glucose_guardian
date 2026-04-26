# Convex auth boot fix 01 — recover from stale session / hung restore

## What likely caused the white-screen condition

1. **Convex `getUser` during cold start** could **hang** (no timeout). While `isLoading` stayed `true`, the root **`Stack` still mounted** but navigation effects did not run, which could leave the UI on an **empty initial route** (white screen) instead of `/auth`.
2. On **any** Convex error (including **missing `EXPO_PUBLIC_CONVEX_URL`** or network failure), the previous code used **`catch { setIsSignedIn(true) }`**, which could mark the user signed in without a valid Convex session and produce **inconsistent** `isSignedIn` / `isLoggedIn` / route combinations.
3. **Orphan `SESSION_KEY`** (`"true"` without a stored account) was not cleared.
4. **Corrupt `ACCOUNT_KEY` JSON** could throw inside the load path; the outer `catch {}` swallowed errors without always clearing session flags.

## What was changed

1. **`restoreConvexBackedSession`** (`AuthContext.tsx`): wraps Convex `getUser` in **`Promise.race` with a 10s timeout** so boot cannot wait indefinitely.
2. **Session policy**: Convex-backed accounts only get **`setIsSignedIn(true)`** if `getUser` succeeds; otherwise **`SESSION_KEY` is removed** (user lands on login after load). **Legacy** accounts (no `convexUserId`) still restore without calling Convex.
3. **Orphan session**: if `SESSION_KEY` is set but **`ACCOUNT_KEY` is missing**, the session flag is cleared.
4. **Corrupt account blob**: invalid JSON → **`ACCOUNT_KEY` + `SESSION_KEY` removed**; boot continues.
5. **Top-level load failure**: **`SESSION_KEY` removed** as a safe fallback.
6. **`try` / `finally`**: **`setIsLoading(false)`** always runs when the effect is still mounted (with a **`cancelled`** flag on unmount).
7. **`_layout.tsx`**: while **`isLoading`**, render a **full-screen dark loading view** with a spinner instead of the `Stack`, matching the auth screen background so startup never shows a blank white frame during restore.

## Exact files changed

| File | Change |
|------|--------|
| `artifacts/mobile/context/AuthContext.tsx` | Boot restore timeout, session cleanup, orphan/corrupt handling, `finally` for `isLoading`, cleanup on unmount |
| `artifacts/mobile/app/_layout.tsx` | Loading gate + `ActivityIndicator` until auth bootstrap finishes |
| `CONVEX_AUTH_BOOT_FIX_01.md` | This document |

## How invalid session recovery works now

| Condition | Result |
|-----------|--------|
| Convex user missing / `getUser` returns null | `SESSION_KEY` removed, `isSignedIn` stays false → routing sends user to **`/auth`** |
| Convex call errors, missing URL, or **>10s** timeout | Same as above |
| `SESSION_KEY` without account | `SESSION_KEY` cleared |
| Invalid account JSON | Account + session keys cleared |
| Legacy account (no `convexUserId`) + session | Still signed in locally (no Convex call) |
| Valid Convex session | `isSignedIn` true as before |

**Note:** After a failed Convex restore, **`account` may still be in memory/AsyncStorage** so the login screen can show the last email; the user must **sign in again** to refresh `convexUserId` if needed.

## What was intentionally left unchanged

- `createAccount` / `signIn` / `logout` / Dexcom / `syncToDoctor` / doctor API / Convex doctor snapshot code paths.
- No change to Convex backend functions.
- Notification and tab routing logic beyond the loading gate.

## Manual verification checklist

- [ ] Fresh install: reaches **`/auth`** (no white screen).
- [ ] Valid Convex user + session: reaches **onboarding or tabs** after spinner.
- [ ] Turn off network + cold start with Convex session: after **≤10s**, session clears and **`/auth`** appears (not infinite white).
- [ ] Remove `EXPO_PUBLIC_CONVEX_URL`: Convex-backed session does **not** stay signed in; **`/auth`** after boot.
- [ ] Set `SESSION_KEY` only (no account) in storage: cleared; **`/auth`**.
- [ ] Legacy account (no `convexUserId`) + session: still opens signed in.

## Storage: clear manually?

**Usually not required.** The new boot logic clears **invalid** session flags automatically. Clear app storage only if you want a **completely clean** device state or if you suspect **corrupt keys** beyond account/session (e.g. profile JSON).
