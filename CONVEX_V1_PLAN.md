# Convex v1 plan — simplest practical MVP (Glucose Guardian)

This document is a **migration plan** based on **observed code** in this repo. Sections labeled **Recommendation** are not yet implemented.

---

## 1. Current state summary

### 1.1 User / account state (local-only)

**Observed:** The patient app keeps authentication and profile data on-device via `AsyncStorage` in `artifacts/mobile/context/AuthContext.tsx`.

- **Account:** `UserAccount` (`email`, `passwordHash`) under key `@gluco_guardian_account`. `createAccount` and `signIn` read/write only this stored account; `signIn` compares against the **single** stored record (`artifacts/mobile/context/AuthContext.tsx`, `createAccount` / `signIn`). There is **no server-side user directory** — **true multi-user support across devices or multiple accounts per device is not implemented**; at most one account blob per install.
- **Session flag:** `@gluco_guardian_session` (`"true"` when signed in).
- **Profile:** Full `UserProfile` (name, diabetes type, DOB, doctor/caregiver codes, etc.) under `@gluco_guardian_profile`.
- **Other auth-adjacent local state in the same file:** food log, insulin log, emergency contacts, alert preferences, guardian PIN, CGM connection JSON, doctor messages (`@gluco_guardian_doctor_messages`).

**Recommendation (implicit goal):** Convex v1 should introduce a **real** multi-user identity and per-user rows, even if the mobile app still uses a simple email/password flow initially (without Clerk).

### 1.2 Glucose / history state (local-only)

**Observed:** `artifacts/mobile/context/GlucoseContext.tsx` stores:

- **History:** up to **300** readings in `@gluco_guardian_history` (`addReading`, `bulkAddReadings`).
- **Bolus wizard settings:** carb ratio, target glucose, correction factor in `@gluco_guardian_settings`.

The home tab fetches CGM points from the API (`/api/cgm/dexcom/readings` or `/api/cgm/libre/readings` via `apiUrl` in `artifacts/mobile/app/(tabs)/index.tsx`) and then **merges them into local state** with `bulkAddReadings` — persistence is **AsyncStorage only**, not the API’s `/api/glucose` routes.

**Observed:** `lib/api-client-react` defines `/api/glucose` clients, but **the mobile app does not call those endpoints** (grep shows no mobile usage; glucose HTTP usage is documented as in-memory in `PROJECT_AUDIT.md`).

### 1.3 CGM connection state (local-only)

**Observed:** After a successful connect, `artifacts/mobile/app/cgm-setup.tsx` calls `setCGMConnection` with `sessionId` / `token` / `outsideUS` / `connectedAt`. `setCGMConnection` persists to `@gluco_guardian_cgm` (`artifacts/mobile/context/AuthContext.tsx`).

**Observed:** Dexcom/Libre **credentials are not stored**; only vendor session identifiers returned by the proxy are stored locally.

**Observed:** The **Dexcom/Libre proxy** lives in `artifacts/api-server/internal/routes/cgm.ts` (outbound calls to Dexcom Share / Libre APIs).

### 1.4 Doctor portal — what it depends on

**Observed:** The doctor portal (`artifacts/doctor-portal`) uses `@workspace/api-client-react` with **relative** paths such as `/api/doctor/login`, `/api/doctor/patient/:accessCode`, `/api/doctor/messages/:accessCode` (`lib/api-client-react/src/generated/api.ts`). Browser `fetch` resolves those against the **portal’s own origin** unless something else rewrites them (the Vite config in `artifacts/doctor-portal/vite.config.ts` has **no dev proxy** to the API).

**Observed:** Doctor **session** is only `sessionStorage` keys `gg_doc_access_code` / `gg_doc_patient_name` (`artifacts/doctor-portal/src/hooks/use-auth.ts`).

**Observed:** Patient data shown in the portal comes from **GET** `/api/doctor/patient/:accessCode`, backed by an **in-memory** `Map` in `artifacts/api-server/internal/routes/doctor.ts` (`patientStore`, `messagesStore`), seeded with a `DEMO` patient. **Mobile** pushes snapshots via **POST** `/api/doctor/sync` (`artifacts/mobile/context/AuthContext.tsx`, `syncToDoctor`), using the same payload shape as `PatientSnapshot` in the doctor route file.

