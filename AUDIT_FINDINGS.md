# Gluco Guardian — Audit Findings & Fix Queue

**Created:** 2026-08-04 · **Status:** open, nothing in Part 2 fixed yet

Working document. Every claim here was **read from source in this session** — line numbers verified by
hand, not taken from an agent summary or from docs. Where a doc or comment contradicts the code, the
code wins. Companion doc: `PERSISTENCE_MAP.md` (the full 134-item persistence table).

**Legend:** ⬜ not started · 🔍 needs reproduction · ✅ verified fixed · ❌ ruled out / not a bug

**Path abbreviations**

| Abbrev | Path |
|---|---|
| `AC` | `artifacts/mobile/context/AuthContext.tsx` |
| `GC` | `artifacts/mobile/context/GlucoseContext.tsx` |
| `DASH` | `artifacts/mobile/app/(tabs)/dashboard.tsx` |
| `DOCROUTE` | `artifacts/api-server/internal/routes/doctor.ts` |

---

## Part 0 — Already fixed & shipped (2026-08-04)

| Fix | Where | Shipped |
|---|---|---|
| Per-identity alert settings (one `pushTokens` row per token+identity) | `convex/push.ts` | OTA + Convex prod ✅ |
| Locked toggles hidden for caregiver/kid (Care Activity locked ON, Message Alerts, Emergency Text) | `DASH`, `PushContext.tsx` | OTA ✅ |
| Real-time readings for ALL viewer sessions (Convex subscription replaces throttleable 60 s timer) | `GC` | OTA ✅ |
| Settings lost-update race (6 racy read-modify-write callers → one serialized `mergeSettings` queue) | `GC` | OTA ✅ |
| Via-code log attribution now credits the **verified** caller, never a client-supplied id | `convex/careLogs.ts:436` | Convex prod ✅ |

---

## Part 1 — Ruled out (do not spend more time here)

### ❌ 1.1 Partner pushing an old commit did NOT undo anything

Definitive:

- `git rev-list --left-right --count master...origin/master` → **`0 0`**. Local and GitHub are identical.
- **Every commit in the history is authored by Brett Hoffman.** No other author exists.
- `git reflog` shows only linear commits — **no merges, no resets, no force-pushes**. Last commit
  `57fe3d6d`, Aug 3 22:22.

Why this mattered: OTA updates publish from this working tree, so a silent revert would have shipped
the regression to the phone in yesterday's three OTAs. It didn't.

### ❌ 1.2 The keyboard fix did not revert itself

- `useContainerKeyboardInset` was added Jul 27 in `56a3f46e` and is **unchanged since** —
  `git diff HEAD` on the keyboard files is empty.
- All three chat surfaces still consume it: `chat.tsx:593`, `CareThreadMessaging.tsx:104`,
  `DoctorMessaging.tsx:90`.
- **No `KeyboardAvoidingView` has crept back** into any chat surface. It exists only in `auth.tsx`,
  `onboarding.tsx`, `cgm-setup.tsx` — where it always was.

The reported symptom is real, but it is **not** a reverted fix. Cause unknown → see 🔍 2.1.

---

## Part 2 — Confirmed bugs, ranked

### 🔧 2.1 Chat keyboard regression — FIX SHIPPED, AWAITING ON-DEVICE CONFIRMATION

> **Update 2026-08-04.** Simulator repro is **impossible on this Mac**: full Xcode is not installed
> (`xcode-select -p` → `/Library/Developer/CommandLineTools`; no `/Applications/Xcode.app` anywhere;
> `simctl`/`xcodebuild` unavailable). Second blocker behind it: managed Expo app with no `ios/` dir
> (gitignored at `artifacts/mobile/.gitignore:13`), so a simulator run would also need
> `npx expo prebuild` + CocoaPods. Brett can't install Xcode right now → **fixed by construction
> instead.**
>
> **Root cause found by re-reading the hook** (not a guess): on iOS, `useKeyboardInset` registered
> **only** `keyboardWillChangeFrame` + `keyboardWillHide`. If the "will" event doesn't fire — the
> known Fabric/New-Architecture failure mode — there was **no fallback whatsoever**, so `inset`
> stayed `0` and the input sat under the keyboard. Exactly the reported symptom.
>
> **Fix applied** (`hooks/useKeyboardVisible.ts`):
> - `useKeyboardInset` now also listens to `keyboardDidChangeFrame` / `keyboardDidShow` /
>   `keyboardDidHide` on iOS. Worst case degrades to an un-animated jump instead of a hidden input.
> - `useKeyboardVisible` gets the same `did*` fallback, so the input bar can't keep its full resting
>   clearance while typing.
> - `LayoutAnimation.configureNext` is now wrapped in try/catch and only runs for "will" events — a
>   cosmetic animation can no longer prevent the inset from being applied.
> - Deliberately did **NOT** switch to the library `KeyboardAvoidingView`: per the comments at
>   `useKeyboardVisible.ts:28-38`, that is the thing that mis-measured on iPad and caused the
>   ORIGINAL bug. Reverting to it would reintroduce it.
>
> **Not verified locally** — no simulator, and no RN hook-test infrastructure in this repo (vitest
> runs in `edge-runtime`; zero tests import react-native). Typecheck passes, suite unchanged at the
> 7 pre-existing doctor failures. **Confirm on-device (iPhone AND iPad, AI chat AND Messages chat)
> before closing this item.** If it is still wrong on-device, the next suspect is the
> `useContainerKeyboardInset` `bottomGap` measurement (`:55-64`) mis-measuring a pageSheet mid-
> presentation — that would present as too MUCH space, not too little.

<details><summary>Original investigation notes (kept for reference)</summary>

**Symptom (user-reported):** on the Chat page the input bar is out of place / hidden behind the
keyboard again, on **both** the AI chat and the Messages chat.

Code is intact (§1.2), so the cause is environmental or a structural detail. Two concrete leads found
while reading:

1. **New Architecture + `LayoutAnimation`.** `app.json:10` has `"newArchEnabled": true`. The inset
   hook animates its padding via `LayoutAnimation.configureNext({update:{type:"keyboard"}})`
   (`useKeyboardVisible.ts:77-80`). `LayoutAnimation` is legacy-Paper API and behaves differently
   under Fabric — a padding change that never commits leaves the bar unmoved.
