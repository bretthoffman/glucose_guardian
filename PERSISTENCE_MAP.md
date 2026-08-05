# Gluco Guardian — Persistence Ground Truth

Read-only analysis. No files modified, no mutations, no deploys. Every claim below is from code; where a comment contradicts the code, the code wins. Contested items were re-verified against source during this pass (`signOut`/`logout` bodies, the exhaustive `AsyncStorage` write/remove sweep, the `DOCTOR_MESSAGES_KEY`/`THERAPY_PROPOSAL_KEY` reference set, `SecureStore` usage, doctor-route middleware, credential schema).

**Path legend** — all absolute, abbreviated in tables for width:

| Abbrev | Absolute path |
|---|---|
| `AC` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/context/AuthContext.tsx` |
| `GC` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/context/GlucoseContext.tsx` |
| `PC` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/context/PushContext.tsx` |
| `TC` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/context/ThemeContext.tsx` |
| `MC` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/context/MessagesContext.tsx` |
| `DASH` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/app/(tabs)/dashboard.tsx` |
| `KEYS` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/constants/storage-keys.ts` |
| `DOCROUTE` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/api-server/internal/routes/doctor.ts` |
| `SCHEMA` | `/Users/bretthoffman/Documents/Gluco-Guardian/convex/schema.ts` |

Other paths given in full.

---

## 1. THE TABLE

### 1A. Device-only (AsyncStorage / SecureStore — never reaches Convex)

| What | Where exactly | Reinst. | Cross-dev | Cleared on acct switch | file:line |
|---|---|---|---|---|---|
| Signed-in session flag | `@gluco_guardian_session` | No | No | **Yes** | AC:1541 (write); AC:933, 1072, 1089, 1806, 2165 (remove) |
| Care-circle memberships cache (anchor id, names, permissions) | `@gluco_guardian_care_memberships` | No | No | **Yes** (incl. signOut) | AC:1173, 2514; removed AC:1806, 1545, 1690, 2168 |
| Access-code session (`{code, kind, role, permissions}`) | `@gluco_guardian_caregiver_code` — plaintext live credential | No | No | **Yes** | AC:2392, 843, 2420; removed AC:752, 758, 779, 1543, 1689, 1806, 2167, 2445 |
| Device-only alert toggles: `notificationsEnabled`, `alertToChatOnOpenEnabled` | `@gluco_guardian_alert_prefs` (excluded from backend payload) | No | No | Partial | AC:2291; exclusion at AC:492-504 |
| Glucose history cached by an **access-code** session (another patient's readings) | `@gluco_guardian_history` (same global key as owner's) | No | No | Partial | GC:301, 461; cleared GC:430 only on normal code exit |
| Logs-migration marker | `@gluco_guardian_logs_migrated_<userId>_<anchorId>` | No | No | **Never** | AC:1265 (only write); read AC:1250, 1252 |
| Theme preference | `@glucose_guardian_theme_preference` | No | No | Never (by design, KEYS:6-9) | TC:76 |
| Graph display mode (line/dots) | `@glucose_guardian_graph_display_mode` | No | No | Never (by design, KEYS:11-15) | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/components/CGMChart.tsx:190` |
| Dose calculator's selected insulin-type label | `@gluco_guardian_dose_insulin_type` | No | No | **Never** | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/app/(tabs)/insulin.tsx:306` |
| Clerk auth session token | `expo-secure-store` (iOS Keychain), Clerk `tokenCache` | **Yes** | No | Yes (`clerkSignOut`) | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/app/_layout.tsx:28, 196` |
| Profile photo **bytes** | `FileSystem.documentDirectory + "profile_photo.<ext>"` — fixed filename, not account-scoped | No | No | **Never deleted by any path** | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/hooks/useProfilePhotoPicker.ts:43-44` |
| Exported clinical reports (.txt summary, .txt logs, .pdf) | `FileSystem.documentDirectory` (`gluco_report_*`, `gg_logs_*`, `gg_report_*`) | No | No | **Never** | DASH:500, 558, 645 |

`SecureStore` is used **only** by Clerk. Exhaustive grep over `app/`, `context/`, `components/`, `utils/`, `services/` returns three hits, all in `_layout.tsx:28/192/196`. Every other secret on device is plain AsyncStorage.

### 1B. Convex DB-only (no device copy)

