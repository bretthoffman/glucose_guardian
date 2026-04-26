# Convex glucose history persistence (incremental)

## What changed

- **Convex** stores patient glucose readings in **`patientGlucoseReadings`** (one document per reading), with index **`by_user_time`** on `["userId", "timestamp"]` for listing and duplicate detection.
- **Functions** (module `patientGlucose`):
  - **`listRecent`** — authenticated query; returns up to **300** readings (cap **500**), **oldest-first** (same ordering as the prior in-memory list).
  - **`upsertBatch`** — inserts readings that do not already exist for that `userId` + `timestamp` (skips duplicates).
  - **`clearAll`** — deletes all readings for the user (used for “clear history” / reset / CGM disconnect flow).
- **Mobile** (`GlucoseContext`): for **`convexUserId`** accounts, after auth finishes loading, a **hydration** pass loads from Convex; **new** readings from **`addReading`** / **`bulkAddReadings`** call **`upsertBatch`** in chunks. **`@gluco_guardian_history`** remains a **cache**; **`@gluco_guardian_settings`** (carb/target/ISF) stays **local-only**.
- **Cross-account safety**: **Convex sign-in**, **createAccount** cleanup, and **logout** now remove **glucose history + settings** keys via shared constants (`artifacts/mobile/constants/storage-keys.ts`) so another user’s cached readings or formula prefs cannot persist on disk after switching accounts. After sign-in, `GlucoseContext` **reloads** settings from storage (or applies **defaults** if the keys were cleared).
- **Migration**: If **`listRecent`** returns **no** rows but **AsyncStorage** still has valid entries, the app **uploads them once** in chunks (`upsertBatch`), then aligns state + cache. If Convex **already** has readings, **Convex is treated as source of truth** for that session (local-only additions while offline are not merged back in this incremental version).

**Unchanged:** Dexcom/Libre HTTP routes and request bodies in `index.tsx`, doctor snapshot shape, profile/CGM Convex modules, auth signup/login.

## Files changed

| File | Change |
|------|--------|
| `convex/schema.ts` | `patientGlucoseReadings` table + `by_user_time` index. |
| `convex/patientGlucose.ts` | New: `listRecent`, `upsertBatch`, `clearAll`. |
| `convex/_generated/api.d.ts` | Registered `patientGlucose` in `fullApi`. |
| `artifacts/mobile/constants/storage-keys.ts` | New: glucose AsyncStorage key exports. |
| `artifacts/mobile/context/GlucoseContext.tsx` | Convex hydrate, flush on add/bulk, clear/reset → `clearAll`, uses storage keys. |
| `artifacts/mobile/context/AuthContext.tsx` | Remove glucose keys on Convex **sign-in**, **createAccount** cleanup, **logout**. |
| `CONVEX_GLUCOSE_CHANGE_01.md` | This document. |

## How glucose history loading/saving works now

### Convex-backed user (`account.convexUserId`)

1. **Initial paint**: AsyncStorage (if present) loads into state so the UI has something immediately.
2. **After `AuthProvider` finishes loading** and the user is signed in: **`listRecent`** runs.  
   - If **any** remote readings → replace in-memory history + rewrite AsyncStorage cache.  
   - If **none** but local cache has readings → **`upsertBatch`** (chunked) to seed Convex, then keep that capped list (**300**).  
   - If **none** and no local cache → empty history + remove history key.
3. **`addReading` / `bulkAddReadings`**: merge/dedupe locally (same as before), update AsyncStorage, then **`upsertBatch`** only **new** timestamps (bulk) or the single new reading.
4. **`clearHistory` / `resetGlucoseData`**: clear local state + AsyncStorage; **`clearAll`** on Convex for that user. **`resetGlucoseData`** also resets formula settings locally (unchanged) and clears Convex readings.

### Legacy user (no `convexUserId`)

- Same local behavior as before; **no** Convex calls.

## What remains local-only after this change

- **Glucose formula settings** (`@gluco_guardian_settings`: carb ratio, target glucose, correction factor)
- **Profile, CGM metadata** (already Convex + cache per prior work)
- **Food log, insulin log, emergency contacts, alert prefs, guardian PIN, doctor messages**
- **Doctor HTTP sync** payload and portal
- **Dexcom/Libre token/session** handling on the API server

## Migration behavior (existing local history)

- Runs only when **`listRecent`** returns **[]** and parsed AsyncStorage has at least one valid entry (`glucose` number + `timestamp` string).
- Chunked upload (120 entries per mutation) to stay within practical payload limits.
- If Convex **already** has data, **local-only** rows that never reached the server may be **dropped** when hydration runs (incremental tradeoff).

## Manual verification checklist

- [ ] Deploy/sync Convex so `patientGlucoseReadings` and `patientGlucose` functions exist.
- [ ] **Convex user**: sync CGM on home tab → readings appear → kill app → reopen → history restored from Convex/cache.
- [ ] **Clear readings** (dashboard) → Convex dashboard shows no readings for that user.
- [ ] **Disconnect CGM** (home) → history clears locally and in Convex (existing product behavior, now server-backed).
- [ ] **New install / second device**: sign in → history loads from Convex.
- [ ] **Legacy account**: readings still behave locally only.
- [ ] **Migration**: clear Convex readings in dashboard, keep local AsyncStorage file (or simulate) → cold start seeds **`upsertBatch`** once.
- [ ] **Sign in as different Convex user**: previous user’s history must not flash (keys cleared on sign-in).

## Setup you must perform

1. **`npx convex dev`** or **`npx convex deploy`** so schema + functions are live.
2. **`EXPO_PUBLIC_CONVEX_URL`** must remain set on the mobile app.

## Caveats

- **`listRecent` / `upsertBatch` / `clearAll`** require **`passwordHash`** on the wire (same pattern as profile/CGM/auth).
- **`upsertBatch`** skips duplicates by **`timestamp` string**; identical timestamps from different sources collapse to one row.
- **`clearAll`** deletes **all** rows for the user in one mutation — fine for the **300**-reading cap but could be heavy if the table ever grows much larger without a retention policy.
- Hydration **does not merge** local and remote when **both** are non-empty; remote wins to keep behavior simple and deterministic.