2. **The AI chat uses the RAW hook, the messaging components use the corrected one.**
   `chat.tsx:240` calls `useKeyboardInset()`; `CareThreadMessaging.tsx:70` and
   `DoctorMessaging.tsx:66` call `useContainerKeyboardInset()`. Defensible (the AI chat is a
   bottom-flush full screen) but it means the two surfaces can fail *differently* — and the user
   reports **both** are broken, which argues for a shared cause like lead 1.

**Verified NOT the cause** (checked, so don't re-check): no double-padding — the `<Modal>` (`:574`)
and the padded `<View>` (`:593`) are siblings, not nested; and the `chatLocked` branch (`:587`)
intentionally has no padding because the messaging components self-manage theirs.

#### Repro plan (iOS Simulator)

```
1. attach the live panel FIRST (cheap, opens instantly, surfaces device-access prompt)
2. build + launch the app
3. AI chat:      Chat tab → tap the input → screenshot → is the bar above the keyboard?
4. Messages:     Chat tab → Messages bar → open the Doctor thread → tap input → screenshot
5. Repeat both on an iPad simulator — the original fix existed specifically for iPad pageSheet
   mis-measurement, so iPhone-only testing can miss it
6. If both are wrong under Fabric: replace LayoutAnimation with a Reanimated/Animated driver, or
   adopt react-native-keyboard-controller's Fabric-aware primitives (already a dependency,
   ^1.18.5, and KeyboardProvider is already mounted at app/_layout.tsx:204)
```

Note: a device build is required to confirm the *fix*; the simulator confirms the *diagnosis*.

</details>

---

### 🟠 2.2 [PARTLY FIXED 2026-08-04 — needs a Vercel deploy + one env var] Two doctor API routes have no authentication

`DOCROUTE:711` `POST /api/doctor/sync` · `DOCROUTE:1275` `POST /api/doctor/order-decision`

Verified by enumerating all 24 routes in that file: these are **the only two** without
`requireDoctorAuth`.

- `/sync` (`:711-755`) overwrites the patient's entire clinical snapshot (profile, glucose, insulin,
  food, alert prefs) **and returns the doctor↔guardian message thread + pending proposal** in its
  response — so it is a read primitive as well as a write.