| What | Table + mutation | Reinst. | Cross-dev | Cleared on acct switch | file:line |
|---|---|---|---|---|---|
| Per-category push toggles (urgent/high/low/rise/fall/careLog/messages/doctor) | `pushTokens.prefs` ← `api.push.setPrefs` | **No** (new Expo token ⇒ new row w/ defaults) | No | Partial (old row *disabled*, not deleted) | PC:246 → `/Users/bretthoffman/Documents/Gluco-Guardian/convex/push.ts:187`; default seed `push.ts:155-163`; disable `push.ts:144` |
| Per-device custom alert sounds | `pushTokens.sounds` ← `api.push.setSounds` | No | No | Partial | PC:264 → `convex/push.ts:208` |
| **Dexcom username + PLAINTEXT password** | `patientDexcomCredentials.dexcomPassword` (`v.string()`) | **Yes** | Yes | **No** — only explicit Disconnect | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/app/cgm-setup.tsx:124` → `convex/patientDexcomSecrets.ts:130`; SCHEMA:300-310 |
| **LibreLink email + PLAINTEXT password** | `patientLibreCredentials.librePassword` (`v.string()`) | **Yes** | Yes | **No** | `cgm-setup.tsx:129` → `convex/patientLibreSecrets.ts:124`; SCHEMA:316-322 |
| Care-circle access codes (label, permissions, schedule, retire) | `careAccessCodes` ← `careCircle.createAccessCode/update/retire` | Yes | Yes | n/a (server-owned) | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/components/CareCirclePanel.tsx:647, 862, 923` → `convex/careCircle.ts:470, 498, 515` |
| Co-guardian invites + links | `careInvites`, `careLinks` | Yes | Yes | n/a | `CareCirclePanel.tsx:752, 731, 1054, 697` → `convex/careCircle.ts:243, 266, 297, 407` |
| Nurse account ↔ kid code links | `caregiverLinks` | Yes | Yes | n/a | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/components/NurseMenu.tsx:146, 184` → `convex/caregiverAccounts.ts:58, 82` |
| Cross-account care messages + read receipts | `careMessages` | Yes | Yes | n/a (no device cache) | MC:96, 104 → `convex/careMessages.ts:293, 332` |
| Emergency wait-window decision | `emergencyWaits` | Yes | Yes | n/a | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/components/EmergencyWaitPrompt.tsx:29` → `convex/push.ts:646` |
| Access-code "last used" ping | `careAccessCodes.lastUsedAt` ← `touchAccessCode` (**no credential required**) | Yes | Yes | n/a | AC:847, 2396, 2623 → `convex/careCircle.ts:529` |
| User provisioning / unfinished-account delete | `users` ← `identity.ensureUser` / `discardUnfinishedAccount` | Yes | Yes | n/a | AC:1454, 1781 → `convex/identity.ts:139, 191` |
| One-time bulk local→cloud log import | `careFoodLogs` + `careInsulinLogs` ← `careLogs.importLogs` | Yes | Yes | n/a | AC:1257 → `/Users/bretthoffman/Documents/Gluco-Guardian/convex/careLogs.ts:396-412` |

**Server tables the mobile app never writes:** `doctorAccounts`, `doctorSessions`, `doctorAlerts`, `doctorAccessLogs`, `doctorPatientLinks` (api-server/doctor-portal only). **Dead tables:** `pushAlertState` (declared SCHEMA:672, 714 — zero readers/writers repo-wide), `patientGuardianPins` (well-built scrypt+salt+lockout in `convex/guardianPin/` — no mobile caller exists), `careSettings` (only writer `careCircle.setDependentMode:565` has no client call site, yet the table **is** read in enforcement at `careLogs.ts:103-108`).

### 1C. Dual-write (device **and** server — these can diverge)

| What | Device key | Server target | Reinst. | Cross-dev | Cleared on acct switch | file:line |
|---|---|---|---|---|---|---|
| Account record `{email, passwordHash, convexUserId}` | `@gluco_guardian_account` | `users` ← `identity.ensureUser` (row derived from Clerk token; the local blob is *not* uploaded) | Yes (server row) | Yes | **Partial — not by signOut** | AC:1540, 1678; ensureUser AC:1454 |
| Patient profile (names, DOB, weight, diabetes type, doctor fields, insulin types, dose math, codes, accessLog, childMode, photo URI) | `@gluco_guardian_profile` | `patientProfiles` ← `patientProfile.replace` (**whole-doc replace**) | Yes | Yes | **Partial — not by signOut** | AC:691 + AC:700; server `convex/patientProfile.ts:164-168` |
| Profile photo **URI** (path only) | inside profile blob | `patientProfiles.profilePhotoUri` | Path yes / image no | Path yes / image no | Partial | `useProfilePhotoPicker.ts:45` → AC:700; SCHEMA:156 |
| Alert thresholds + emergency/one-tap/wait-window (8 fields only) | `@gluco_guardian_alert_prefs` | `patientProfiles.alertPreferences` ← `setAlertPreferences` | Yes | Yes | **Partial — not by signOut** | AC:2291 + AC:2296; payload AC:492-504; SCHEMA:51-64 |
| Access log (audit, `.slice(-50)` client-side only) | inside profile blob | `patientProfiles.accessLog` | Yes | Yes | Partial | AC:2311-2317, 2469-2476, 2485-2492 |
| Caregiver code + doctor code (6-char, `Math.random`) | inside profile blob | `patientProfiles.caregiverCode` / `.doctorCode` | Yes | Yes | Partial | AC:2322-2334, 2466-2478 |
| Child Mode toggle | inside profile blob | `patientProfiles.childModeEnabled` | Yes | Yes | Partial | AC:2308; UI DASH:2078, 2103 |
| CGM connection (type, sessionId, **token**, outsideUS, apiBase) | `@gluco_guardian_cgm` (plaintext) | `patientCgmConnections` + `cgmSyncState` ← `patientCgm.replace/clear` | Yes | Yes | **Partial — not by signOut** | AC:713 + AC:723/729; server `convex/patientCgm.ts:88-159` |
| Glucose readings (rolling 300 on device) | `@gluco_guardian_history` | `patientGlucoseReadings` ← `patientGlucose.upsertBatch` | Yes | Yes | Partial (not by signOut) | GC:508, 278, 527, 364 + GC:174; clear GC:541 |
| Dose settings: carbRatio, targetGlucose, correctionFactor, doseSettingsByTime | `@gluco_guardian_settings` (single serialized writer) | `patientProfiles` via backfill effect / explicit `updateProfile` | Yes | Yes | Partial (not by signOut) | GC:73 (only writer), GC:245-261 backfill; DASH:311-315 |
| Food log (own/circle bucket, cap 200 local) | `@gluco_guardian_food_log` | `careFoodLogs` ← `addFoodLog`/`clearFood`/`update`/`delete` | Yes | Yes | **Partial — not by signOut** | AC:1909 + 1915; 1931/1935; 2047/2052 |
| Insulin log (own/circle bucket, cap 500 local) | `@gluco_guardian_insulin_log` | `careInsulinLogs` ← `addInsulinLog`/`clearInsulin`/`update`/`delete` | Yes | Yes | **Partial — not by signOut** | AC:1983 + 1989; 2005/2009; 2082/2087 |
| Emergency contacts (max 5, circle-shared pool) | `@gluco_guardian_emergency_contacts` | `careShared.emergencyContacts` ← `add/remove/setPrimary/import` | Yes | Yes | **Partial — not by signOut** | AC:2185+2193, 2206+2212, 2226+2232; server `convex/careCircle.ts:742-804` |
| Quick Lookup foods (max 8 client / 12 server) | `@gluco_guardian_quick_foods` (KEYS:28) | `careShared.quickFoods` ← `setQuickFoods` | Yes | Yes | **Partial — not by signOut, not by exitCaregiverMode** | AC:2245 + 2249; server `careCircle.ts:725-735` |
| Circle owner-settings overlay | `@gluco_guardian_circle_shared` | owner's `patientProfiles` ← `careCircle.updateSharedProfile` | Cache no / content yes | Yes | **Yes** (incl. signOut) | AC:1836 + 1838; hydrate AC:1193; server `careCircle.ts:701-722` |
| Doctor ↔ guardian message thread (+ per-device read flags) | `@gluco_guardian_doctor_messages` | `doctorPortalState.messages` via **REST** `POST /api/doctor/sync` | Server yes | Yes | **NO — never cleared by anything** | AC:2666, 2674, 2703; upload AC:2781 → DOCROUTE:711 |
| Pending doctor treatment proposal | `@gluco_guardian_therapy_proposal` | `doctorPortalState.therapyDecision` via **REST** `/api/doctor/order-decision` | Server yes | Yes | **NO — only removed on decide/reconcile** | AC:2729; removed only AC:2730, 2808; POST AC:2811 |

