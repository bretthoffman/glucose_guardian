# Convex v2 plan — patient-side persistence

Practical, incremental plan based on **current repo code** (`artifacts/mobile`, `convex/schema.ts`). **Recommendations** are explicitly labeled; everything else is **observed** behavior.

---

## 1. Current patient-side local persistence summary

All of the following use **`@react-native-async-storage/async-storage`** unless noted.

### 1.1 `artifacts/mobile/context/AuthContext.tsx`

| Storage key | Constant | What is stored |
|-------------|----------|----------------|
| `@gluco_guardian_account` | `ACCOUNT_KEY` | `UserAccount`: `email`, `passwordHash` (client-side `hashPassword` output). **Single account per install** — `signIn` only reads this one blob. |
| `@gluco_guardian_session` | `SESSION_KEY` | `"true"` when signed in; removed on `signOut` / `logout`. |
| `@gluco_guardian_profile` | `PROFILE_KEY` | Full `UserProfile` JSON (name, DOB, diabetes type, doctor/caregiver codes, access log, etc.). |
| `@gluco_guardian_cgm` | `CGM_KEY` | `CGMConnection`: `type`, `sessionId`, `token`, `outsideUS`, `connectedAt` (vendor session metadata from API proxy — **not** raw Dexcom passwords). |
| `@gluco_guardian_food_log` | `FOOD_LOG_KEY` | Food log array, capped at **200** entries. |
| `@gluco_guardian_insulin_log` | `INSULIN_LOG_KEY` | Insulin log array, capped at **500** entries. |
| `@gluco_guardian_emergency_contacts` | `EMERGENCY_CONTACTS_KEY` | Up to **5** emergency contacts. |
| `@gluco_guardian_alert_prefs` | `ALERT_PREFS_KEY` | `AlertPreferences` (thresholds + notification toggles). |
| `@gluco_guardian_pin` | `GUARDIAN_PIN_KEY` | Guardian PIN string. |
| `@gluco_guardian_doctor_messages` | `DOCTOR_MESSAGES_KEY` | `DoctorMessage[]` for in-app doctor chat state. |

**Observed — not in AsyncStorage (in-memory only):** `caregiverSession`, `doctorSession`, `isGuardianUnlocked` are React state only (`useState`), not persisted across process kill.

**Observed quirk:** `logout`’s `AsyncStorage.multiRemove` (**380–390**) does **not** include `DOCTOR_MESSAGES_KEY`, so doctor messages may survive full logout until overwritten.

### 1.2 `artifacts/mobile/context/GlucoseContext.tsx`

| Storage key | Constant | What is stored |
|-------------|----------|----------------|
| `@gluco_guardian_history` | `STORAGE_KEY` | Glucose history: `GlucoseEntry[]`, capped at **300** points (`slice(-300)`). |
| `@gluco_guardian_settings` | `SETTINGS_KEY` | Bolus-related numbers: `carbRatio`, `targetGlucose`, `correctionFactor` (defaults 15 / 120 / 50). |

**Observed:** `UserProfile` in AuthContext also has optional `carbRatio`, `targetGlucose`, `correctionFactor` fields (`artifacts/mobile/context/AuthContext.tsx` **29–47**). The app therefore has **two places** that can represent formula values (profile vs glucose settings); migration should decide a **single source of truth** or keep both in sync intentionally.

### 1.3 Dexcom / API flow (unchanged for v2)

**Observed:** CGM connect and readings use **`apiUrl`** to `artifacts/api-server` routes (e.g. `artifacts/mobile/app/cgm-setup.tsx`, `artifacts/mobile/app/(tabs)/index.tsx`). That path stays separate from Convex in the near term per product direction.

---

## 2. Recommended Convex v2 scope (smallest practical)

**Goal:** Real multi-device / reinstall recovery for the **core clinical loop**: identity, profile, CGM session metadata, and glucose history.

### In scope for v2 (recommended)