- `/order-decision` (`:1275`) records approve/decline on a clinician's insulin-dose proposal.
- Sole credential: a **6-char code in the request body**, minted with `Math.random()` at `AC:2467`
  (`generateDoctorCode`, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- `app.use(cors())` with no allowlist (`artifacts/api-server/internal/app.ts:7`) → reachable from any
  web page.

#### ⚠️ CORRECTION to the original audit recommendation

The persistence audit's #1 fix said "add `requireDoctorAuth` to both routes." **That would break the
app.** These routes are called by the **guardian app**, not the doctor portal:

- `AC:2781` → `fetch(apiUrl("/api/doctor/sync"))` — plain JSON POST, **no auth header**
- `AC:2811` → `fetch(apiUrl("/api/doctor/order-decision"))` — same

`requireDoctorAuth` (`artifacts/api-server/internal/doctor-auth.ts:63-85`) resolves a *doctor* id and
401s without one, so every guardian sync would fail and doctor messaging would silently go dark
(`AC:2786` `if (!res.ok) return;` — swallowed).

**Correct fix instead:** the 6-char code *is* the intended credential; harden it rather than swap it
for doctor auth.
- (a) ✅ **DONE — codes are now crypto-random.** New `artifacts/mobile/utils/accessCodeGen.ts`
      (`expo-crypto` `getRandomBytes`, rejection-sampled) used by BOTH `generateCaregiverCode` and
      `generateDoctorCode`. Also fixed the **server-side 8-char access codes**, which had the same
      `Math.random` weakness and are the primary caregiver credential —
      `convex/careCircle.ts randomCode()` now uses `crypto.getRandomValues` with a `Math.random`
      fallback (degrades rather than throwing, so a guardian can never be blocked from issuing a
      code). Shipped: OTA + Convex prod.
- (b) ✅ **DONE (with a caveat)** — `artifacts/api-server/internal/code-rate-limit.ts`, applied to
      both routes. 30 requests/minute per client IP, keyed by IP (not by code — keying by code would
      let an attacker rotate codes freely, which is the attack). ⚠️ In-memory and per-instance, so on
      Vercel it resets on cold start and isn't shared across lambdas: a speed bump, not a wall. The
      durable version keeps counters in Convex. **Follow-up.**
- (c) ✅ **CODE DONE, needs an env var** — `app.ts` no longer uses bare `cors()`. It allowlists
      `DOCTOR_PORTAL_ORIGINS` (comma-separated). Requests with **no** Origin are still allowed, so the
      mobile app is unaffected (React Native `fetch` sends no Origin); this only constrains browsers,
      i.e. the portal. If the var is unset it allows all origins and logs a loud warning at boot —
      chosen so a missing env var can't take the portal down, but that means **the hole stays open
      until the variable is set.**
- (d) Not done — a guardian-side shared secret would require a coordinated app + server change and a
      migration for existing doctor codes. With (a)+(b)+(c) the practical risk is much lower.

**Vercel status (Brett deployed the api-server 2026-08-05):**
1. ✅ **DEPLOYED** — the CORS allowlist and the per-IP rate limiter on `/sync` + `/order-decision` are
   now live, along with the AI-chat token-budget fix (see §4.1 below).
2. ⛔ **STILL OPEN — `DOCTOR_PORTAL_ORIGINS` is not set** (as far as I know; I don't read Vercel).
   Until it is, `app.ts` logs a loud boot warning and **allows all browser origins**, which is the
   fail-open branch — so the CORS half of this finding is deployed but INERT. Set it to the portal's
   exact origin(s), comma-separated, then redeploy.

---

### ✅ 2.3 [FIXED 2026-08-04, OTA] `signOut` leaves the whole previous account on the device — and `logout` that fixes it is dead code

Verified verbatim at `AC:1795-1807`. `signOut` removes exactly four keys:

```
SESSION_KEY, CAREGIVER_CODE_KEY, CARE_MEMBERSHIPS_KEY, CIRCLE_SHARED_KEY
```

and clears **no patient state in memory** — no `setAccount(null)`, no `setProfile(null)`, no log resets.

`logout` (`AC:2134-2174`) does the full teardown: 14 keys + every in-memory reset. **It is dead code** —
verified 3 references only: type decl `AC:276`, definition `AC:2134`, provider value `AC:2927`. Zero
callers. All four Sign Out buttons call `signOut`:

`DASH:329` · `SettingsModal.tsx:176` · `onboarding.tsx:881` · `onboarding.tsx:915`

**Survives sign-out on disk AND in memory:** profile, account, CGM connection, food log, insulin log,
emergency contacts, alert prefs, quick foods, glucose history, glucose settings, doctor messages,
therapy proposal. The boot loader (`AC:898-993`) re-reads them **unconditionally** — the account is
loaded at `:983-993` *before* the `storedSession === "true"` check at `:994`.

Real invariant: **cleared on account SWITCH, never on sign-out.** The window opens at sign-out and
never closes if the phone is simply handed to someone.

**Scope, stated honestly:** this is **identity/PHI disclosure, not account takeover.** Verified the
stronger reading and refuted it — `clerkSignOut()` (`AC:1797`) kills the token and `passwordHash` is
`""` for all Clerk-era accounts (`AC:1457`), so `userCompat` (`convex/identity.ts:70-82`) rejects any
write carrying the stale id. Exception: devices upgraded from the pre-Clerk build may still hold a
real hash in `ACCOUNT_KEY` (confirmed in git at `47e0a428^`), which that function still honors.

**Fix:** point the four call sites at `logout`, or copy its `multiRemove` list + in-memory resets into
`signOut`. Also force `passwordHash` to `""` when hydrating `ACCOUNT_KEY` (`AC:986`) so a legacy hash
can never be replayed.

---

### ✅ 2.4 [FIXED 2026-08-04, OTA] Two clinical keys are never cleared at any account boundary

| Key | References | Consequence |
|---|---|---|
| `@gluco_guardian_doctor_messages` | def `AC:388`, read `AC:924`, writes `AC:2666/2674/2703` — **zero `removeItem` anywhere in the repo** | The previous guardian's full doctor conversation hydrates at `AC:924` and renders for whoever is next on the phone |
| `@gluco_guardian_therapy_proposal` | def `AC:389`, read `AC:925`, write `AC:2729`, removed only `AC:2730` (null case) / `AC:2808` (on decide) | A pending insulin-dose change from account A can be shown to — and **approved by** — account B |

Both re-hydrate with **no session check**. Fix: add both keys to every clearing list (one line each).

---

### ✅ 2.5 [PARTLY FIXED 2026-08-04, OTA] Nine swallowed write failures — "saved" and "silently lost" look identical

Highest-suspicion explanation for the settings-revert reports **after** yesterday's race fix (and note:
`CLERK_JWT_ISSUER_DOMAIN` is correctly set on prod, so the previously-leading theory is ruled out).

Pattern: local state + AsyncStorage are written, the Convex mutation is fired **without await**, its
rejection is swallowed by `.catch(() => {})`, a success haptic fires unconditionally, then the 60 s
hydrate poll overwrites the value from the server.

Catch sites: `AC:705` (profile) · `AC:735` (CGM) · `AC:1921` / `AC:1995` / `AC:2052` / `AC:2087`
(logs) · `AC:2198` (emergency contacts) · `AC:2254` (quick foods) · `AC:2301` (alert prefs).
Unconditional success haptics: `DASH:275`, `DASH:321`, `DASH:453`, `food.tsx:319`.

**Fix applied to the explicit Save actions** (the ones behind the reported symptom):

| Writer | Now returns | Notes |
|---|---|---|
| `commitProfile` | `Promise<boolean>` | TRUE = server accepted, or local-only account (nothing to disagree) |
| `updateProfile` | `Promise<boolean>` | threads through BOTH branches, incl. the co-guardian `updateSharedProfile` path — which matters because §3.4's whole-patch rejection could silently discard a mixed save |
| `updateAlertPrefs` | `Promise<boolean>` | the backend mutation was fired **inside a `setAlertPrefsState` updater**, making it impossible to await (and a side effect inside a reducer). Hoisted out and computed from `alertPrefsRef` |
| `addEmergencyContact` | `Promise<boolean>` | safety-critical: a contact only on this device is invisible to other guardians and to the alert flow |

Callers gated via one shared `reportSaveResult(ok, what)` helper in `DASH`: success haptic only on a
real save, otherwise a Warning haptic + a "Couldn't save … it may revert" alert. Wired into
`saveThresholds`, `saveSettings`, and the add-contact flow. The doctor-session "Dosing Updated"
confirmation and its access-log entry now also only fire when the write actually landed.

**Deliberately NOT changed — fire-and-forget toggles** (`DASH:233`, `:912`, `:917`, `:1061`, `:1143`,
`:1331`, `:1368`, `:1792`). An alert on every toggle tap would be intrusive; the right pattern there is
optimistic-with-rollback (revert the switch when the write fails), which is a bigger change. Still a
real gap: a failed toggle reverts silently on the next poll. **Follow-up item.**

**Log writes** (`AC` food/insulin catch sites) are already covered differently and better by §2.6 —
they're preserved via `pendingSync` and retried, rather than reported.

---

### ✅ 2.6 [FIXED 2026-08-04, OTA] Unconfirmed log entries are DELETED from the device after 2 minutes

Worst data-loss path found. `utils/careLogsMerge.ts:14,23-25` keeps a local-only entry only while it is
younger than `OPTIMISTIC_KEEP_MS` (2 min), and **both** merge sites write the result back over
AsyncStorage (`AC:1277/1282` poll, `AC:2865/2870` subscription).

Sequence: log a 6 u bolus offline → persisted locally → mutation sits in the in-memory Convex queue →
force-quit (or iOS reclaims the app) → queue dies → next launch the merge drops the entry and
overwrites disk. `computeActiveInsulin` (`insulin.tsx:264`) then reports **0 u on board** and the
calculator recommends a full correction on top of unrecorded insulin. `importLogs` can't rescue it —
the migration marker (`AC:1248/1265`) is one-shot per account+bucket.

**Fix applied.** The root problem was that *age* was standing in for two different signals: "never
reached the server" (must keep) vs "was on the server and has since been removed" (must drop). The
docstring confirms the cutoff existed to respect a remote clear, so it couldn't simply be removed.

- `utils/careLogsMerge.ts` — `mergeCloudLogs` now keeps a local-only entry **regardless of age** when
  `pendingSync === true`, and still drops non-pending local-only entries, so remote deletes/clears
  behave exactly as before. The age cutoff stays as the fallback for entries written by older builds
  that carry no flag (so the upgrade window can't lose in-flight writes). **4 new tests** (10 total in
  that file), including one asserting a remote delete still sticks.
- `AC` — `pendingSync: true` is set on every optimistic entry and cleared by `clearPendingMarker`
  only once the server acknowledges it. Wired into **all 6 write sites** (food + insulin × nurse-view
  / access-code / own-account, with the own path clearing on the right list and storage key).
- `AC` (liveLogs effect) — **retry pass**: when a fresh cloud snapshot still lacks a pending entry,
  that entry is re-sent. Verified the upserts short-circuit on `(patientUserId, clientId)` with an
  explicit "idempotent — migration / retry safe" guard (`convex/careLogs.ts:202-208`, `:254-262`), so
  a retry cannot duplicate a dose. Without this, preserving entries locally would keep them off the
  server forever.
- `pendingSync` is **local-only** — both payload builders enumerate fields explicitly, so it is never
  sent to Convex and needs no schema change.

**Known limit (not fixed):** the retry runs on the own-account `liveLogs` subscription. Access-code
sessions have no such subscription (§3.2), so a caregiver's unsynced entry is now *preserved* but not
auto-retried until §3.2 gives those sessions a subscription too. Strictly better than deletion, and
§3.2 closes it.

---

### 🟠 2.7 [FIXED 2026-08-04 — PHASE 1 of 2, needs a phase-2 follow-up] Push settings authenticate on the Expo token alone

`convex/push.ts` — `setPrefs:181`, `setSounds:192`, `getPrefs`, `unregisterToken:171` accept a push
token with **no identity check**. Anyone holding a device's token can read its alert configuration or
**turn off its urgent-low glucose alerts**. `registerToken:132` already resolves an owner — apply the
same check.

Separately: **nothing calls `unregisterToken`.** A signed-out phone keeps receiving the previous
account's alerts until a different identity registers.

**Fix applied.**

**(a) Ownership verification** — new `assertOwnsRow` in `convex/push.ts`, applied to `setPrefs`,
`setSounds` and `getPrefs`. All three now take optional owner args and confirm the resolved owner
matches the device row. `resolveOwner` was widened to `QueryCtx | MutationCtx` so the query path can
use it. Client (`PushContext`) now sends owner args on all three calls. **2 new tests** (14 total in
that file): a foreign account's `setPrefs` is rejected and the urgent-low toggle is verifiably
untouched; the real owner still gets through.

**⚠️ PHASE 1 OF 2 — the fallback is deliberate.** Clients that predate this send NO credentials, and
rejecting them would break alert toggles for anyone who hasn't picked up the OTA (updates apply on the
SECOND launch, so there is a real window). So credentials are verified strictly WHEN PRESENT and the
old token-only path still works when absent. **PHASE 2: delete the `hasAuthArgs` fallback in
`assertOwnsRow` and make `resolveOwner` mandatory** once the OTA has saturated (days, not months).
Until then the hole is narrowed, not closed. Chosen because exploitability is low — push tokens are
never exposed by any endpoint or client surface — so a certain break for real users wasn't worth
forcing.