### 1D. Via access code (`db-via-code` — credential is a code, not an account)

| What | Server target | Reinst. | Cross-dev | Cleared | file:line |
|---|---|---|---|---|---|
| Food/insulin log written from a kid/caregiver code session — **no local cache at all** | `careFoodLogs` / `careInsulinLogs` ← `addFoodLogViaCode` / `addInsulinLogViaCode` | Server yes | Yes | Yes (nothing persisted) | AC:1895-1901, 1969-1975; server `careLogs.ts:452-483` |
| Log edit/delete from a code session | `…ViaCode` variants | Yes | Yes | Yes | AC:2094, 2102, 2116, 2129 |
| Nurse-in-kid-view log write (signed-in nurse, byline attribution) | same tables, `authorUserId` passed | Yes | Yes | Yes | AC:1880-1893, 1955-1968 |
| **Full PHI snapshot** (profile + 300 glucose + 100 insulin + 100 food + full message thread + thresholds) | `doctorPortalState` ← `POST /api/doctor/sync` → `api.doctor.upsertFromSync` (**wholesale doc replace**) | Yes | Yes | **No** — nothing ever revokes the server doc | AC:2755-2785; auto-fired every 120 s from DASH:146-147; route DOCROUTE:711 (no auth middleware); `convex/doctor.ts:186` |
| Caregiver decision on a doctor's therapy proposal | `doctorPortalState.therapyDecision` + `doctorAlerts` | Yes | Yes | No | AC:2811 → DOCROUTE:1275 (no auth middleware) → `convex/doctor.ts:323, 338` |

### 1E. In-memory only (dies with the process)

