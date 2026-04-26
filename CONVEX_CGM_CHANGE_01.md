# Convex CGM connection metadata persistence (incremental)

## What changed

- **Convex** now stores at most one **`patientCgmConnections`** row per Convex-backed user: `type` (`dexcom` | `libre`), optional `sessionId`, `token`, `outsideUS`, `connectedAt`, plus `updatedAt`. **Disconnected** state is represented by **no row** (not a null `type` in the database).
- **Functions** (module `patientCgm`):
  - **`get`** — returns connection fields or `null` if disconnected / missing row (after `passwordHash` check on `users`).
  - **`replace`** — upsert when the user connects or updates metadata (`type` must be `dexcom` or `libre`).
  - **`clear`** — deletes the row (disconnect).
- **Mobile** (`AuthContext`): for accounts with **`convexUserId`**, CGM metadata **loads from Convex** after a successful session restore (same `try` as profile rehydration), **`setCGMConnection`** writes through **`commitCGMConnection`** (AsyncStorage + Convex `replace` or `clear`), and **AsyncStorage** (`@gluco_guardian_cgm`) remains a **cache** / offline fallback.
- **Legacy** accounts (no `convexUserId`): CGM stays **AsyncStorage-only**; Convex is not called.
- **Migration bridge**: on boot, if Convex returns **no** CGM row but local storage has a **connected** CGM (`type === "dexcom"` or `"libre"`), the app **calls `replace` once** to seed Convex, then refreshes the cache.
- **Convex sign-in**: clears local CGM cache, resets in-memory CGM to disconnected, then loads from **`patientCgm.get`** when online (same pattern as clearing stale profile data).

**Unchanged:** Dexcom/Libre HTTP routes on the API server, reading/sync logic in `index.tsx` / `cgm-setup.tsx`, glucose history, doctor sync, auth signup/login shape.

## Files changed

| File | Change |
|------|--------|
| `convex/schema.ts` | Added `patientCgmConnections` table + `by_userId` index. |
| `convex/patientCgm.ts` | New: `get`, `replace`, `clear`, `cgmConnectionPayload` validator. |
| `convex/_generated/api.d.ts` | Registered `patientCgm` in `fullApi`. |
| `artifacts/mobile/context/AuthContext.tsx` | `commitCGMConnection`, boot + sign-in Convex CGM hydration, migration, `setCGMConnection` → commit. |
| `CONVEX_CGM_CHANGE_01.md` | This document. |

## How CGM loading/saving works now

### Convex-backed user

1. **Cold boot** (session valid): After `patientProfile` rehydration in the same `try`, the app calls **`patientCgm.get`**. If present → state + AsyncStorage; if absent and local cache is **migratable** (`type` dexcom/libre) → **`replace`** then cache; if absent and not migratable → **`{ type: null }`** and **remove `CGM_KEY`**. If the whole `try` fails (e.g. offline), the earlier AsyncStorage read is left as-is.
2. **Convex sign-in**: Removes **`CGM_KEY`**, sets **`{ type: null }`**, then **`get`** and cache when data exists.
3. **`setCGMConnection`**: Updates state and AsyncStorage; if `type === null`, **`patientCgm.clear`**; else **`patientCgm.replace`** with the current metadata (tokens/session IDs unchanged from the client’s perspective).

### Legacy user

- Same as before: only AsyncStorage; **`commitCGMConnection`** returns after the local write.

## What remains local-only after this change

- **Profile** still uses Convex + cache (previous change).
- **Food log, insulin log, emergency contacts, alert prefs, guardian PIN, doctor messages**
- **Glucose readings history** (not moved)
- **Doctor HTTP snapshot** contract and portal
- **Account + session** keys in AsyncStorage

## Migration behavior (existing local CGM metadata)

- **One-time seed** when: Convex session is valid, **`get`** returns `null`, and parsed AsyncStorage has **`type`** `dexcom` or `libre`.
- **Sign-in** does **not** migrate from another user’s cache (cache is cleared before **`get`**).
- **Offline boot**: if Convex `try` fails, the initial AsyncStorage hydration for CGM is kept.

## Manual verification checklist

- [ ] Deploy/sync Convex (`npx convex dev` / `deploy`) so `patientCgmConnections` and `patientCgm` functions exist.
- [ ] **Connect Dexcom or Libre** on a Convex account → kill app → reopen → connection still shows (Convex + cache).
- [ ] **Disconnect** → row removed in Convex / state `type: null` → restart → stays disconnected.
- [ ] **Second device / reinstall**: sign in → CGM metadata appears from Convex if previously saved.
- [ ] **Legacy account** (no `convexUserId`): connect/disconnect still works with AsyncStorage only.
- [ ] **Migration**: with a prior local connected CGM and empty Convex row, cold start seeds **`replace`** once (verify in Convex dashboard).
- [ ] **Offline**: with data already cached, turning off network should still show last cached CGM; reconnect Convex when online to reconcile.
- [ ] **Readings fetch** from `/api/cgm/dexcom/readings` or `/api/cgm/libre/readings` still uses `sessionId` / `token` from context (no route change).

## Setup you must perform

1. **Push schema and functions** to your Convex deployment so `patientCgm` is available.
2. **`EXPO_PUBLIC_CONVEX_URL`** must remain set for the mobile app.

## Caveats

- **`get` / `replace` / `clear`** take **`passwordHash`** from the client (same tradeoff as auth and profile).
- **Tokens/session IDs** are stored in Convex as opaque metadata; they are **not** a substitute for server-side Dexcom secrets—this matches “metadata only,” not moving API implementation.
- If **`patientProfile` Convex calls throw** before the CGM block in the shared `try`, CGM rehydration for that boot is skipped and the **offline** path applies only if the outer `catch` runs—normally both run together when the network is fine.