| Area | Why first |
|------|-----------|
| **Users** | Today only one local `UserAccount` exists; Convex enables multiple users and cross-device sign-in with the same credentials (once auth is wired). |
| **Profiles** | Single JSON document matching `UserProfile` (or normalized fields) tied to `userId`. Unlocks onboarding + doctor/caregiver codes in the cloud. |
| **CGM connections** | Losing `sessionId`/`token` on reinstall breaks Dexcom until reconnect; persisting vendor session metadata is high value (secrets still only tokens from your proxy). |
| **Glucose readings** | Largest data volume users care about; today capped at 300 locally only. |

### Defer to v2.1+ unless needed immediately

| Area | Rationale |
|------|-----------|
| **Food log / insulin log** | Large but secondary to CGM chart; doctor snapshot already gets slices via `syncToDoctor`. Can migrate after readings + profile stabilize. |
| **Emergency contacts / alert prefs** | Important UX but smaller than CGM + history; can be one `patientPreferences` blob later. |
| **Guardian PIN** | Security-sensitive; prefer SecureStore + optional server policy later rather than rushing into Convex. |
| **Doctor messages (`DOCTOR_MESSAGES_KEY`)** | Often converges with doctor portal / `doctorPortalState`; avoid duplicating three sources of truth in v2.0. |

**Relationship to v1:** `doctorPortalState` in `convex/schema.ts` remains the **doctor-facing snapshot** keyed by `accessCode`. Patient tables are **`userId`-centric**; `syncToDoctor` can later read from Convex-backed profile/readings instead of only local refs (**future**, not required for v2.0).

---

## 3. Proposed schema (concrete)

Extend **`convex/schema.ts`** (alongside existing `doctorPortalState`). Field lists mirror mobile types unless noted.

### 3.1 `users`

| | |
|--|--|
| **Purpose** | Canonical identity for the patient app (until Clerk). |
| **Fields** | `email` (string, normalized lowercase), `passwordHash` (string — **same algorithm as** `hashPassword` in `AuthContext` for migration), `createdAt`, `updatedAt`. **Recommendation:** add `clerkSubject` optional later for Clerk linking. |
| **Indexes** | `by_email` → `["email"]` (unique lookup). |

### 3.2 `patientProfiles`

| | |
|--|--|
| **Purpose** | One profile row per user; maps to `UserProfile` (including `doctorCode`, `caregiverCode`, `accessLog`, etc.). |
| **Fields** | `userId` (`Id<"users">`), plus either flattened columns or embedded `profileJson` / structured `v.object` mirroring validators you already use for doctor sync (avoid duplicating incompatible shapes). |
| **Indexes** | `by_userId` → `["userId"]` (unique: one profile per user). **Optional:** `by_doctorCode` (sparse) if you need server-side lookup — may duplicate `doctorPortalState`; **recommendation:** defer index until a concrete query needs it. |

### 3.3 `cgmConnections`

| | |
|--|--|
| **Purpose** | Persist `CGMConnection` per user. |
| **Fields** | `userId`, `type`, optional `sessionId`, `token`, `outsideUS`, `connectedAt`, `updatedAt`. |
| **Indexes** | `by_userId` → `["userId"]`. |

### 3.4 `glucoseReadings`

| | |
|--|--|
| **Purpose** | Time-series CGM points aligned with `GlucoseEntry` / doctor sync numeric readings. |
| **Fields** | `userId`, `timestamp` (ISO string or ms), `glucose` (number), `anomaly` (object: `warning`, optional `message`), optional `dexcomTrend` (union number/string). |
| **Indexes** | `by_user_timestamp` → `["userId", "timestamp"]` for range reads and deduplication. |

### 3.5 Optional v2 add-on: `patientGlucoseSettings`

| | |
|--|--|
| **Purpose** | Mirror `@gluco_guardian_settings` if you do **not** want to fold carb/target/ISF into `patientProfiles`. |
| **Fields** | `userId`, `carbRatio`, `targetGlucose`, `correctionFactor`, `updatedAt`. |
| **Indexes** | `by_userId`. |

**Recommendation:** Prefer **one profile document** that includes formula fields **or** explicit `patientGlucoseSettings` — avoid three conflicting stores (profile, glucose context, Convex).

---

## 4. Migration strategy (phased)

### Phase A — Convex schema + auth bridge (no Dexcom change)