**Important operational fact (recommendation to validate on your deployment):** In-memory maps **do not survive** API process restarts (e.g. serverless cold starts). That can make the portal look “empty” even after a successful patient sync until the patient syncs again — a strong motivator for a real database such as Convex.

### 1.5 What the current API must keep doing (for now)

**Observed — still required for the current mobile app:**

| Area | Routes / behavior | Location |
|------|-------------------|----------|
| CGM proxy | `POST /api/cgm/dexcom/connect`, readings; Libre equivalents | `artifacts/api-server/internal/routes/cgm.ts` |
| Doctor sync | `POST /api/doctor/sync` | `artifacts/api-server/internal/routes/doctor.ts` |
| Chat | `POST /api/chat` (mobile) | `artifacts/mobile/app/(tabs)/chat.tsx` |
| Food / insulin assist | `/api/insulin/predict`, `/api/food/estimate`, `/api/food/analyze-photo` | `artifacts/mobile/app/(tabs)/food.tsx` |
| Doctor portal | `/api/doctor/login`, `GET /api/doctor/patient/:code`, messages | `doctor.ts` + `lib/api-client-react` |

**Recommendation:** Keep **CGM and AI/chat/food** routes on the existing Node API for v1; **persist** doctor snapshots (and later glucose) via Convex, optionally still accepting the **same HTTP contracts** from mobile and portal during transition.

---

## 2. Recommended Convex v1 scope (minimal)

**Goal:** Smallest Convex surface that supports:

1. **Multiple users** (distinct identities and rows; not one blob per phone).
2. **Saved profile per user** (equivalent to `UserProfile` fields the app already uses).
3. **Saved CGM connection metadata per user** (type, `sessionId` / `token`, `outsideUS`, timestamps — **not** raw Dexcom passwords).
4. **Saved glucose history per user** (time-series; align with `GlucoseEntry` / sync snapshot fields).
5. **Doctor access linkage per user** (`doctorCode` / stable lookup for portal).

**In scope for v1 if easy to ship with the same migration:**

- **Doctor snapshot document** keyed by `accessCode` so the existing portal can keep calling **the same REST shape** while the API **reads/writes Convex** (bridge pattern).

**Explicitly out of scope for this plan (per product direction):**

- Clerk, full auth overhaul.
- Replacing Dexcom/Libre proxy logic (keep `api-server` CGM routes).
- Large portal redesign.
- Insulin/food logs in Convex **unless** needed for portal parity (portal already expects insulin/food in the snapshot — can remain **denormalized on the snapshot** for v1).

---

## 3. Proposed Convex schema (concrete)

Convex uses tables (collections) with documents. Below, `v` types are **illustrative** — implement with `convex/schema.ts` validators.

### 3.1 `users`

| | |
|--|--|
| **Purpose** | Canonical user row; ties all per-user data together. |
| **Key fields** | `email` (string, lowercased), `passwordHash` (string, optional after Clerk), `createdAt`, `updatedAt` |
| **Relationships** | 1:1 with `profiles` (or merge profile into this doc if you want fewer tables — **recommendation:** separate `profiles` for clarity). |
| **Indexes** | `by_email` → `["email"]` (unique lookup for login). |

**Note:** Storing `passwordHash` in Convex is a **short-term bridge** matching today’s client-side hash (`artifacts/mobile/context/AuthContext.tsx`, `hashPassword`). **Recommendation:** Treat as **legacy**; plan to remove when Clerk (or Convex Auth) arrives.

### 3.2 `profiles`

| | |
|--|--|
| **Purpose** | Patient-facing profile and access codes (mirrors `UserProfile`). |
| **Key fields** | `userId` (Id<"users">), plus fields aligned with `UserProfile`: e.g. `childName`, `parentName`, `accountRole`, `diabetesType`, `dateOfBirth`, `weightLbs`, doctor/caregiver metadata, `childModeEnabled`, `caregiverCode`, `caregiverCodeIssuedAt`, `doctorCode`, `doctorCodeIssuedAt`, `accessLog` (array or separate table later). |
| **Relationships** | Many profiles could exist per user in theory; **v1:** enforce one profile per `userId` in application logic. |
| **Indexes** | `by_userId` → `["userId"]`; `by_doctorCode` → `["doctorCode"]` (sparse / optional string for portal lookup). |