**(b) `unregisterToken` is now actually called.** New effect in `PushContext` keyed on the messaging
identity going from present to absent, using a `pushTokenRef` so it doesn't re-run on token changes.
Rows are parked, never deleted, so each identity's toggles and custom sounds are still there when it
signs back in.

---

### ✅ 2.8 [FIXED 2026-08-04, OTA + Convex prod] Offline sign-in can destroy the server profile

`AC:1506` queries the remote profile inside a try/catch (`:1514-1516`). Offline, it throws,
`nextProfile` stays null, and `AC:1555` **removes** `PROFILE_KEY` — the app treats the account as
un-onboarded. Completing onboarding then calls `patientProfile.replace`, a **whole-document replace**
(`convex/patientProfile.ts:164-168`), overwriting the server's doctor fields, `caregiverCode`,
`doctorCode` and the entire `accessLog`.

**Fix applied in two layers.**

**1. Root cause (client, `AC` `commitClerkAccount`).** One `catch` wrapped both the profile and CGM
queries, so `nextProfile === null` conflated "the server answered: no profile" with "the query threw".
Now tracked by a separate `profileFetchOk` flag, and the CGM fetch got its own `try` so a CGM failure
can't make the PROFILE result look unreachable. Three distinct outcomes:
| Situation | Behavior |
|---|---|
| Server answered, profile exists | write it to `PROFILE_KEY` (unchanged) |
| Server answered, no profile | clear `PROFILE_KEY` — genuinely un-onboarded (unchanged) |
| **Fetch threw (offline)** | **fall back to the cached profile and leave `PROFILE_KEY` untouched** |

**2. Backstop (server, `convex/patientProfile.ts` `replace`).** A whole-document replace shouldn't be
one bug away from data loss, so the existing `alertPreferences` carry-forward is extended to the
server-generated / append-only fields: `caregiverCode`, `caregiverCodeIssuedAt`, `doctorCode`,
`doctorCodeIssuedAt`, `accessLog`. Absence of those from a payload means "not included", never "delete".

**Deliberately NOT carried forward:** `doctorName` / `doctorEmail` / `doctorPhone` /
`doctorInstitution`. Those are user-editable, so clearing one must actually clear it. Note the client
sends the profile via `JSON.parse(JSON.stringify(...))`, which drops `undefined` keys — so a
carry-forward on those fields would have made them impossible to clear. **2 tests** cover both
directions: server-generated fields survive a partial save, and an editable doctor field can still be
cleared.

---

### ✅ 2.9 [FIXED 2026-08-04, OTA] CGM disconnect isn't durable — the server keeps ingesting

Disconnect while offline: `cgm-setup.tsx:174-176` swallows the credential clear, `AC:713` writes
`{type:null}` locally, `AC:723` `patientCgm.clear` throws, `AC:735-737` swallows it, and the UI shows
"Connect CGM". The server keeps `patientCgmConnections` + credentials, and `convex/crons.ts:18` keeps
polling every minute and publishing readings to caregivers and the doctor portal. The next
boot/sign-in (`AC:1045-1053`, `:1512-1513`, `:1558`) reads the surviving server row and flips the app
back to "connected" — **the server silently reverts the user's disconnect.**

**Fix applied — new `disconnectCGM()` in `AC`: SERVER FIRST, local state only on success.** Returns
FALSE when the server still holds the connection, and in that case nothing local changes, so the UI
keeps telling the truth instead of claiming "Connect CGM" while the cron keeps polling.