| | |
|--|--|
| **Mobile** | Add Convex client dependency; introduce auth flow that yields a **Convex-authenticated session** (see §5). Minimal change: keep `createAccount` / `signIn` UX, but after local validation also create/verify user in Convex. |
| **AsyncStorage** | Still primary source of truth initially; optionally store `convexUserId` or session token. |
| **Dexcom/API** | Unchanged — still `api-server` CGM routes. |
| **Verify** | New user appears in Convex dashboard; signing in on a second simulator/device can load the same `userId` (once reads are wired). |

### Phase B — Profile load/save via Convex

| | |
|--|--|
| **Mobile** | After sign-in, hydrate `profile` from Convex; `updateProfile` / `setupProfile` write through mutations. |
| **AsyncStorage** | Optional offline cache; or write-through cache only. |
| **Dexcom/API** | Unchanged. |
| **Verify** | Edit profile on device A; reinstall app on device B; profile matches after sign-in. |

### Phase C — CGM connection metadata in Convex

| | |
|--|--|
| **Mobile** | On successful connect in `cgm-setup`, persist to Convex; on app start, restore `sessionId`/`token` from Convex before calling readings proxy. |
| **AsyncStorage** | Cache optional. |
| **Dexcom/API** | Same endpoints; only **where** session ids are stored changes. |
| **Verify** | Reinstall app, sign in, CGM sync works without re-entering Dexcom credentials (until vendor session expiry). |

### Phase D — Glucose history in Convex

| | |
|--|--|
| **Mobile** | On `bulkAddReadings` / `addReading`, batch upsert to Convex (with dedup on `userId` + `timestamp`); on launch, paginate recent N points into `GlucoseContext`. |
| **AsyncStorage** | Optional LRU cache for offline; cap as today. |
| **Dexcom/API** | Unchanged fetch path from device to `api-server`. |
| **Verify** | History survives reinstall; doctor `syncToDoctor` still works (may pull from Convex-backed history later). |

### Phase E — Logs, contacts, prefs (optional v2.1)

Migrate food/insulin/emergency/alert prefs in **one** `patientPreferences` document or separate tables once core loop is stable.

---

## 5. Recommended first implementation step (single task)

**Add patient tables to `convex/schema.ts` (`users`, `patientProfiles`, `cgmConnections`, `glucoseReadings`) and introduce a minimal, documented authentication path for the mobile app — preferably Convex’s supported password/email flow (e.g. Convex Auth / `@convex-dev/auth`) that can accept migration from the existing `hashPassword` output, *or* a small `api-server` endpoint that validates the same hash and mints a Convex-compatible session token.**

Then implement **only** `createAccount` + `signIn` → Convex user row creation + login (no profile/CGM/history wiring yet).

**Why this first:** Every other patient mutation needs a **stable `userId`**; doing schema + auth before bulk data avoids rewriting foreign keys. Dexcom and `api-server` stay untouched for this slice.

---

## 6. Clerk timing (re-evaluated)

**Recommendation: Still defer Clerk until after patient v2 auth + at least profile (Phase A–B) are working.**

**Rationale (repo-specific):**

- Mobile auth today is **custom** (`hashPassword` + AsyncStorage). Introducing **Clerk and** Convex patient data in one step couples two migrations and makes failures hard to isolate.
- Convex v2 needs a **durable user key**; that can be Convex Auth/password or email+hash **first**, then **map Clerk `sub` → `users` row** when you adopt Clerk (add nullable `clerkSubject` / migration script).
- Doctor portal already works with access codes and server-side snapshots; Clerk does not unblock v2 patient persistence.

**If Clerk were first:** You would still need Convex schema + sync for profile/history; you would pay Clerk integration cost before proving patient write paths.

---

## Appendix — key file references

| Topic | Path |
|------|------|
| Auth + AsyncStorage keys | `artifacts/mobile/context/AuthContext.tsx` |
| Glucose history + settings | `artifacts/mobile/context/GlucoseContext.tsx` |
| CGM API usage | `artifacts/mobile/app/cgm-setup.tsx`, `artifacts/mobile/app/(tabs)/index.tsx` |
| Existing Convex doctor table | `convex/schema.ts` (`doctorPortalState`) |
| API base URL | `artifacts/mobile/utils/api-base-url.ts` |