### 3.3 `cgmConnections`

| | |
|--|--|
| **Purpose** | Persist vendor session state per user (mirrors `CGMConnection`). |
| **Key fields** | `userId`, `type` (`"dexcom"` \| `"libre"` \| null), `sessionId`, `token`, `outsideUS`, `connectedAt`, `updatedAt`. |
| **Relationships** | One active connection per user for v1 (overwrite on connect). |
| **Indexes** | `by_userId` → `["userId"]`. |

### 3.4 `glucoseReadings`

| | |
|--|--|
| **Purpose** | Append-only (or upsert) CGM readings for charts and history. |
| **Key fields** | `userId`, `timestamp` (ISO string or ms number — pick one and stick to it), `glucose` (number), `anomaly` (object), `dexcomTrend` (optional), optional `source` (`"dexcom"` / `"libre"`). |
| **Relationships** | Many readings per `userId`. |
| **Indexes** | `by_user_timestamp` → `["userId", "timestamp"]` for range queries and deduplication. |

**Recommendation:** Enforce idempotency in mutations (e.g. skip insert if same `userId` + `timestamp` exists) to match current `bulkAddReadings` dedup behavior.

### 3.5 `doctorPatientSnapshots` (bridge for portal)

| | |
|--|--|
| **Purpose** | Store the **latest** denormalized payload the doctor portal expects (same conceptual shape as `PatientSnapshot` in `artifacts/api-server/internal/routes/doctor.ts`), keyed by **uppercased** `accessCode`. |
| **Key fields** | `accessCode`, `profile` (object), `glucoseReadings` (array), `insulinLog`, `foodLog`, `messages`, `alertPreferences`, `syncedAt`. Optional `userId` to link back to patient. |
| **Relationships** | Optional `userId` for joins; portal primarily uses `accessCode`. |
| **Indexes** | `by_accessCode` → `["accessCode"]` (unique). |

**Recommendation:** This table is the **fastest** way to keep `GET /api/doctor/patient/:code` semantically stable while moving storage off the in-memory `Map`.

### 3.6 Optional v1 tables (defer unless needed immediately)

- **`doctorMessages` separate store** — only if you outgrow embedding messages in `doctorPatientSnapshots`; current server merges messages in `doctor.ts` and can stay embedded for v1.
- **`insulinLogs` / `foodLogs` as first-class tables** — defer if the portal continues to consume them only via the snapshot.

---

## 4. Migration strategy (incremental phases)

Each phase should be shippable and testable without a big-bang.

### Phase A — Convex foundation + doctor data durability (mobile unchanged)

| Area | Change |
|------|--------|
| **Mobile** | No change. |
| **api-server** | On `POST /api/doctor/sync` and message routes, **persist** to Convex (`doctorPatientSnapshots` + message merge rules equivalent to `doctor.ts` today). On `GET /api/doctor/patient/:code`, **read** from Convex. |
| **AsyncStorage** | Unchanged. |
| **Verify** | Restart / cold-start the API; portal still shows last synced data for a real access code. Demo `DEMO` code either seeded in Convex or kept as special-case. |

### Phase B — Register / sign-in against Convex (still no Clerk)

| Area | Change |
|------|--------|
| **Mobile** | Replace or augment `createAccount` / `signIn` to call Convex mutations (email + password hash). Store returned Convex `userId` (or session token strategy you choose) locally. |
| **AsyncStorage** | Keep as cache; optionally store `convexUserId` / session. |
| **api-server** | Unchanged for CGM/food/chat. |
| **Verify** | Two distinct emails can exist in Convex; signing in on a second device can load the same profile (once load path exists). |

### Phase C — Profile + CGM metadata in Convex

| Area | Change |
|------|--------|
| **Mobile** | Load/save `profiles` and `cgmConnections` via Convex on session start and after connect/disconnect. |
| **AsyncStorage** | Optional offline cache only; single source of truth is Convex. |
| **api-server** | CGM proxy still used for connect/readings. |
| **Verify** | Reinstall app, sign in, profile and CGM session fields reappear. |

