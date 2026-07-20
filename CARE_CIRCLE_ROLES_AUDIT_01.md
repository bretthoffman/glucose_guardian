# Care Circle & Account Roles — Deep-Dive Audit + Implementation Design (01)

Goal: real account roles and account-to-account linking — parent↔kid, up to 3 co-guardians,
spouse viewers, and time-boxed external guardians (teacher / babysitter / relative) — with a
parent-side control panel (permissions, schedules, revoke/re-enable), a single shared log bucket
with authorship visible on every device in near-real-time, and role-based UI reduction.

This document is the audit + design only. No code has been changed.

---

## 1. What the app has today (audit)

### 1.1 Accounts & auth
- `convex/schema.ts` → `users`: email + client-side password hash. Every patient-side Convex
  function re-verifies `userId + passwordHash` per call (`assertPatientAuth`). No patient session
  tokens (the doctor side DOES have bearer sessions — `doctorSessions`).
- One signed-in account per device (`AuthContext` / AsyncStorage `@gluco_guardian_account`).
- `patientProfiles.accountRole: "parent" | "adult"` — chosen at onboarding. It is a **label**, not
  a capability system: it changes copy ("What's your child's name?"), the greeting ("Bella's
  Guardian"), and which name fields exist. Nothing is enforced by it server-side.

### 1.2 Existing "guardian-ish" mechanisms (three different ones, none account-based)
| Mechanism | What it is | Gaps for this feature |
|---|---|---|
| **Caregiver code** (`patientProfiles.caregiverCode`) | Anonymous 6-char code; a device that enters it gets READ-ONLY glucose + the profile via `patientProfile.getByCaregiverCode` / `patientGlucose.listRecentForCaregiver`. No account, no identity, one shared code, no expiry, no revoke-one-person (only rotate the code). | No identity ("who is this?"), no permissions, no schedule, no logging ability, and it exposes the ENTIRE profile — including the doctor code — to any code holder. |
| **Child mode** (`childModeEnabled` + Guardian PIN) | Same-device UI reduction: hides the Insulin tab, PIN-gates settings. PIN is server-verified per account (`patientGuardianPins`). | Single device, single account. Not a second person. |
| **Doctor link** (coworker's) | Real accounts (`doctorAccounts`) + bearer sessions + **`doctorPatientLinks`** (doctorId ↔ patient access code, `revokedAt`) + `doctorAccessLogs` compliance trail. | Doctor-only, REST-bridged, but it is the **proven in-repo template** for "account links to patient with revocation + audit". |

### 1.3 Data that would need to be shared
- **Glucose readings**: already per-patient in Convex (`patientGlucoseReadings`, `by_user_time`),
  durably fed by the Convex-owned CGM ingestion (`cgmIngest.ts`). ✅ Ready to share — guardians
  just need an authorized query path.
- **Food & insulin logs**: **device-local only** (AsyncStorage, capped 200/500, in
  `AuthContext`). They leave the phone only inside the doctor-sync snapshot. **No author field.**
  This is the single biggest structural gap: the shared bucket requires moving logs to Convex.
- **Settings** (carb ratio / ISF / target): device-local + mirrored onto the profile for doctor
  sync. Shared-control by co-guardians would ride on the existing profile replace flow.

### 1.4 Real-time
The app talks to Convex through `ConvexHttpClient` (one-shot HTTP) — there are **no live
subscriptions anywhere**; freshness comes from the 5-minute sync loop and on-mount fetches.
Convex natively supports reactive subscriptions via `ConvexClient` (WebSocket, same `convex`
package, `client.onUpdate(query, args, cb)`). "Other parent sees the log in real time" needs
either that client (scoped to one provider) or accepting ~5-minute polling freshness.

### 1.5 CGM credential overlap ("two accounts on the same Dexcom")
Dexcom/Libre credentials are stored server-only per user (`patientDexcomCredentials`,
`by_userId`). Today two accounts entering the same Dexcom Share login each run their own
ingestion of the same sensor — duplicate streams, double provider traffic. There is no
same-credentials detection. A non-reversible fingerprint (e.g. SHA-256 of `provider +
lowercased username`) with an index would enable "these two accounts look like the same sensor —
link them?" and, once linked, letting the guardian read the patient's stream instead of running a
second ingestion.

---

## 2. Proposed model

### 2.1 Mental model: the Care Circle
Every diabetic person is a **patient account** — the account that owns the CGM connection,
readings, logs, and treatment settings. Other people join that patient's **care circle** as
**members** via links. A link (not the account) carries the role, permissions, and schedule:

```
patient (owns data) ──┬── link: co_guardian   (parent #1)      full control
                      ├── link: co_guardian   (parent #2)      full control
                      ├── link: guardian      (teacher)        limited + schedule
                      └── link: guardian      (grandma)        limited + one-time window
```

- **Who is "admin"** (holds the control panel) is decided by one patient-profile flag:
  - `dependentMode: false` (adult patient): the **patient** is admin; all members are limited
    (spouse = a `guardian` link with view-only defaults).
  - `dependentMode: true` (parent-kid mode): the **co_guardians** are admin; the kid's own device
    becomes the limited one (its restrictions live on the profile, PIN-protected like child mode
    today). Greeting/copy flips exactly as the current `accountRole === "parent"` logic does.
- Max **3 active `co_guardian` links** per patient (server-enforced at accept time).
- An account can be a member of someone else's circle and a patient itself — roles are per-link,
  so no global "account type" migration is needed. `accountRole` stays as onboarding copy.

### 2.2 New Convex tables (all additive — no changes to coworker's tables)

```ts
/** One row per member of a patient's care circle. Mirrors doctorPatientLinks conventions. */
careLinks: {
  patientUserId: Id<"users">,
  memberUserId: Id<"users">,
  role: "co_guardian" | "guardian",          // spouse/teacher/grandma are all "guardian"; the
                                             // difference is permissions + schedule, kept uniform
  displayName: string,                       // snapshot of the member's name for lists/log bylines
  permissions: {                             // uniform grant object (see 2.3)
    viewReadings: boolean,
    viewLogs: boolean,
    log: boolean,
    useCalculator: boolean,
    chat: boolean,
  },
  access:                                    // schedule (see 2.4)
    | { mode: "always" }
    | { mode: "disabled" }
    | { mode: "window"; startMs: number; endMs: number }
    | { mode: "weekly"; days: number[]; startMinute: number; endMinute: number; tzOffsetMinutes: number },
  status: "active" | "revoked",
  createdAt / updatedAt / revokedAt?, revokedBy?: "patient_side" | "member",
}
  .index("by_patient", ["patientUserId", "status"])
  .index("by_member", ["memberUserId", "status"])

/** Short-lived invite codes that create links when redeemed. */
careInvites: {
  patientUserId: Id<"users">,
  code: string,                              // 8-char A-Z2-9, indexed
  role: "co_guardian" | "guardian",
  presetPermissions: {...}, presetAccess: {...},
  createdByUserId: Id<"users">,              // patient, or a co_guardian in dependent mode
  expiresAt: number,                         // 48h default
  status: "pending" | "redeemed" | "cancelled",
  redeemedByUserId?: Id<"users">, redeemedAt?: number,
}
  .index("by_code", ["code"]).index("by_patient", ["patientUserId", "status"])

/** THE shared log bucket — replaces device-local food/insulin logs. */
careFoodLogs / careInsulinLogs: {
  patientUserId: Id<"users">,
  authorUserId: Id<"users">,
  authorName: string,                        // "Bella", "Mom", "Ms. Rivera" — denormalized for display
  ...existing FoodLogEntry / InsulinLogEntry fields (incl. insulinType/recommendedUnits/manualOverride),
  clientId: string,                          // the device-generated id, for dedupe/migration idempotency
  createdAt: number,
}
  .index("by_patient_time", ["patientUserId", "timestamp"])
  .index("by_patient_client", ["patientUserId", "clientId"])
```

Profile additions (optional fields → backward compatible):
- `dependentMode?: boolean` — parent-kid mode switch.
- `patientDevicePermissions?: { log: boolean; useCalculator: boolean; chat: boolean }` — what the
  kid's own device may do (PIN-protected UI, server-enforced on writes).
- `patientDisplayName?`-style byline source already exists (`childName`).
- On `patientDexcomCredentials`: `usernameFingerprint?: string` + index (for §2.7).

### 2.3 Permissions — one uniform shape for every role
Same five booleans everywhere; **role presets** fill them, admins can toggle per-link afterward:

| Grant | co_guardian preset | guardian preset (teacher/spouse/grandma) | kid device (dependentMode) |
|---|---|---|---|
| viewReadings | ✅ | ✅ | ✅ (always) |
| viewLogs | ✅ | ✅ | ✅ |
| log | ✅ | ❌ (parent can enable — the teacher case) | ✅ (parent can disable) |
| useCalculator | ✅ | ❌ | ✅ (parent can disable) |
| chat | ✅ | ❌ | ✅ (parent can disable) |

- co_guardian permissions are not editable (they ARE the admins); only the 3-cap and revocation
  bound them. Everything else is per-link toggles in the panel — one mechanism, as requested.
- The kid's device is intentionally modeled with the **same grant shape** stored on the profile,
  so the control panel renders "Bella's device" as just another row with the same toggles.

### 2.4 Time windows & schedules — lazily evaluated, no crons
`access` is checked **server-side inside every guardian-path query/mutation** by one helper:

```ts
function linkAccessNow(link, nowMs): "ok" | "outside_window" | "disabled" | "revoked"
```

- `window` = one-time babysitting/grandma visit (start–end, then it's naturally inert; the row
  stays so the parent can grant a NEW window to the same person — the "re-enable" requirement,
  no re-linking needed).
- `weekly` = school hours (days 1–5, 8:00–15:30, with the tz offset captured when the parent
  sets it). Evaluated at request time → nothing to schedule or clean up server-side; "expired"
  is just a state the evaluator reports. The panel shows a live status chip per member
  ("Active now" / "Outside window — next Mon 8:00 AM" / "Disabled" / "Revoked").
- The member's own app calls a `careLinks.myLinks` query on launch/focus and renders the polite
  lock screen ("Access to Bella's data is outside its scheduled window") instead of data.

### 2.5 Linking flows (invite lifecycle)
All three requested entry points funnel into ONE code path — `careInvites`:

1. **Access code** (ships first; matches the app's existing code culture): parent taps
   "Invite co-guardian" / "Invite temporary guardian" → picks role/preset/schedule → gets an
   8-char code (48h expiry). Other person: Dashboard → "Join a care circle" → types code →
   sees "Join Bella's care circle as co-guardian?" → accept. Redemption + acceptance = the two
   consents (the code's creation is the patient side's consent; typing it is the member's).
2. **QR code**: render the invite as a QR of the code/deep link (`react-native-qrcode-svg`,
   small pure-JS dep; scanning falls back to typing the code — the app already has camera access
   via expo-image-picker but a dedicated scanner isn't required for v1 since the joiner can type).
3. **Phone number → text a link**: recommend the OS **share sheet** (RN `Share.share`) with a
   prefilled message: app-store link + the code (later: a universal link that deep-links straight
   into the join screen with the code prefilled). This avoids standing up an SMS provider
   (Twilio + numbers + compliance) — the invite travels through the parent's own Messages app.
   Server-sent SMS can be a later upgrade if wanted.
- **Both-side revoke**: patient side (patient or any co_guardian in dependentMode) revokes any
  link; a member can leave (revoke their own). Revocation is a status flip → every subsequent
  server check fails closed; the member's app shows the lock screen on next query.
- **Cap**: `redeem` counts active co_guardian links and rejects the 4th with a friendly error.

### 2.6 The shared log bucket (the structural change)
- **Writes**: `logInsulinDose` / `addFoodLogEntry` in `AuthContext` become optimistic local
  writes + a Convex mutation (`careLogs.add` with `clientId` idempotency). Guardians write with
  their own `authorUserId` after the server re-checks `permissions.log` + schedule.
- **Reads**: `AuthContext` hydrates `foodLog`/`insulinLog` from `careLogs.listRecent(patientId)`
  (merged, capped ~500) instead of AsyncStorage-only; AsyncStorage becomes the offline cache.
  **Because every downstream feature already consumes these two arrays from `AuthContext` —
  IOB/COB, the dose calculator, insights, A1C avg-carbs, chat context, the Logs tab, doctor
  sync — the entire app inherits the merged multi-author bucket with no changes to those
  features.** This is the key architectural win of the current structure.
- **Authorship in UI**: log rows get a small byline ("· by Mom", "· by Bella") from
  `authorName`; `authorUserId === me` renders as "you". Doctor snapshot passes authorship
  through untouched validators (`v.array(v.any())` server-side, additive TS fields).
- **Real-time**: subscribe to `careLogs.listRecent` via Convex's reactive `ConvexClient` in one
  place (a `CareLogsProvider`), keeping `ConvexHttpClient` everywhere else. Fallback if the
  WebSocket client misbehaves in Expo: refetch on app-focus + the existing 5-min tick (worst-case
  ~5-min lag). Ship the subscription, keep the fallback path.
- **Migration**: on first launch after update, push local AsyncStorage logs up with
  `author = self` (idempotent via `clientId`), then switch reads to the merged query. Old caps
  (200/500) preserved server-side per patient via pruning in the mutation.

### 2.7 Same-Dexcom detection & the parent-kid switch
- On CGM connect, store `usernameFingerprint` (SHA-256 of provider+username, server-side).
  If another account already has the same fingerprint → the connect response includes
  `{ possibleSharedSensor: { maskedEmail } }` → the app offers "It looks like this sensor is
  already connected to another Glucose Guardian account. Link accounts in parent-kid mode?" →
  flows into a normal co_guardian invite, and on acceptance the **guardian's own CGM connection
  is cleared** (one ingestion stream, the patient's — kills the duplicate-sync problem).
- Enabling **parent-kid mode** (dependentMode) requires: an active co_guardian link + the
  Guardian PIN set. The toggle lives in the control panel; flipping it moves admin rights as
  described in §2.1 and swaps which device gets the reduced UI.

### 2.8 Guardian data access (replacing the anonymous code path)
- New link-authorized queries mirroring the existing caregiver ones:
  `patientGlucose.listRecentForLink`, `listForDayRangeForLink`, `windowStatsForLink`,
  `patientProfile.getForLink` — each takes the MEMBER's `userId+passwordHash`, resolves the
  active link, checks schedule + permission, and returns **only role-appropriate fields** (fixing
  today's over-exposure: no doctor code, no caregiver code, no access log for guardians).
- The guardian's app runs in "linked patient" mode: `GlucoseContext`/`AuthContext` source from
  the link queries (the standalone-caregiver `caregiverCloudCode` mode already proves this
  pattern end-to-end — same wiring, now authenticated).
- **Legacy caregiver code**: keep working during transition, relabeled "Quick view code
  (legacy)" in the dashboard, with a banner suggesting an account link; retire in a later pass.
  Doctor codes are untouched.

---

## 3. UI change map (reduction-style, per role)

| Surface | Patient (adult, admin) | Kid device (dependentMode) | co_guardian | guardian (teacher/spouse) |
|---|---|---|---|---|
| Glucose page | unchanged | unchanged | patient's stream, "Bella's Guardian" greeting (exists) | same, read-only affordances |
| Insulin tab | unchanged | hidden unless `useCalculator` (child-mode hide exists) | full | hidden unless granted |
| Food page | unchanged | log gated by `log` grant | full | hidden unless `log` |
| Logs tab | bylines | bylines; Log buttons gated | full + bylines | view if `viewLogs`; log buttons if `log` |
| Chat | unchanged | gated by `chat` | full (patient context) | hidden unless granted |
| Dashboard | **Care Circle panel** (new) | restricted card ("Managed by your guardians") | Care Circle panel | "Your access" card (role, schedule, leave) |
| Outside window | — | — | — | lock screen w/ next-window copy |

New screens/components: `CareCirclePanel` (member list + status chips + toggles + schedule
editor + invite buttons), `JoinCircleScreen` (code entry / deep-link target), invite sheet
(code + QR + share button), `AccessLockScreen`.

---

## 4. Enforcement principles
1. **Server decides, client shapes.** Every guardian-path Convex function re-checks link status,
   schedule, and the specific grant. UI reduction is UX, never the security boundary.
2. Writes to the shared bucket record the true `authorUserId` from the authenticated caller —
   bylines can't be spoofed by the client.
3. Care-circle management mutations (permissions/schedules/revoke/dependentMode) are allowed for
   the admin side only (patient when `!dependentMode`; any active co_guardian when set) and
   append to the existing profile `accessLog` for the audit trail.
4. Existing per-call `userId+passwordHash` auth is kept (consistent with the codebase); no new
   session machinery for v1.

## 5. Back-compat / coworker coordination
- Schema strictly additive; his `doctor*` tables and `cgmIngest` untouched. Same
  pull-before-deploy discipline; Convex must deploy before the app ships (old apps ignore new
  tables; new app must fail soft — every new query wrapped with the same fallback style used for
  `windowStats`).
- Doctor sync payload unchanged in shape (log entries gain optional `authorName` — his portal
  validators are `v.any()`; the api-server TS type gets the optional field).

## 6. Phased implementation plan
1. **Phase 1 — Links + invites + guardian read access** (schema, careLinks/careInvites, invite
   UI, join flow, link-authorized glucose/profile queries, guardian "linked patient" mode,
   Care Circle panel v1: list/revoke/leave, co_guardian cap, dependentMode flag + greeting/admin
   flip). *Biggest single phase; everything else builds on it.*
2. **Phase 2 — Shared log bucket** (careLogs tables + mutations, AuthContext cloud hydration +
   optimistic writes + migration, bylines in Logs tab, reactive subscription with focus-refetch
   fallback). *Unlocks: co-parent real-time logging, authored logs everywhere.*
3. **Phase 3 — Permissions + schedules** (grant toggles, schedule editor with one-time window +
   weekly, lazy evaluation helper across all link queries, status chips, lock screen,
   re-enable flow, kid-device grants PIN-gated).
4. **Phase 4 — Polish** (QR render, share-sheet invite, same-Dexcom fingerprint suggestion +
   duplicate-ingestion cleanup, legacy caregiver-code deprecation banner, universal link
   deep-join).

## 7. Open decisions (need Brett's calls before Phase 1)
1. **Naming**: "co-guardian" for parents (your stated preference) + plain "guardian" for
   temporary/limited members — confirm, and confirm "Care Circle" as the panel name.
2. **Invite delivery v1**: code + QR + OS share sheet (no server SMS) — acceptable for v1?
3. **Spouse case**: require a real account+link (recommended), or keep the legacy anonymous
   code path alive for that use indefinitely?
4. **Real-time bar**: is "instant via subscription, with 5-min fallback if the socket drops"
   the right target, or is 5-min polling acceptable for v1 (cheaper to ship)?
5. **Kid onboarding**: in the shared-Dexcom flow, does the kid keep their own email account
   (recommended — it already exists in the wild), with dependentMode just flipping control?
6. **Teacher seeing history**: should `viewLogs`/graph history be schedule-gated too, or may a
   teacher outside school hours still see nothing at all (current design: outside window = no
   data, full lock)?

---

## 8. Decisions locked (2026-07-19) + design revisions

Brett's calls on §7, plus one model revision that came out of them:

1. **Naming (FINALIZED 2026-07-20)**: **Guardian** = the patient's own account holder / family
   (a parent watching a kid, an adult's spouse). **Co-Guardian** = two accounts linked together
   for the same patient (e.g. both parents). **Caregiver** = external, access-code-based people
   (teacher, babysitter, nurse, relative) — NOT "external guardian". "Doctor" is separate. Panel =
   **Care Circle**. Implemented: Care Circle panel "Caregiver codes"; auth screen "Caregiver? Enter
   your access code"; dashboard banner "Caregiver View"; the legacy Access-Management
   "Caregiver/Family Code" generator was replaced by a pointer into Care Circle (older 6-char codes
   still work). ✅
2. **Invite delivery v1**: code + QR + OS share-sheet. No server SMS. ✅
3. **Accounts**: main users (kids AND adults) and all main guardians (parents, spouses) require
   real accounts + links. Only external/temporary guardians ride on anonymous codes. ✅
4. **Real-time**: instant via the reactive Convex client where it doesn't add a standalone
   system — it doesn't (same `convex` package, one scoped provider); 5-minute refresh is the
   accepted fallback when the socket path is unavailable. ✅
5. **Kid accounts**: keep their existing email accounts; `dependentMode` only moves control. ✅
6. **Teacher outside hours**: full lock — sees nothing. Teachers are plain external guardians
   whose codes carry one-time windows or recurring weekly schedules, set from the panel. ✅

**Revision — external guardians are CODES, not account links.** Per Brett's direction, the
dashboard access-codes popup grows into a multi-code panel: "+ Add code" → name it ("Ms. Rivera
(teacher)") → pick permissions + schedule → a fresh persistent 8-char code, listed until
retired/deleted (retiring immediately stops it working; access can also just be scheduled off
and re-enabled without re-issuing). This REPLACES the earlier plan of account links for
externals: `careLinks` is now co-guardian-only, and `careAccessCodes` carries the external
role. If a code holder is granted `log`, their entries carry the code's label as the author
byline. On code length: generation-time collisions are prevented server-side regardless; 8
chars (no lookalike characters, ~1.1e12 combinations) was chosen over 6 purely as guessing
insurance since codes now grant scheduled data access. Legacy 6-char caregiver/doctor codes
are untouched and remain on their own paths.

## 9. Phase 1 implementation status

**Backend shipped (this repo, needs `convex deploy`):**
- `schema.ts`: `careLinks`, `careInvites`, `careAccessCodes`, `careSettings` (all additive).
  `careSettings` deliberately holds `dependentMode` + kid-device permissions OUTSIDE
  `patientProfiles`, because the mobile app replaces that document wholesale and would clobber
  unknown fields.
- `careSchedule.ts`: pure lazy access evaluator (always/disabled/one-time window/weekly with
  captured tz offset, next-opening computation) — unit-tested (8 tests), importable by mobile
  for UI copy while the server stays the enforcement boundary.
- `careCircle.ts`: invites (create w/ 3-cap, cancel, redeem→link), links (revoke by either
  side w/ last-co-guardian guard, leave, per-link permission + schedule edits), named access
  codes (create/update/retire/touch), `setDependentMode` (requires ≥1 co-guardian; the kid
  account cannot flip control back to itself), `getCircle` / `myMemberships` /
  `myDeviceSettings`, and permission+schedule-checked data reads for both member kinds
  (`glucoseForLink`, `profileForLink`, `resolveAccessCode`, `glucoseForAccessCode`,
  `profileForAccessCode` — slim profile only: never doctor/caregiver codes or access logs).

**Mobile (Phase 1) — SHIPPED (needs `convex deploy`):**
- Care Circle dashboard card + panel (`components/CareCirclePanel.tsx`): parent-kid toggle,
  co-guardian list + invite (code + OS share) + revoke/leave + 3-cap, named external access codes
  (create/edit/retire) with permission switches + schedule editor (always/weekly/one-time/off),
  memberships list, join-by-code. Status chips render the server's schedule evaluation.
- Co-guardian **viewing mode**: `AuthContext` overlay (`careMemberships`, `viewingPatientId`,
  `viewedProfile`, `enter/exitViewingMode`, `refreshCareMemberships`). While viewing, the exposed
  `profile` is the patient's slim profile, logs are empty (shared logs are Phase 2), and
  `isChildMode` is false (the co-guardian is admin, not restricted). `GlucoseContext` gates the
  own-account effects and polls `careCircle.glucoseForLink` every 60s (≤1-min freshness on the
  patient's ~5-min ingestion) and applies the viewed dose settings; reading-writes are hard-gated
  so a co-guardian never writes into the patient's stream. Glucose page shows a "Viewing Bella's
  data · Exit" banner, hides the own-CGM chip + sync hint, and the greeting reads "Bella's Guardian".

**Phase 2 — SHIPPED (needs `convex deploy`): shared authored log bucket.**
- Convex `careFoodLogs`/`careInsulinLogs` (indexed by patient+time and patient+clientId) +
  `careLogs.ts`: `addFoodLog`/`addInsulinLog` (idempotent on clientId), `importLogs` (one-time
  migration), `listLogs`, `clearFood`/`clearInsulin`, and code-authorized `*ViaCode` variants —
  all re-checking link/code permission + schedule; server sets the authoritative byline.
- `AuthContext`: `FoodLogEntry`/`InsulinLogEntry` gain `authorUserId`/`authorName`; on sign-in a
  one-time local→cloud migration (per-account flag) then hydrate + 60s poll of `listLogs` for the
  OWN patient (a co-parent's logs appear on their own within ~1 min); optimistic writes target the
  currently-displayed patient (viewed-or-own) and fire the Convex mutation; viewed-patient logs get
  their own 60s poll; `mergeCloudLogs` (extracted + unit-tested) keeps in-flight optimistic writes
  through a racing poll without resurrecting remotely-cleared entries. Because every feature reads
  `foodLog`/`insulinLog` from AuthContext, IOB/COB, insights, A1C, chat context, and the Logs tab
  all inherit the multi-author bucket unchanged. Co-guardian viewing now shows the patient's real
  shared logs (Phase 1 showed empty).
- Logs tab: "· by you" / "· by <name>" bylines on food + insulin rows.

**Caregiver-code unification — SHIPPED.** The new Care Circle `careAccessCodes` are now the ONE
caregiver-code system with a working entry/viewing flow: `enterCaregiverMode` accepts the 8-char
codes (via `resolveAccessCode` → checks view-readings + open schedule → `profileForAccessCode`),
keeping legacy 6-char codes as a fallback; `caregiverCodeKind` ("legacy"|"access") routes glucose
(`glucoseForAccessCode` vs `listRecentForCaregiver`, polled every 60s so an out-of-window code
stops showing data on its own) and the patient's shared logs (`listLogsViaCode`). The auth-screen
caregiver entry takes 6–8 chars; the dashboard caregiver-code section points into Care Circle.

**Polish — SHIPPED (OTA-safe, no native rebuild):**
- **QR sharing**: added `react-native-qrcode-svg` (pure JS — deps qrcode/prop-types/text-encoding,
  peer react-native-svg which is already in the build, so it ships over `eas update`). QR of the
  code renders on a white tile in the invite + caregiver-code result boxes and via a per-code "QR"
  toggle. It encodes the code string (a phone camera decodes it to text to type in — no in-app
  scanner, which would need a native camera module + rebuild).
- **Same-sensor finder** (manual, never a popup): `patientDexcomCredentials.usernameKey` (lowercased
  username) + `by_usernameKey` index, set on `upsertCredentials`; `careCircle.findSharedSensorAccounts`
  returns masked emails of OTHER accounts on the same Dexcom login (flagging already-linked ones).
  Care Circle "Sharing a sensor?" section: "Find accounts on my sensor" → masked matches → "Invite"
  (creates a co-guardian invite). Existing connections need one reconnect to populate `usernameKey`.
- **Out-of-schedule lock screen**: `AuthContext.accessLock` polled every 45s for the active caregiver-
  code or co-guardian-viewing session (via `resolveAccessCode` / `myMemberships` accessState) →
  `components/AccessLockScreen.tsx` full-screen overlay (mounted in `(tabs)/_layout`) with a
  window/disabled/removed message + next-opening time, and an Exit that ends the session. Replaces
  the previous "just shows no data" behavior.

**Remaining (optional, later):** duplicate-ingestion cleanup when a shared-sensor link is accepted,
universal-link deep-join (QR could then encode a URL), Libre same-sensor parity.

---
*Audit basis: convex/schema.ts, auth.ts, patientProfile.ts, patientGlucose.ts, cgmIngest.ts,
patientGuardianPin*.ts, doctor*.ts; mobile AuthContext/GlucoseContext, convex-auth-client,
onboarding, dashboard access-code sections, tab layout child-mode rules.*