**Correction to the finding:** `patientCgm.clear` was never the problem — it already deletes the
connection row AND its `cgmSyncState` work-queue rows (`convex/patientCgm.ts`), so once it succeeds the
cron genuinely stops. The server only "kept everything" because the mutation's failure was swallowed.

**Explicitly preserved — auto-relink.** The server-wins rehydrate (`AC:1090-1098`, `patientCgm.get`)
and the connect path (`cgm-setup.tsx:107`) are UNCHANGED. An account keeps its CGM link forever and
re-attaches on any device; that behavior is correct and is precisely why a half-failed disconnect used
to come back. The fix makes the disconnect land — it does not weaken the rehydrate.

**Provider cross-wiring — two improvements:**
1. **Ordering reversed.** It used to clear the provider CREDENTIALS first, then the connection. If the
   connection clear then failed, the account was left "connected" server-side with **no credentials** —
   auto-relink broken and the ingest cron erroring against a sensor it could no longer authenticate to.
   Now the connection clears first (which stops the cron), and credentials only after.
2. **Provider pinned + strict.** `const provider = cgmConnection.type` is captured BEFORE the
   disconnect (reading it after would be `null`). And the branch is now `else if (provider === "libre")`
   instead of a bare `else`, which previously would have cleared **Libre** credentials for any
   non-Dexcom value including `null`.

**Verified separation is otherwise sound:** Dexcom and Libre credentials live in separate tables, and
`convex/cgmIngest.ts:83` dispatches on `args.provider` while `:92` additionally requires
`conn?.type === "dexcom"` before reusing a Dexcom session — so a Libre connection cannot pick up Dexcom
state.

---

### ✅ 2.10 [FIXED 2026-08-04, OTA] `doseSettingsByTime` never reaches viewer sessions

The server exposes it (`convex/careCircle.ts:177`) but every client-side viewer construction drops it:
`AC:2542-2552` (`enterViewingMode`), `AC:2592-2602` (`enterKidView`), `AC:2362-2372` (access-code
profile) copy only the base three; `GC:491` then forces it to `undefined`.

**A nurse or co-guardian doses on base ratios only** while the owner's phone uses the meal-window
override. Silent — no UI signal. Safety-relevant.

**Fix applied. Correction to the diagnosis first:** `GC:492` does NOT force `undefined` — it correctly
propagates `profile.doseSettingsByTime`. The bug was *entirely* that the viewer profile constructions
never populated the field, so GC faithfully propagated nothing. Fixing the constructions made GC work
with no change.

The server was never at fault either: `slimPatientProfile` (`convex/careCircle.ts:196-210`) has always
returned `doseSettingsByTime`, and `profileForAccessCode` spreads it. The data was on the wire the
whole time and the client discarded it.

Five sites now carry it (`AC`):
| Path | What it fixes |
|---|---|
| `restoreCaregiverCodeSession` | code session restored on cold start |
| `enterCaregiverMode` (access path) | caregiver/kid code sign-in |
| `enterViewingMode` | co-guardian viewing a linked patient |
| `enterKidView` | nurse viewing a child by code — **the field was missing from a hand-written local cast**, so TS was hiding it |
| doctor-sync snapshot | the clinician reviews dosing decisions; base-only hid the real math |

Chain verified end to end: profile → `GC:492` → `useGlucose().doseSettingsByTime` →
`effectiveDoseSettings(...)` (`utils/doseSettings.ts:49-59`) → `effSettings` → the recommended dose
(`insulin.tsx:334-336, :387-388`).

**Expected visible change:** a caregiver's recommended dose may now DIFFER from before — that is the
point; it now matches what the owner's phone computes at the same time of day.

---

### 🟢 2.11 [PARTLY FIXED 2026-08-04] Smaller confirmed items

| Item | Where | Consequence |
|---|---|---|
| Profile photo is a device-local `file://` path shared to all devices | `useProfilePhotoPicker.ts:43-45` → `convex/careCircle.ts:173` | Other devices show a permanently blank avatar (`ProfileChip.tsx:65-66` can never fall back to initials); fixed filename is not account-scoped, so B's photo overwrites A's |
| Emergency contact cap silently discards | `convex/careCircle.ts:746` | 6th contact reports success and vanishes (`MAX_EMERGENCY_CONTACTS = 5`) |
| Device-only notification toggles | `AC:2291`, excluded at `AC:492-504` | `notificationsEnabled` / `alertToChatOnOpenEnabled` don't sync across devices and reinstall re-enables them |
| Push prefs keyed by Expo token | `convex/push.ts:155-163` | Reinstall mints a new token → alert settings + custom sounds silently reset to defaults |
| Quick foods persist into the next household | not in `AC:1806` nor `exitCaregiverMode` `AC:2449-2456` | Household A's meal names show on B's Food tab |
| Exported reports never deleted | `DASH:500/558/645` | Full name + glucose + logs accumulate in `documentDirectory`, readable by the next account |
| Doctor PIN/password stored unsalted, compared with `===` | `convex/doctorAccounts.ts:68/92/216/240` | No KDF, no salt, no lockout. `convex/guardianPin/hashNode.ts:8` already has the correct scrypt pattern |
| CGM provider passwords plaintext at rest | `convex/schema.ts:303,319` | Must stay reversible for the ingest cron → needs envelope encryption, not hashing |
| Reinstall can adopt the previous user's account | `AC:1562-1566`, `:1604-1615`, `:1643-1650` | Clerk session survives app deletion in the Keychain and is silently adopted |
| Empty Convex codegen tracked in the mobile package | `artifacts/mobile/convex/_generated/` | Running `convex dev`/`codegen` from that dir would push an **empty function set**; `@/*` alias could resolve imports to the stub |
| Plaintext App Store reviewer password committed | `artifacts/mobile/BUILD_NOTES.md:47-48` | Live credential in git history — **Brett's decision 2026-08-04: LEAVE AS IS. Do not rotate, do not remove.** |

---

#### What was FIXED in this batch (2026-08-04)

**✅ Emergency-contact cap no longer discards silently.** `convex/careCircle.ts` now throws
`ConvexError` when the pool is full instead of a bare `return` that reported success — for data whose
entire purpose is being reachable in an emergency. The client refuses before writing anything
(`AC addEmergencyContact` checked the cap AFTER a `.slice(0, 5)` that quietly dropped the new contact
locally too), and `DASH` shows "Contact list full — you can have up to 5" rather than a generic
"couldn't save". Deployed to Convex prod + OTA.