| What | Where | file:line |
|---|---|---|
| Viewed-patient overlay (viewedProfile / viewedFoodLog / viewedInsulinLog / viewedEmergencyContacts / nurseViewCode / accessCodeRole / accessLock) | React state; **never persisted** | AC:2553-2556, 2603-2622; cleared AC:1477-1489, 2632-2653 |
| Glucose history while a co-guardian/nurse views a linked patient | React state only (write-guarded) | GC:318-321, 410; guards GC:505, 519 |
| Doctor session flag | `useState` | AC:2484; cleared AC:1525, 1801, 2149, 2497 |
| AI chat conversation | `useState`; each turn POSTs child name, age, weight, live glucose, 24 h readings, 36 h logs to `/api/chat` | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/app/(tabs)/chat.tsx:230, 297-349` |
| Push prefs UI state | seeded from `api.push.getPrefs` | PC:169, 207 |
| CGM sync-success tick | `useState` counter | GC:145-149 |

### 1F. Server-side in-memory (api-server, **serverless — lost on cold start**)

| What | Where | file:line |
|---|---|---|
| Doctor portal patient snapshots / messages / orders — used whenever `CONVEX_DOCTOR_INGEST_SECRET` is unset | module-level `Map`s, selected **per request** by an env check | DOCROUTE:128-130; writes 766, 767, 1149, 1153, 1261, 1263; branch checks 721, 795, 1090, 1135, 1233, 1295 |
| Global glucose buffer, **no user scoping at all** — every caller shares one 100-entry array | module-level array | `/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/api-server/internal/routes/glucose.ts:17`, push 72, read 89, wipe 95 |
| DEMO patient seed fired as an **import side effect** (DB mutation on every cold start) | top-level IIFE | DOCROUTE:312-323 |

---

## 2. DEVICE-ONLY THAT PROBABLY SHOULDN'T BE

1. **Notification toggles `notificationsEnabled` / `alertToChatOnOpenEnabled`** — AC:2291, deliberately excluded from the backend payload at AC:492-504. They sit in the same blob as the thresholds that *do* sync, so the settings screen looks uniform. Turning notifications off on one phone does not travel to the user's other devices and does not reach the server push pipeline (`convex/push.ts:471-473` reads only the 8 synced fields). Breaks: user silences alerts on the iPad, keeps getting them on the iPhone, and reinstall silently re-enables them.

2. **Push per-category toggles and custom alert sounds** — server-stored (`pushTokens`), but the row is keyed by the Expo push token. Reinstall mints a new token ⇒ new row seeded with `DEFAULT_PUSH_PREFS` (`convex/push.ts:155-163`). A parent who muted "careLog" and picked a custom urgent-low sound gets defaults back after reinstall, with no signal. `convex/push.ts:170` exports `unregisterToken` explicitly for sign-out and **no mobile code calls it**, so a signed-out phone keeps receiving the previous account's alerts until a different identity registers.

3. **Profile photo bytes** — only the `file://` path is stored (`useProfilePhotoPicker.ts:43-45`), and that path is pushed to Convex and served to every other device, circle member and access-code session (`convex/careCircle.ts:173`, consumed AC:824, 2368, 2548, 2598). On any other device the file does not exist. `ProfileChip.tsx:65-66` commits to the `<Image>` branch whenever the URI string is truthy, so the initials fallback can never run — the nurse/co-guardian sees a permanently blank avatar. Reinstall (new container UUID) breaks it for the owner too.

4. **Exported reports** — DASH:500, 558, 645 write the patient's full name, glucose history and logs into `documentDirectory` and never delete them. No sign-out or account-switch path touches that directory.

5. **`doseSettingsByTime` does not reach viewer sessions.** The server exposes it (`convex/careCircle.ts:177`) but every client-side viewer construction drops it — AC:2542-2552 (`enterViewingMode`), AC:2592-2602 (`enterKidView`), AC:2362-2372 (access-code profile) copy the base three and omit it; GC:491 then forces it to `undefined`. A nurse or co-guardian doses on **base ratios only** while the owner's phone uses the meal-window override. Silent, no UI signal.

6. **Doctor-message read flags** are per-device (`@gluco_guardian_doctor_messages`), so marking a doctor message read on the phone leaves it unread on the tablet.

7. **Glucose history + settings blobs are one-per-device, not per account** (`KEYS:2-3`). They are cleared on sign-in/sign-up/logout but not on `signOut` or on entering a code session — see §4.

Benign by design and confirmed as such in code comments *and* code: theme preference (`KEYS:6-9`) and graph display mode (`KEYS:11-15`).

---

## 3. DIVERGENCE RISKS (dual-write pairs that can disagree)

Ranked by consequence. All sequences below are reachable without an adversary.

**1. Patient profile — server can be destroyed by an offline sign-in.**
`commitClerkAccount` queries the remote profile at AC:1506 inside a try/catch (AC:1514-1516). Offline, the query throws, `nextProfile` stays null, and AC:1555 **removes** `PROFILE_KEY` — the app treats the account as un-onboarded. Completing onboarding calls `commitProfile` → `patientProfile.replace`, which is a whole-document replace (`convex/patientProfile.ts:164-168`). The server's real doctor name/email/phone/institution, `caregiverCode`, `doctorCode` and the entire `accessLog` are overwritten by the onboarding subset. This is server-side data loss, not just divergence.

**2. Patient profile — silent revert of any non-dose field.**
Edit DOB or the doctor's phone in Settings (`SettingsModal.tsx:157`) → AC:691 persists locally, AC:700 rejects (expired Clerk token; `acc.passwordHash` is `""` since AC:1457, so the legacy fallback at `convex/identity.ts:77-80` is dead), AC:705-707 swallows it. Within 60 s the hydrate poll (AC:1289-1300) — or at latest the next cold start (AC:1004-1013, unconditional) — overwrites memory *and* disk from the server. The edit is gone permanently: the `GC:245-261` backfill covers only the four dose fields, so names/DOB/weight/doctor fields/insulinTypes/photo/childMode/codes/accessLog have no repair path.

**3. Alert thresholds — the server keeps alarming on the old numbers.**
DASH:256-276 `saveThresholds` calls `updateAlertPrefs` **without awaiting** (DASH:273) and fires a success haptic unconditionally (DASH:275). AC:2291 writes the device copy; AC:2296 fires the mutation from inside a `setState` updater and swallows the rejection at AC:2301. `convex/push.ts:471-473` → `pushLogic.ts:72-81` keep classifying against the stale server value, so a widened urgent-low never fires. AC:1303-1310 then reverts the on-screen number within 60 s. The 15 s guard at AC:1289 keys off `lastProfileCommitAtRef`, which `updateAlertPrefs` never touches.
Extra, **permanent** variant: `exitCaregiverMode` resets alert prefs to defaults in memory (AC:2443) but skips the disk clear unless `hadCloudCaregiver && !isSignedIn` (AC:2446). `sessionAlertOverlay` (AC:483-489) never reads back `oneTapTextEnabled` / `waitWindowEnabled` / `waitWindowMinutes`, so the next toggle pushes those defaults to Convex and permanently disables the server-side wait window.