### Phase D — Glucose history in Convex

| Area | Change |
|------|--------|
| **Mobile** | After `bulkAddReadings`, write batches to Convex; on app start, hydrate from Convex (with cap e.g. 300–1000 recent points). |
| **AsyncStorage** | Optional cache for offline; can remain temporarily for resilience. |
| **api-server** | Unchanged. |
| **Verify** | History survives app delete + reinstall if user signs back in (once Phase B/C auth works). |

### Phase E — Tighten doctor linkage

| Area | Change |
|------|--------|
| **Mobile** | Ensure `syncToDoctor` uses `doctorCode` from Convex-backed profile; snapshot includes Convex-backed glucose. |
| **Doctor portal** | Still HTTP; backend reads Convex. |
| **Verify** | Portal chart matches patient app after sync. |

---

## 5. Recommended first Convex implementation step (single task)

**After plan review, do one thing:**

> **Add a Convex project to the repo (e.g. `convex/schema.ts` + deploy), define `doctorPatientSnapshots` (and minimal indexes), then change `artifacts/api-server/internal/routes/doctor.ts` to read/write that table via the Convex HTTP client (admin/deploy key on the server) instead of `patientStore` / `messagesStore` Maps — preserving the same JSON shapes and merge behavior for messages.**

**Why this first:**

- **Zero mobile changes** in the first PR.
- Fixes the **ephemeral doctor data** problem on serverless.
- Validates Convex in **production** with the existing `syncToDoctor` and doctor portal polling.
- Does not touch Dexcom proxy or auth complexity yet.

---

## 6. Doctor portal during transition

**Observed:** Portal uses relative `/api/doctor/*` URLs and sessionStorage for the access code.

**Recommendation (practical, minimal):**

1. **Keep the doctor portal’s HTTP contract** (`lib/api-client-react` paths unchanged).
2. **Move storage** behind `artifacts/api-server/internal/routes/doctor.ts` to Convex (Phase A).
3. **Deployment:** Ensure the browser’s requests to `/api/doctor/*` still reach the same API deployment that holds the Convex credentials (same origin, reverse proxy, or explicit API base URL if you later add one to the generated client — **not required for v1** if portal and API are co-located as today).

**Recommendation:** Avoid rewriting portal panels until patient data is stable in Convex.

---

## 7. Clerk timing recommendation

**Recommendation: After Convex v1 persistence is working for at least doctor snapshots + one of (profiles, glucose).**

**Rationale (specific to this codebase):**

- Today’s auth is **local-only** (`AsyncStorage` + simple hash). Replacing it with **Clerk and Convex at once** couples two migrations and makes debugging harder.
- Convex needs a **stable user id** for rows; you can use a **temporary** email/password or device bootstrap, then **map Clerk `sub` → `users` row** later.
- Doctor portal does **not** use Clerk today — it uses access codes. Clerk can wait until patient identity is in Convex.

**If Clerk were first:** You’d still need a persistence layer for profiles/glucose; you’d pay integration cost without fixing the in-memory doctor store.

---

## Appendix: Key file references

| Topic | Path |
|------|------|
| Patient auth + AsyncStorage keys | `artifacts/mobile/context/AuthContext.tsx` |
| Glucose local persistence | `artifacts/mobile/context/GlucoseContext.tsx` |
| CGM connect + API | `artifacts/mobile/app/cgm-setup.tsx`, `artifacts/api-server/internal/routes/cgm.ts` |
| CGM sync into history | `artifacts/mobile/app/(tabs)/index.tsx` |
| Doctor sync payload | `artifacts/mobile/context/AuthContext.tsx` (`syncToDoctor`) |
| Doctor API + in-memory store | `artifacts/api-server/internal/routes/doctor.ts` |
| Portal patient fetch | `artifacts/doctor-portal/src/pages/dashboard.tsx` |
| Portal API paths | `lib/api-client-react/src/generated/api.ts` |
| Mobile API base URL | `artifacts/mobile/utils/api-base-url.ts` |