**✅ Profile photo can no longer cross accounts.** `useProfilePhotoPicker.ts` wrote a FIXED
`profile_photo.<ext>` into documentDirectory, so two accounts on one phone wrote the same file:
whoever picked last overwrote the other, and since the stored path was byte-identical the first
account then displayed the second account's child — a PHI mis-association, not a cosmetic bug. Now
`profile_photo_<userId>_<timestamp>.<ext>`; the timestamp also busts the image cache, which fixes a
newly-picked photo appearing unchanged until restart.

**✅ Blank-avatar fallback.** `ProfileChip.tsx` committed to `<Image>` whenever the URI string was
truthy, so the initials fallback could never run and a co-guardian/nurse saw a permanently blank
circle (the path is a local `file://` that doesn't exist on their device). Now falls back to initials
via `onError`, and resets when the URI changes.

**✅ Stray Convex codegen removed.** `git rm -r artifacts/mobile/convex` + a `.gitignore` entry with
the reason. Running `convex dev`/`codegen` from that directory generated an EMPTY function set, and
pushing it would have wiped functions on whichever deployment was targeted. Verified nothing imports
it (mobile uses the explicit `../../../convex/_generated` path).

#### Still open in 2.11 — and why I did NOT do them

| Item | Why it's deferred |
|---|---|
| Doctor PIN/password unsalted, `===` compare | Hashing server-side **invalidates every existing doctor PIN and password** — needs a migration plan and a coordinated doctor-portal change, not a drive-by fix. `convex/guardianPin/hashNode.ts:8` already has the correct scrypt+`timingSafeEqual` pattern to copy. |
| CGM provider passwords plaintext at rest | Needs **envelope encryption**, not hashing (the ingest cron must decrypt them to log in). That means a key-management decision — where the master key lives, how it rotates — which is a design call, not a patch. |
| Exported reports never deleted from documentDirectory | Needs a retention policy decision (delete on share? on sign-out? after N days?). Low risk while the device isn't shared. |
| Push prefs reset on reinstall | Inherent to keying `pushTokens` rows by the Expo token, which changes on reinstall. Fixing properly means keying by account and migrating existing rows. |
| Reinstall can adopt the previous user's Clerk session | Clerk's Keychain session survives app deletion by design; the app already self-heals via `session_exists`. Changing it risks breaking legitimate re-installs. |
| Device-only notification toggles don't sync | Deliberate today (`AC:492-504` excludes them from the backend payload). Making them sync is a product decision about per-device vs per-account alerting. |

---

## Part 3 — Identity & scoping sweep

Individual vs linked accounts · per-device vs per-account values · logs & cross-logging names ·
co-guardian settings. All line numbers read from source in this session.

### ✅ 3.1 [FIXED 2026-08-04, OTA] A caregiver code session can see the previous guardian's logs labeled "· by you"

**This is a real cross-logging naming bug**, and it chains directly off §2.3.

The byline helper (`components/LogHistory.tsx:471-479`):

```ts
if (entry.authorUserId && myUserId && entry.authorUserId === myUserId) return " · by you";
return ` · by ${entry.authorName}`;
```

`myUserId = account?.convexUserId ?? null` (`LogHistory.tsx:82`).

The chain, verified line by line:

1. Guardian A signs in and writes logs → rows carry `authorUserId = A`.
2. A taps Sign Out. `signOut` (`AC:1795-1807`) does **not** null `account` in memory (§2.3).
3. Someone enters a caregiver access code **without restarting the app**.
4. `enterCaregiverMode` (`AC:2336-2445`) — scanned in full — contains **no** `setAccount(null)` /
   `accountRef.current = null`.
5. `myUserId` is therefore still **A's id**, so every one of A's log rows renders **"· by you"** to
   the caregiver.

**Why it's intermittent** (and easy to dismiss as a fluke): the *cold-start* restore path DOES clear
it — `AC:762-763`, comment "An access-code session is accountless — drop any stale signed-out account
state." So the bug appears only when the code is entered in the same app session as the sign-out, and
disappears after a restart.

**Fix:** null the account in `enterCaregiverMode` exactly the way `AC:762-763` already does. Fixing
§2.3 properly also closes this.

---

### ✅ 3.2 [FIXED 2026-08-04, OTA] Logs are NOT live for viewer sessions — the same bug I fixed for glucose readings

Identical shape to the caregiver staleness bug fixed yesterday: **the owner gets a Convex
subscription, every other identity gets a throttleable timer.**

The live logs subscription (`AC:2856-2860`) is gated:

```ts
!isLoading && isSignedIn && account?.convexUserId && !caregiverSession && !doctorSession
```

and its effect additionally bails on `viewingPatientIdRef.current` (`AC:2862`). So it is **skipped
for**: access-code sessions (caregiver + kid codes), doctor sessions, and co-guardians viewing a
linked patient.

Everyone excluded falls back to a 60-second `setInterval`:

| Timer | Line | Serves |
|---|---|---|
| `hydrateOwn` | `AC:1320` | own profile/memberships/settings |
| `fetchViewedLogs` | `AC:1353` | co-guardian viewing a linked patient |
| `fetchCodeLogs` | `AC:1386` | access-code sessions (caregiver + kid) |

iOS throttles and can suspend JS timers, which is exactly how the glucose version stretched from 60 s
to 10 minutes. **A caregiver watching a child can therefore be minutes behind on insulin and food
entries** — which matters for dose stacking, not just cosmetics.

**Fix applied.** Two reactive subscriptions added in `AC`, mirroring the readings fix:
- Access-code sessions → `useQuery(api.careLogs.listLogsViaCode, { code })`
- Nurse kid-view → same query with `nurseViewCode`; co-guardian link-view → `useQuery(api.careLogs.listLogs, { patientUserId })`

Both viewer timers retired (`fetchViewedLogs`, `fetchCodeLogs`); their one-shot fetches stay for
instant paint. The only remaining 60s/45s timers are `hydrateOwn` (profile/memberships/settings — not
logs) and `checkAccess` (the schedule lock), which are correct to keep.

**Also closed the §2.6 retry gap:** code sessions now retry their own `pendingSync` entries on each
snapshot via `addFoodLogViaCode`/`addInsulinLogViaCode`, so a caregiver's offline entry is no longer
merely preserved — it actually syncs.

**⚠️ CORRECTION to something I claimed earlier.** When shipping the readings fix I wrote (in code and
in chat) that the subscription "drops data the moment a code falls outside its schedule window, since
the query re-evaluates server-side." That is **imprecise**: Convex invalidates on DATA changes, not
wall-clock time.
- A **revocation or permission edit** is a row write → the query re-fires immediately. ✅
- A **schedule window closing** is pure time → the query does **not** re-fire on its own.

Security is intact because that case is owned by a different mechanism I did not touch: the 45s
`checkAccess` watcher (`AC:1428-1458`) resolves the code, sets `accessLock`, and
`AccessLockScreen` (rendered at `app/(tabs)/_layout.tsx:124`) blocks the entire tab UI. Both paths are
needed; neither replaces the other. Comments in `AC` and `GC` corrected to say this accurately.

---

### 🟡 3.3 Per-device vs per-account: 12 of 13 keys are device-global

Read from `AC:372-389`. **Exactly one** key is account-scoped:

- `LOGS_MIGRATED_KEY_PREFIX` (`AC:377`) — suffixed with the Convex userId, per its comment.

**All twelve others are single global keys with no account in the name**: `PROFILE_KEY`, `CGM_KEY`,
`FOOD_LOG_KEY`, `INSULIN_LOG_KEY`, `EMERGENCY_CONTACTS_KEY`, `ALERT_PREFS_KEY`, `ACCOUNT_KEY`,
`SESSION_KEY`, `CAREGIVER_CODE_KEY`, `CARE_MEMBERSHIPS_KEY`, `CIRCLE_SHARED_KEY`,
`DOCTOR_MESSAGES_KEY`, `THERAPY_PROPOSAL_KEY`.

So **every persisted value is per-device, not per-account.** Correctness depends entirely on clearing
them at each identity boundary — which is precisely what `signOut` fails to do (§2.3) and what leaves
the clinical keys stranded forever (§2.4). This is the structural reason the shared-phone bugs keep
recurring in different forms.

**Note:** this is a design choice, not automatically a defect — one account per device is the common
case. But it means *every* new persisted value needs a clearing-list entry, and there is no test
enforcing that. Worth a single "keys cleared at identity boundary" test that fails when a new key is
added without one.

---

### ✅ 3.4 [FIXED 2026-08-04, OTA] Co-guardian profile edits are all-or-nothing, and the client offers more than the server allows

Two lists that don't line up:

- **Client** routes **14** fields through `updateSharedProfile` — `SHARED_PROFILE_EDIT_KEYS`
  (`AC:507-521`).
- **Server** rejects **7** of those for non-owners — `OWNER_ONLY_PROFILE_FIELDS`
  (`convex/careCircle.ts:597-605`): `dateOfBirth`, `weightLbs`, `insulinTypes`, `carbRatio`,
  `targetGlucose`, `correctionFactor`, `doseSettingsByTime`.

The rejection is **whole-patch, not per-field** (`convex/careCircle.ts:709-711`): the loop `throw`s on
the first owner-only key *before applying anything*. So a member saving a mixed patch (say doctor's
phone **and** the child's weight) has the **entire** save discarded — including the 7 fields they are
allowed to change — and the rejection is swallowed client-side, so the UI reports success and reverts
on the next poll.

**Honest status: latent, not live.** The UI currently gates members out of those fields
(`DASH:1587`, `DASH:1760`, `SettingsModal.tsx:154-155`, `GC:247`), so today the server guard is a
backstop. It becomes a live bug the moment any of those gates is removed or a new mixed-save form is
added.

**Fix applied — client-side filtering, server left fail-closed.**

**I tried the doc's suggested fix first (server skips owner-only keys and returns them) and BACKED IT
OUT.** The full suite caught it: `convex/careCircle.test.ts:338` ("enforces owner-only edits") asserts
the mutation *throws*. On reflection the existing contract is the better one — a partial write would
report failure to the user while some fields had in fact changed, which is worse than a clean
rejection, especially for dosing fields. Skipping also silently depends on every caller inspecting the
returned list.

So the server keeps throwing (comment added explaining it is a BACKSTOP, not the everyday path), and
the client stops sending fields it isn't allowed to change:
- New `artifacts/mobile/utils/sharedProfilePatch.ts` — `splitSharedProfilePatch(patch, isOwner)` →
  `{ sendable, blocked }`, mirroring the server's `OWNER_ONLY_PROFILE_FIELDS`. **5 tests**, including
  one that pins the mirrored list so editing the server list without updating the client fails loudly.
- `AC updateProfile` sends only `sendable`, so a member's legitimate edits always land. Blocked fields
  are rolled back in the optimistic circle overlay (and its cached copy) so the UI stops showing a
  value the server refused, and `sharedOk` goes false so §2.5's "couldn't save" path still fires.

Net effect: the normal member flow no longer loses data, and the server throw is now genuinely
unreachable except via a client bug — which is exactly what a backstop should be.

---

### ✅ 3.5 CLEAN — `isChildMode` conflation is fully resolved

Swept all 30 references across `app/`, `components/`, `utils/`, `hooks/`, `context/`. **Every**
remaining use correctly pairs with `caregiverSession`:

- Kid-only checks use `isChildMode && !caregiverSession` — `DASH:779`, `:2089`, `_layout.tsx:50`,
  `dashboardSections.ts:59`, `chatSpeaker.ts:55`
- Owner-only checks use `!isChildMode && !caregiverSession` — `DASH:1845`, `:2038`, `:2063`,
  `dashboardSections.ts:52`, `:62`, `:64`
- Edit gates add `!caregiverSession && !doctorSession` — `DASH:670`, `:2221`

No bare `!isChildMode` misclassifying caregivers remains. The trap is documented in-code at
`dashboardSections.ts:42-43` and `chatSpeaker.ts:6`, and both have test coverage.

---

### ✅ 3.6 CLEAN — server-side author naming is sound

`guardianDisplayName` (`convex/careLogs.ts:71-88`) resolves in the right order and explicitly avoids
the co-guardian trap where every byline collapses to the child's name: `parentName` → own name in
`childName` for `adult`/`caregiver` roles → email handle → last-resort. The comment at `:63-70`
documents the "everything says Bella" bug it prevents.

Reads re-derive the **current** name rather than trusting the stored snapshot — `bylineFor`
(`convex/careLogs.ts:487-497`) prefers `liveNames` over `row.authorName`, so a rename retroactively
corrects historical bylines.

Combined with the §Part 0 attribution fix (credit the *verified* caller), the server side of
cross-logging is now correct. The remaining cross-logging defect is client-side only: §3.1.

---

## Part 3.5 — What was fixed in the teardown pass (2026-08-04)

Verified necessary before changing anything; the full chain was traced line by line.

**Confirmed reachable, not theoretical:**
- `AC:992-993` sets the account into memory **before** the session check at `:994` → a cold start
  after sign-out restores the signed-out identity.
- `AC:937-941` restores the profile with **no session check at all**.
- `auth.tsx:43-44` seeds `mode="signin"` and the email from that stale account, rendered at `:315`.
- `auth.tsx:66` lets you enter a caregiver code **directly from the auth screen** — so
  sign-out → code entry needs no restart, which is what makes §3.1 reachable.
- `enterCaregiverMode` had no `setAccount(null)` on any of its 3 session paths.

**The trap I nearly walked into:** `onboarding.tsx:880` carries the comment *"Keep everything —
signing in with this email returns to setup right here."* The "finish later" escape hatch
**depends on `signOut` being non-destructive.** Making `signOut` destructive globally would have
broken it. Verified `setupProfile` is only called at onboarding **completion** (`onboarding.tsx:113`,
`:143` both build a full profile), so no partial progress lives locally and resume works off server
state.

**Fix applied — per call site, not global:**
| Change | File |
|---|---|
| Real sign-out buttons now call `logout` (full teardown) instead of `signOut` | `DASH:329`, `SettingsModal.tsx:176` |
| Onboarding "finish later" **left on `signOut`** so setup still resumes | `onboarding.tsx:881`, `:915` |
| `logout` now also clears `DOCTOR_MESSAGES_KEY` + `THERAPY_PROPOSAL_KEY` and their in-memory state | `AC:2134-2175` |
| Access-code entry drops a stale **signed-out** account on all 3 paths (guarded on `!isSignedIn` so an owner self-test is untouched) | `AC:2346+` |
| `resetGlucoseData()` on sign-out and on access-code entry — `logout` clears glucose storage keys but cannot reach another context's memory, so the previous patient's 300 readings stayed live | `DASH`, `SettingsModal.tsx`, `auth.tsx` |

`logout` verified as a strict superset of `signOut` (same `clerkSignOut` + session resets, plus 14
keys and all in-memory clears). `signOut` is still used by onboarding, so it is not dead code.

**One visible behavior change:** after a full sign-out the auth screen no longer prefills the email
and opens on "Create Account" rather than "Sign In" — identical to a fresh install. There is a
two-tab toggle at the top (`auth.tsx:281-305`), so it's a single tap. Say the word if you'd rather
default to Sign In.

**Not covered by this pass:** §2.8 (offline sign-in destroying the server profile) is unchanged —
`AC:1555` already removed `PROFILE_KEY` in that path before this change, so no new risk was
introduced, but it remains worth fixing.

---

## Part 4 — AI chat audit (2026-08-05)

### ✅ 4.1 Truncated replies + "Sorry, I had trouble thinking of a response" [FIXED — Vercel deployed]

One cause for both. `artifacts/api-server/internal/routes/chat.ts` called `openai/gpt-5.2` with
`max_completion_tokens: 180`. That model is a **reasoning** model, so the value is a budget for
reasoning tokens PLUS visible output — not a reply-length cap. Long reasoning passes therefore produced
either a reply cut off mid-sentence, or empty `message.content`, which the client rendered as the
"trouble thinking" fallback. Looked exactly like an outage or a billing failure while OpenRouter was
healthy, which is why it went unexplained for so long.

- Budget raised to **2000**. Replies do NOT get longer — brevity is enforced by the prompt
  ("KEEP IT SHORT: 2–3 plain sentences maximum", `chat.ts:260`), never by this ceiling.
- **One retry at 4000** if content still comes back empty. Empty replies are nondeterministic, and a
  caregiver asking about a high reading is the worst moment to get a shrug. Costs an extra call only
  on that rare path.
- Logs `finish_reason` + token usage on an empty reply, so a recurrence is diagnosable rather than
  guessed at.

### ✅ 4.2 A co-guardian was addressed by the circle OWNER's name [FIXED, OTA]

`useAuth().profile` is the EFFECTIVE profile, which becomes the **viewed patient's** while a
co-guardian views a linked patient — so `profile.parentName` resolved to the circle owner. Dad viewing
Bella (owned by Mom) was greeted "Hey Mom!" and described to the model as *"Mom, Bella's guardian."*

Fix: new `ownParentName` on AuthContext — the signed-in person's own name, unaffected by whose profile
is being viewed (`parentName` is not a shared-overlay field, so the own profile always has the right
one). `chat.tsx` uses it for the SPEAKER while the PATIENT's name still comes from the effective
profile. That split is the fix.

### ✅ 4.3 Speaker resolution audited across all identities [VERIFIED, 9 new tests]

`utils/chatSpeaker.test.ts` (17 total) now pins every case Brett specified: guardian → "Brian, Bella's
guardian"; adult → their own name; kid code → the kid's name; caregiver code → "Bella's caregiver";
legacy code with no role → caregiver; caregiver email account → caregiver; caregiver email inside a
linked kid's view → that kid's caregiver. Plus an ordering guard that a kid's own code can never be
classified as a caregiver even when every caregiver signal is set simultaneously.

---

## Part 5 — Suggested order of work

1. **§2.1** — simulator repro of the keyboard (you asked to start here; it's also the cheapest to confirm)
2. **§2.3 + §3.1 + §2.4** — one change: make `signOut` do a full teardown, null the account in
   `enterCaregiverMode`, add the two clinical keys. Closes the whole shared-phone leak class **and**
   the "· by you" mislabeling.
3. **§2.6** — pending-log durability (worst data-loss path; insulin stacking risk)
4. **§3.2** — reactive logs for viewer sessions (mirrors the readings fix that already worked)
5. **§2.5** — stop swallowing write failures; gate the success haptics
6. **§2.2** — harden the doctor codes + CORS (**not** `requireDoctorAuth` — see the correction)
7. **§2.10 / §2.9 / §2.8 / §2.7** — dose overrides for viewers, durable CGM disconnect, offline-signin
   guard, push-token identity checks
8. **§2.11** — the smaller items, incl. rotating the committed reviewer password