**4. Food / insulin logs — a failed write is actively DELETED from the device.**
`mergeCloudLogs` keeps a local-only entry only while it is younger than `OPTIMISTIC_KEEP_MS` = 2 min (`/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/utils/careLogsMerge.ts:14, 23-25`), and **both** merge sites write the result back over AsyncStorage — the 60 s poll (AC:1277, 1282) and the live subscription (AC:2865, 2870). Sequence: log a 6 u bolus offline → AC:1983 persists it, the mutation sits in the shared `ConvexReactClient`'s in-memory queue (`/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/mobile/utils/convex-auth-client.ts:25`) → force-quit or iOS reclaims the app → queue dies → next launch, the merge drops the entry and overwrites disk. `computeActiveInsulin` (`insulin.tsx:264`) then reports 0 u on board and the calculator recommends a full correction on top of 4-6 unrecorded units. `importLogs` cannot rescue it: the migration marker (AC:1248, 1265) makes it one-shot per account+bucket.
Same mechanism, no network fault needed: a co-guardian with `viewLogs:true, log:false` — the client gates only access-code sessions (`insulin.tsx:145`), the account branch AC:1977-1996 has no gate, the server throws (`careLogs.ts:119, 390`), AC:1995 swallows it, and every dose they log vanishes ~2 min later.
A failed **delete** is the inverse: the entry is removed locally, survives on the server, and is resurrected by the next merge.

**5. CGM connection — a "disconnected" sensor keeps streaming.**
Disconnect while offline: `cgm-setup.tsx:174-176` swallows the credential clear, AC:713 writes `{"type":null}` locally, AC:723 `patientCgm.clear` throws, AC:735-737 swallows it, `router.back()` runs and the UI shows "Connect CGM". Server keeps `patientCgmConnections`, `patientDexcomCredentials` and `cgmSyncState`; `convex/crons.ts:18` polls the sensor every minute and keeps publishing readings to caregivers and the doctor portal. There is no retry, and the next boot/sign-in (AC:1045-1053, 1512-1513, 1558) reads the surviving server row and flips the app back to "connected" — the server silently reverts the user's disconnect.

**6. Emergency contacts — a safety-critical contact silently disappears.**
Add "Grandma" with no signal: AC:2185 persists, AC:2193 fires, AC:2198 swallows, DASH:453 fires a success haptic regardless. Kill the app before reconnect ⇒ queued mutation lost. Next poll: AC:1225-1228 overwrites state **and** disk from the server pool; Grandma is gone. A non-owner member with an unseeded pool has the local list force-wiped to `[]` (AC:1237-1239). Second, network-free variant: two guardians race the `MAX_EMERGENCY_CONTACTS = 5` cap — `convex/careCircle.ts:746` silently `return`s when full, so the 6th contact reports success and vanishes.

**7. Dose settings — device-wins overwrite of the server.**
`GC:245-261` diffs the device blob against the profile and pushes **local up** whenever they differ, so a stale device blob can overwrite the server. The inverse applies to circle members: `GC:485-499` writes the owner's values *down* into the member's device blob. A circle member editing the Insulin Settings form commits locally (DASH:311-315) while the server rejects it (`careCircle.ts:709-711`, `OWNER_ONLY_PROFILE_FIELDS` at :596-605) and AC:1843 swallows the rejection — the member doses on their own numbers until the next 60 s poll reverts them. *(Note: the current UI gates this — DASH:1587, DASH:1760, `SettingsModal.tsx:154-155`, `TreatmentProposalCard.tsx:148`, `GC:247` — so today the server guard is a backstop, not a live bug. It becomes live the moment any of those gates is removed, and because the server throws for the **whole patch**, a mixed save would also silently discard the allowed fields.)*

**8. Quick foods** — AC:2249 is skipped entirely when `caregiverSessionRef` is true (AC:2247), so a caregiver-session save is device-only forever; and a lost signed-in write is silently overwritten by AC:1211-1212.

**9. Circle-shared overlay** — the optimistic write lands on disk *before* the mutation (AC:1830-1836) and the rejection is swallowed (AC:1843-1845), so a member's offline edit to child name / doctor contact persists across restarts (AC:928, 970-974) and then vanishes on the next successful poll.

**10. Account record** — `email` prefers the client-supplied string over the server's (AC:1456), and `passwordHash` is always `""` for Clerk accounts (AC:1457) with no counterpart on the `users` row.

---

## 4. CROSS-ACCOUNT LEAK RISKS

**The root cause: there are two sign-out functions and the UI calls the weaker one.**

- `signOut` (AC:1795-1807) removes exactly four keys — `SESSION_KEY, CAREGIVER_CODE_KEY, CARE_MEMBERSHIPS_KEY, CIRCLE_SHARED_KEY` (AC:1806) — and clears **no** patient state in memory (no `setProfile(null)`, no `setFoodLog([])`, no `setAccount(null)`).
- `logout` (AC:2134-2174) does the full teardown: 14 keys (AC:2158-2173) plus every in-memory reset (AC:2137-2153).
- **`logout` is dead code.** Verified: repo-wide grep over `app/`, `components/`, `hooks/` returns zero callers. Every Sign Out button calls `signOut` — DASH:107/329, `SettingsModal.tsx:85/176`, `onboarding.tsx:55/881/915`.

What survives sign-out on disk **and** in memory: `@gluco_guardian_profile`, `@gluco_guardian_account`, `@gluco_guardian_cgm`, `@gluco_guardian_food_log`, `@gluco_guardian_insulin_log`, `@gluco_guardian_emergency_contacts`, `@gluco_guardian_alert_prefs`, `@gluco_guardian_quick_foods`, `@gluco_guardian_history`, `@gluco_guardian_settings`, `@gluco_guardian_doctor_messages`, `@gluco_guardian_therapy_proposal`. The boot loader (AC:898-979) re-reads `PROFILE_KEY`, `FOOD_LOG_KEY`, `INSULIN_LOG_KEY`, `EMERGENCY_CONTACTS_KEY`, `ALERT_PREFS_KEY`, `DOCTOR_MESSAGES_KEY`, `THERAPY_PROPOSAL_KEY` and `ACCOUNT_KEY` **unconditionally** — it never checks whether a session exists (AC:983-993 loads the account before the `storedSession === "true"` check at AC:994). What saves the app is `commitClerkAccount` (AC:1499-1560), which every sign-in path funnels through and which wipes the leftovers. **So the real invariant is: cleared on account SWITCH, never on sign-out.** The exposure window opens at sign-out and never closes if the phone is simply handed over.

### Keys never cleared at any boundary (verified exhaustively)

| Key | Only references | Consequence |
|---|---|---|
| `@gluco_guardian_doctor_messages` | AC:388 (def), 924 (read), 2666/2674/2703 (writes) — **zero `removeItem` anywhere in the repo** | The previous guardian's full clinical conversation with their doctor is hydrated at AC:924 and rendered for whoever is next on the phone. Re-POSTed every 120 s from DASH:147. |
| `@gluco_guardian_therapy_proposal` | AC:389, 925, 2729, 2730, 2808 — removed **only** on decide/reconcile | A pending insulin-dose change from account A can be surfaced to — and approved by — account B. `TreatmentProposalCard.tsx:60-62` then writes carbRatio/target/ISF into the live profile. |
| `@gluco_guardian_logs_migrated_*` | AC:377, 1248, 1250, 1252, 1265 | Inert (keyed by userId, and `importLogs` is idempotent by `clientId`), but the marker set grows unbounded. |
| `@gluco_guardian_dose_insulin_type` | `insulin.tsx:306/307` | Previous child's insulin brand string persists. Bounded: re-validated against the signed-in profile at `insulin.tsx:217-222`. |
| `documentDirectory/profile_photo.<ext>` | `useProfilePhotoPicker.ts:43` | **Fixed filename, not account-scoped.** Parent B's photo overwrites Parent A's file, and both Convex rows store the byte-identical path — Parent A sees Parent B's child's photo. PHI mis-association. |
| Exported `.txt`/`.pdf` reports | DASH:500, 558, 645 | Accumulate with full name + glucose + logs; readable by the next account via the app's own share/export UI. |

### Additional reachable leak sequences

- **Sign out → enter another household's access code.** `enterCaregiverMode` (AC:2336-2430) clears `CGM_KEY` (AC:2385, 2415) and overwrites `PROFILE_KEY`, but not `FOOD_LOG_KEY`, `INSULIN_LOG_KEY`, `QUICK_FOODS`, `@gluco_guardian_history` or `@gluco_guardian_settings`, and the previous account's logs are still in memory. The code-session poll **merges** rather than replaces (AC:1379-1380), so entries younger than 2 min render inside the borrowed session — unbounded while offline, since the catch at AC:1381-1383 keeps them displayed.
- **Quick foods persist into the next household indefinitely.** Not in `signOut` (AC:1806) and not in `exitCaregiverMode` (AC:2449-2456); the corrective hydrate poll is gated on `isSignedIn && account?.convexUserId` (AC:1153-1155) so it never runs in a code session. Household A's meal names show on Household B's Food tab (`food.tsx:641`, `LogFoodModal.tsx:81-87`).
- **Revoked access code, cold start.** `clearAndBounce` (AC:778-786) removes the code/profile/CGM/log keys but **not** the glucose keys, and `GC:424-436` cannot fire because `prevCaregiverCloudCodeRef` starts null (GC:162). Another family's last 300 readings stay on disk and reload at GC:188-194.
- **Reinstall adopts the previous user's account.** The Clerk session lives in the Keychain and survives app deletion; AC:1562-1566, 1604-1615 and 1643-1650 detect Clerk's `session_exists` and **silently adopt** it. Deleting and reinstalling can drop a new user straight into the previous user's account.
- **Legacy password-hash replay (devices upgraded from a pre-Clerk build).** `git show 47e0a428^:artifacts/mobile/context/AuthContext.tsx` shows the old build stored a real `hashPassword(password)` in `ACCOUNT_KEY`; nothing migrates or deletes it, and `convex/identity.ts:70-82` still accepts `{userId, passwordHash}` as a full credential. After `signOut`, entering the owner's own 6-char legacy caregiver code (AC:2342-2348) leaves `codeWriteRef` null (AC:663-666), so log writes fall through to the account branch (AC:1913, 1988) and land in the signed-out account's Convex bucket. On a Clerk-era device the same call is rejected — and swallowed at AC:1921.
- **Server-side:** nothing in `AuthContext` ever revokes the `doctorPortalState` document on sign-out or account deletion, and CGM credential rows are cleared only by an explicit Disconnect (`cgm-setup.tsx:170/172`).

---

## 5. SILENT FAILURES — exact catch sites

Every Convex write in the two main contexts is fire-and-forget or swallowed. **No outbound retry queue exists anywhere in the app.** Combined with the 2-minute optimistic window (`careLogsMerge.ts:14`) and the server-wins hydrate poll (AC:1275-1310), a failed write is not merely unreported — the local copy is actively deleted or reverted shortly afterwards.

**AuthContext.tsx — swallowed Convex/network writes**

| Line | Write |
|---|---|
| 705-707 | `patientProfile.replace` — `catch { /* offline — local cache remains */ }` |
| 735-737 | `patientCgm.replace` / `patientCgm.clear` |
| 1218 | `careCircle.setQuickFoods` (owner seed) |
| 1236 | `careCircle.importSharedEmergencyContacts` |
| 1314 | whole hydrate poll body |
| 1843-1845 | `careCircle.updateSharedProfile` |
| 1891, 1900 | `addFoodLogViaCode` (nurse / code) |
| 1921 | `careLogs.addFoodLog` |
| 1940 | `careLogs.clearFood` |
| 1966, 1974 | `addInsulinLogViaCode` (nurse / code) |
| 1995 | `careLogs.addInsulinLog` |
| 2014 | `careLogs.clearInsulin` |
| 2052 | `mutateFoodEntry` (update/delete, incl. ViaCode) |
| 2087 | `mutateInsulinEntry` (update/delete, incl. ViaCode) |
| 2198, 2217, 2237 | emergency contact add / remove / setPrimary |
| 2254 | `careCircle.setQuickFoods` |
| 2301 | `patientProfile.setAlertPreferences` |
| 2786 (`if (!res.ok) return;`), 2792 | `POST /api/doctor/sync` |
| 2816-2818 | `POST /api/doctor/order-decision` — device clears the proposal locally even when the portal never learns the answer |

**Silent no-ops on the server (mutation succeeds, nothing is written)**

- `convex/patientProfile.ts:186` — `setAlertPreferences` does `if (!existing) return;`
- `convex/careCircle.ts:746` — `addSharedEmergencyContact` returns without writing when the pool is at `MAX_EMERGENCY_CONTACTS = 5`
- `convex/careCircle.ts:730` — `setQuickFoods` silently `.slice(0, 12)`
- `convex/careLogs.ts:174-181, 183-190` — `pruneFood`/`pruneInsulin` delete the oldest entries past `FOOD_CAP = 200` / `INSULIN_CAP = 500` on **every insert**
- `convex/doctor.ts:74, 99` — `settingsHistory` truncated to 50
- `convex/careMessages.ts:298` — message text truncated to 1000 chars
- `convex/patientGlucose.ts:207` / `convex/cgmIngest.ts:332` — per-call `.slice(0, 350)` / `.slice(0, 400)` drops the tail
- `convex/doctorAlerts.ts:72` — `markAllRead` only `take(200)`; a doctor with >200 alerts can never clear the badge

**UI that reports success unconditionally**

- DASH:273-275 — `updateAlertPrefs` not awaited, success haptic fires regardless
- DASH:311-321 — dose settings `updateProfile` not awaited, success haptic at :321
- DASH:453 — emergency contact success haptic
- `food.tsx:307-321` — `addFoodLogEntry` returns `void`; `setLogged(true)` + haptic with no result to check
- `cgm-setup.tsx:178-180` — `router.back()` after a disconnect that may not have landed

**Best-effort audit trail:** `DOCROUTE:279-286` — `void client.mutation(...).catch(() => {})` for `doctorAccessLogs`, and skipped entirely when `isConvexDoctorAccountsConfigured()` is false (:277). A PHI access that provably happened can have no record.

---

## 6. TOP FIXES (ranked, defensible from code)

1. **`DOCROUTE:711` and `DOCROUTE:1275` — add `requireDoctorAuth`.** `POST /api/doctor/sync` and `POST /api/doctor/order-decision` are the only two routes in that file without auth middleware (verified against all 24 routes); their sole credential is a body-supplied 6-char code minted with `Math.random` at AC:2466-2467. `/sync` lets an unauthenticated caller overwrite a patient's entire clinical snapshot *and* read back the doctor↔guardian thread (`DOCROUTE:749-755`); `/order-decision` lets them approve a clinician's insulin-dose change. `app.use(cors())` with no allowlist (`/Users/bretthoffman/Documents/Gluco-Guardian/artifacts/api-server/internal/app.ts:7`) makes both reachable from any web page.

2. **AC:1806 — make `signOut` clear what `logout` clears, or point the four UI call sites at `logout`.** One `multiRemove` list plus the in-memory resets from AC:2137-2153 closes the entire §4 leak surface at once. (Also delete `logout` if it stays unused — it currently reads as coverage that does not exist.)

3. **AC:2666/2674/2703 + AC:2729 — add `DOCTOR_MESSAGES_KEY` and `THERAPY_PROPOSAL_KEY` to every clearing list.** They appear in no `removeItem` at an account boundary; both carry clinical content and are re-hydrated at AC:924-925 with no session check. One line each.

4. **`careLogsMerge.ts:23-25` + AC:1872-1877 — never delete an unconfirmed entry.** Tag optimistic entries `pending: true`, clear the flag only when the mutation resolves, and exempt pending entries from the 2-minute age cutoff. `upsertFood`/`upsertInsulin` are idempotent on `clientId` (`careLogs.ts:202-208, 254-260`), so a durable retry queue is free and cannot duplicate.

5. **AC:1921 / 1995 / 2052 / 2087 / 2198 / 2254 / 2301 / 705 / 735 — stop swallowing.** Return a status instead of `.catch(() => {})`, and gate the success haptics at DASH:275, DASH:321, DASH:453, `food.tsx:319` on it. Today "saved" and "silently lost" are pixel-identical.

6. **`convex/push.ts:181/192/171` — require an identity.** `setPrefs`, `setSounds`, `getPrefs` and `unregisterToken` authenticate on the **Expo push token alone**; anyone holding a token can read a device's alert config or turn off its urgent-low glucose alerts. `registerToken:132` already resolves an owner — apply the same check. Separately, call `unregisterToken` from `signOut`; nothing does today.

7. **`convex/schema.ts:303` and `:319` — encrypt Dexcom/Libre passwords at rest.** Bare `v.string()`, written from two paths (api-server secret-gated `patientDexcomSecrets.ts:42`, and the mobile client directly at `cgm-setup.tsx:124/129`), and never deleted on sign-out. They must stay reversible for the ingest cron, so this is envelope encryption, not hashing.

8. **`convex/doctorAccounts.ts:68/92/216/240` — hash server-side.** The client sends a value named `passwordHash`, the server stores it verbatim and compares with `===`, no salt, no KDF, no lockout on the PIN. `convex/guardianPin/hashNode.ts:8` already implements the correct scrypt+salt+`timingSafeEqual` pattern in this repo. *Cannot be determined from this codebase:* what algorithm produces those client-side digests — the doctor portal client is not in `artifacts/`.

9. **AC:1514-1516 — do not treat "couldn't reach server" as "no profile exists".** Today an offline sign-in removes `PROFILE_KEY` (AC:1555), routes to onboarding, and the resulting `patientProfile.replace` (whole-doc, `convex/patientProfile.ts:164-168`) destroys the server's doctor fields, access codes and accessLog.

10. **AC:723/735 — make CGM disconnect durable.** Rethrow so `cgm-setup.tsx:178` can block `router.back()`, and suppress the server-wins rehydrate (AC:1045-1053, 1512-1558) while a disconnect is pending. Otherwise `convex/crons.ts:18` keeps ingesting from a sensor the user believes is unlinked.

11. **`glucose.ts:17` — delete or scope the global glucose buffer.** One module-level 100-entry array shared by every caller, no `userId` anywhere in the route; `GET /api/glucose/history` returns strangers' readings and `DELETE` wipes it for everyone. No mobile caller found (grep for `api/glucose` across `artifacts/mobile` returns nothing) — it looks like dead legacy surface, but it is mounted at `routes/index.ts:14` and publicly reachable.

12. **`DOCROUTE:312-323` — remove the module-load `seedDemo` mutation.** A DB write as an import side effect re-fires on every Vercel cold start against whatever `CONVEX_URL` is configured, and its failure only `console.warn`s.

13. **`useProfilePhotoPicker.ts:43` — account-scope the filename** (`profile_photo_${convexUserId}.${ext}`) and add `onError` fallbacks at `ProfileChip.tsx:66` / DASH:735. Properly: upload bytes to Convex file storage and store the storage id.

14. **`careLogs.ts:604-617` — `resolveClearAuth` ignores the `log` grant and the schedule window,** so any active co-guardian can wipe the whole circle's food/insulin history (`clearFood:619`, `clearInsulin:634`). Same class: `isCircleAdmin` (`careCircle.ts:139-146`) returns true for any co-guardian, letting `setLinkPermissions:418` / `setLinkAccess:433` widen one's own grant or strip a peer's (currently unreachable from the UI, but live public mutations). And `careCircle.ts:521` `touchAccessCode` takes no credential at all.

15. **`convex/auth.ts:4-29` — remove or gate `register`.** A public unauthenticated insert into `users` with a client-chosen `passwordHash`, which then authenticates through the legacy fallback at `convex/identity.ts:77-80`. Mobile never calls it. `auth.ts:49-56` `getUser` likewise returns any user's email for any id.

---

## Explicitly not determinable from this codebase

- The hashing algorithm behind `doctorAccounts.passwordHash` / `pinHash` — the doctor portal client is not in this repo (`artifacts/` contains only `api-server`, `mobile`, `mockup-sandbox`). Grep for `sha256|bcrypt|argon|scrypt|crypto.subtle` across `artifacts/` and `convex/` finds only `convex/guardianPin/hashNode.ts`. I can state that the **server** applies no hashing; client-side strength is unverifiable here.
- Whether `CONVEX_DOCTOR_INGEST_SECRET` is actually set in the deployed environments — this decides, **per request**, whether doctor-portal writes go to Convex or to the ephemeral `Map`s at `DOCROUTE:128-130`.
- Retention/handling of PHI egressed to the OpenAI-compatible endpoint (`chat.ts:359-373`, `food.ts:203`, `doctor-assistant.ts:348`) — governed by that provider, not by this code.
- Whether the pending-mutation queue in the shared `ConvexReactClient` survives anything: nothing in this repo persists it, so the analysis above assumes in-memory only (`convex-auth-client.ts:25-37`). The precise client-side queue semantics live in `node_modules`.