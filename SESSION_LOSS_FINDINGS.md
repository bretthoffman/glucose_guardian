# Gluco-Guardian — Three-Symptom Investigation (read-only)

Repo at `master` / `7088c98d`, analysed 2026-08-14. Nothing was edited, deployed, or mutated. Every claim below cites installed source; where I could not verify something I say so.

---

## 1. Verdict per symptom

### Symptom 1 — "Please sign in again" banner + stale readings

**Answer to your most urgent question first: the banner is NOT a spurious UI bug, but its stated diagnosis is wrong in the most likely case.**

Split it in two:

* **The trigger condition is trustworthy.** `sessionExpired` fires only when Clerk's own `useAuth().isSignedIn === false` while the app still believes it is signed in (`artifacts/mobile/context/AuthContext.tsx:2114-2127`, `clerkIsSignedIn` sourced at `:689`). Nothing in the app can force that flag false. When it is false, `ConvexProviderWithClerk` reports unauthenticated, `userCompat` returns `null` rather than throwing (`convex/identity.ts:70-82`), and `patientGlucose.listRecent` returns `[]` (`convex/patientGlucose.ts:176-179`). The merge effect refuses to overwrite local history with an empty result (`artifacts/mobile/context/GlucoseContext.tsx:271`), so the cached last reading stays on screen and its age grows — which is *exactly* the "Updated 68h ago" wording produced at `artifacts/mobile/app/(tabs)/index.tsx:430-434`, with `CGMChart` printing "No readings in this window" (`artifacts/mobile/components/CGMChart.tsx:598`). **The data outage is real. Suppressing the banner would hide a live fault.**
* **The explanatory text is wrong more often than not.** The alert says "your session has expired — this usually happens after changing your password" (`artifacts/mobile/app/(tabs)/index.tsx:1070`). The predicate cannot distinguish a revoked session from a Clerk client that failed to load, and on React Native the second is the more reachable of the two.

**Most likely cause — Clerk's cold-start client fetch fails soft on native, leaving the app "loaded and signed out" while the real session token is intact in SecureStore.** `ClerkProvider` is mounted with only `publishableKey` + `tokenCache` (`artifacts/mobile/app/_layout.tsx:194-196`). Verified consequences in the installed SDKs:

* `clerk-expo` therefore sets `standardBrowser: !isNative()` = false and `rethrowOfflineNetworkErrors: !!__experimental_resourceCache || …` = falsy (`node_modules/.pnpm/@clerk+clerk-expo@2.19.31_…/dist/provider/ClerkProvider.js:70-74`).
* The cached-resource fallback and the FAPI retry loop are both inside `if (createResourceCache)` (`…/clerk-expo/dist/provider/singleton/createClerkInstance.js:87-127`) — neither is wired.
* In `clerk-js` 5.127.1, the "are we online?" helper is `function c(){let e=a()?window?.navigator:null;if(!e)return!1;let t=e?.onLine;…}` — `navigator.onLine` is undefined in RN, so it is **always falsy**; `_baseFetch` then hits `if(!d())return … "Network request failed while offline, returning null"` and swallows the transport error (`node_modules/.pnpm/@clerk+clerk-js@5.127.1_…/dist/clerk.headless.js:1`).
* `Client.fromJSON(null)` is a no-op, so Clerk comes up with an empty client, status `ready`, `isLoaded: true`, `isSignedIn: false`. The native load path installs no token poller and no focus refresh, so **it never self-heals for the rest of the app run** — which matches both "68h ago" and "signing out and back in fixes it".

**Confidence: high** that this mechanism exists and produces the exact symptom; **medium** that it is what actually fired for these users, because a genuinely expired/revoked Clerk session produces a byte-identical client state. The two are separable only from the Clerk dashboard (see §5).

One narrowing detail worth knowing: this needs a **split** failure — Clerk FAPI unreachable while Convex is reachable. A total outage instead trips `restoreConvexBackedSession`'s 10s timeout (`AuthContext.tsx:667-683`), which deletes `SESSION_KEY` at `:1196` and dumps the user at `/auth` with **no** banner. Different hosts, so a `clerk.accounts.dev` incident satisfies the conjunction precisely.

### Symptom 2 — co-guardian's carbRatio changed on its own

**Fully explained from code. Deterministic, not a race. Highest severity.** See §2. Cause: `artifacts/mobile/context/GlucoseContext.tsx:245-261` pushing hardcoded defaults into `patientProfile.replace`. **Confidence: high.**

### Symptom 3 — access-code session logged itself out

**Most likely cause: a single accidental tap on an "Exit" control that had no confirmation in builds before 2026-08-06.** Both exits called `exitCaregiverMode()`, which deletes the stored code at `AuthContext.tsx:2826` (`AsyncStorage.removeItem(CAREGIVER_CODE_KEY)`) — irreversible for an accountless session.

* `AccessLockScreen` used to render a single primary **"Exit"** button in the dismiss position of a blocking screen. That screen appears whenever the code is merely **outside its schedule window** (`AuthContext.tsx:1544-1548`, reason `outside_window`). The confirm gate + "no primary action for access-code sessions" was added in `7088c98d` (2026-08-06) — see `artifacts/mobile/components/AccessLockScreen.tsx:56-123` and the commit's own comment: the old button "read as 'close this message' — but it ended the session".
* The Dashboard's top banner **Exit** was `onPress={() => { exitCaregiverMode(); … }}` with no confirmation until `9ee98d62` (2026-08-06) added `confirmExitCaregiver` (`artifacts/mobile/app/(tabs)/dashboard.tsx:350-375`).

This is precisely why the user believes "there are supposed to be safeguards" — **there are, as of 2026-08-06; they did not exist in earlier builds.** **Confidence: medium-high**, contingent on the user's build predating that OTA (unverified — see §5).

Second candidate, still live in HEAD: if the owner un-toggles **"View glucose readings"** (`artifacts/mobile/components/CareCirclePanel.tsx:258`, saved via `careCircle.updateAccessCode`), the code still resolves non-null but `AuthContext.tsx:913-916` calls `clearAndBounce()` on the next cold start and wipes the credential permanently. **Confidence: medium** — it requires a deliberate owner edit plus a later re-enable to match "the owner gave me the code again and it worked".

Explicitly ruled out for symptom 3:

* The new banner. It is gated on `isSignedIn === true` (`AuthContext.tsx:2116`), which a code session never has. It cannot render, so its `signOut()` (which *does* clear `CAREGIVER_CODE_KEY` at `:1977`) is unreachable here.
* Network faults. The restore path deliberately falls through to a cached optimistic restore on timeout/offline (`AuthContext.tsx:974-986`), and the 45s watcher swallows errors (`:1560-1562`). Those safeguards are real and I confirmed them holding.

---

## 2. The carb ratio change — exact sequence

**Severity: critical.** This is not a display bug. It overwrites the stored dose math for the circle **owner**, and every co-guardian, access code, and the doctor portal inherit the wrong numbers. It also puts the owner's *own* Insulin tab on default math immediately, because `insulin.tsx:138` and `:350` read the `GlucoseContext` locals, never `profile`.

The trigger is **any sign-in** — including the one your banner tells people to perform (`index.tsx:1073`).

1. **Sign-out.** Banner tap → `signOut()`; or `dashboard.tsx:386` / `SettingsModal.tsx:181` → `logout()` (which removes `GLUCOSE_SETTINGS_STORAGE_KEY` at `AuthContext.tsx:2474`) plus `resetGlucoseData()` (`GlucoseContext.tsx:557-564`, sets 15/120/50 and removes the key).
2. **Sign back in.** `commitClerkAccount` fetches the **real** profile and sets it (`AuthContext.tsx:1699-1700`), sets `isSignedIn` true (`:1703`), nulls `circleShared` (`:1693-1694`), and then unconditionally deletes `GLUCOSE_SETTINGS_STORAGE_KEY` (`:1709-1719`, key at `:1715`).
3. **Local dose math falls to hardcoded defaults.** The settings effect re-runs on the `isSignedIn`/`account` change, finds no key, and takes the else branch: `setCarbRatioState(15); setTargetGlucoseState(120); setCorrectionFactorState(50); setDoseSettingsByTimeState(undefined)` (`GlucoseContext.tsx:227-232`). Nothing ever re-seeds local from `profile` for an owner — the only profile→local path is gated on `caregiverSession || viewingPatientId || isCircleMember` (`GlucoseContext.tsx:486-501`). **On the next cold start this is unconditional**, because the mount loader only assigns when the key exists (`GlucoseContext.tsx:196-202`) and `useState` defaults are 15/120/50 (`:141-144`).
4. **The backfill effect fires.** `GlucoseContext.tsx:245-261`. Every guard passes: `authLoading` false; `isLoading` false — it is a mount-once flag (`:140`, `:204`, `[]` deps at `:207`) and `GlucoseProvider` is mounted above the router (`app/_layout.tsx:203`) so it never remounts; no viewing/nurse/caregiver session; `isCircleMember` false (`AuthContext.tsx:1236` — always false for an owner, and just forced false for a member at `:1693`); `profile` non-null; role not `caregiver`.
5. **The diff at `:250-255` is true** (real 8 ≠ default 15) → `void updateProfile({ carbRatio: 15, targetGlucose: 120, correctionFactor: 50, doseSettingsByTime: undefined })` (`GlucoseContext.tsx:256`). The returned failure boolean is discarded.
6. `updateProfile` sees `circleSharedRef.current === null` and skips the circle route, falling through to `commitProfile` (`AuthContext.tsx:2044-2046`).
7. `commitProfile` does `JSON.parse(JSON.stringify(updated))` at `AuthContext.tsx:808` — which **drops** the `undefined` `doseSettingsByTime` — then calls `api.patientProfile.replace` (`:809`).
8. **Whole-document replace.** `convex/patientProfile.ts:188` is `ctx.db.replace`. The carry-forward block (`:156-186`) preserves `alertPreferences`, `caregiverCode`, `doctorCode`, `accessLog` — and **not** `carbRatio` / `targetGlucose` / `correctionFactor` / `doseSettingsByTime`. The real values are overwritten with 15/120/50 and the per-meal overrides are **deleted**, not merely stale.
9. **Fan-out.** `careCircle.circleContext` serves the owner's row to every member (`convex/careCircle.ts:721-724`); the client stores it (`AuthContext.tsx:1316-1341`) and `GlucoseContext.tsx:486-501` writes it into each member's state **and persists it to their device** (`:493-499`). Access-code and nurse sessions get the same values via `slimPatientProfile` (`convex/careCircle.ts:217-220`), and the doctor portal via `syncToDoctor` (`AuthContext.tsx:3154`).

**Direction matters, and it resolves the "the owner didn't change it" paradox.** A member *cannot* corrupt the owner: those four fields are stripped client-side (`artifacts/mobile/utils/sharedProfilePatch.ts`, invoked at `AuthContext.tsx:2013`) and rejected server-side (`convex/careCircle.ts:759-767`). The circle-wide change therefore **must** have originated on the owner's device — and the owner did change it, unknowingly, by signing in.

**Member-side variant (separate, quieter damage):** between a member's sign-in and their first successful `circleContext` response, `isCircleMember` is false, so the same backfill stamps 15/120/50 onto the member's **own** `patientProfiles` row. Invisible while they stay linked (the owner overlay shadows it) but it becomes their real settings if they ever leave the circle — the exact fallback the comment at `GlucoseContext.tsx:483-485` promises. Note cold starts are safe for members: `circleShared` is restored from cache first (`AuthContext.tsx:1094-1099`). Owners have no such protection.

**Timeline.** The backfill landed 2026-07-22 (`45378934`); the sign-in wipe of the settings key has been there since 2026-04-26 (`f35225bc`). The pair has been armed and dormant for weeks, waiting for a sign-out/sign-in.

---

## 3. Why multiple users at once

Three candidate triggers, in descending order of evidential support.

**(a) A visibility change, not a behaviour change — strongest explanation for symptom 1 clustering.** Commit `7088c98d` (2026-08-06) added *both* the `sessionExpired` detector (`AuthContext.tsx:2114-2127`) *and* the banner (`index.tsx:1064-1088`). The same commit rewrote `updatedLabel` to prefer the newest reading's age over the sync time (`index.tsx:419-435`) — literally the change that turns "Updated just now" into "Updated 68h ago". A pre-existing, previously-silent failure mode became two loud, identically-worded reports for the whole install base the day that OTA landed. Your own comment at `AuthContext.tsx:2098-2107` documents that users used to report this as a *Dexcom* fault. **This does not require any new fault at all.**

**(b) Symptom 2's clustering is fully derivative.** The banner instructs users to sign out and back in; §2 fires on exactly that. Several accounts pushed through the same transition in the same window is sufficient — no separate trigger needed.

**(c) A correlated Clerk-side event.** Any of: a `clerk.accounts.dev` FAPI/DNS blip (breaks every device that cold-starts during the window, permanently for that run, per §1); or a **session max-lifetime cohort expiry**. The Clerk cutover shipped in one build (`ClerkProvider` first appears in `_layout.tsx` in `47e0a428`, 2026-07-27), forcing a synchronised first sign-in; if the dashboard is at Clerk's 7-day default, that cohort expires together, and each round of "sign out and back in" *re-synchronises* the next one. This fits a recurring weekly cadence.

**On the `pk_test` / development-instance angle specifically — the evidence is weaker than it looks, and I will not overstate it.** Confirmed facts: the key is a development key (`artifacts/mobile/.env:8`, `pk_test_…` decoding to `next-osprey-15.clerk.accounts.dev`), matching `convex/auth.config.ts:19`; and `clerk-js` itself warns at load that "Development instances have strict usage limits and should not be used when deploying your application to production."

But **I found no code path in the installed SDKs that shortens the session or token lifetime purely because the key is `pk_test`.** The token lifetime is 60s either way; `standardBrowser` and `rethrowOfflineNetworkErrors` are decided by platform and by whether you passed a resource cache, not by the key. So `pk_test` is **not** by itself an explanation. What it *does* mean is: lower rate limits, shared non-SLA infrastructure (raising the odds of the §1(c) blip), and session lifetime governed by an instance dashboard setting that `docs/specs/mobile_clerk_authentication_and_ota_feasibility_audit_v1.md:597` records as **never verified**. That unverified setting is the single highest-value thing to check.

Symptom 3 was reported by one user and needs no cluster explanation.

---

## 4. Ranked fixes

**Ship #1 before anything that increases sign-in frequency.** Fixing the banner without fixing #1 makes the dosing corruption *more* frequent.

| # | What | Where | Minimal change | Risk |
|---|---|---|---|---|
| 1 ✅ | **Never let placeholder defaults become a server write** | `artifacts/mobile/context/GlucoseContext.tsx:245-261` | Add a `settingsFromStorage` ref: set true in both loaders' `if (settings)` branches (`:196`, `:217`), false in the else branch (`:227`) and in `resetGlucoseData` (`:557`); early-return from the backfill when it is false. | Near-zero. Only loses the backfill on a device that had nothing real to contribute — which is exactly the case it must not run in. |
| 2 ✅ | **Seed local dose math from the profile when the cache is absent** | `GlucoseContext.tsx:227-232` | Instead of hardcoding 15/120/50, read from `profile` (via a ref, so the dep array at `:237` need not widen). | Low. Fixes the *other* half: without it, an owner's calculator (`insulin.tsx:138,350`) still runs on defaults after every re-login even once #1 stops the write. Do **not** widen deps without a ref, or a later hydrate poll could stomp a fresh user edit. |
| 3 ✅ | **Gate the backfill on a resolved circle role** | `GlucoseContext.tsx:247`, `AuthContext.tsx:1318-1341` | Expose a `circleResolved` flag set true in **both** branches of the `if (circle)` block; require it in the skip list. | Low. Consequence: if `circleContext` never succeeds, the legacy migration never runs. That is the safe direction. Do **not** "fix" this by preserving `CIRCLE_SHARED_KEY` across sign-out — the note at `AuthContext.tsx:1602-1610` documents a real cross-account bleed that clear prevents. |
| 4 ✅ | **Verify Clerk session lifetime (operator, no code)** | Clerk Dashboard → `next-osprey-15` → Sessions | Read Maximum lifetime / Inactivity timeout; check whether the affected users' sessions read as expired **server-side**. Record against `docs/specs/mobile_clerk_authentication_and_ota_feasibility_audit_v1.md:597`. | None technically; longer sessions on a shared family device is a real privacy tradeoff. This is the single observation that separates "detector misfired" from "sessions really died". |
| 5 ◐ | **Fix the banner's copy and add positive evidence before alarming** | `artifacts/mobile/app/(tabs)/index.tsx:1070`; `AuthContext.tsx:2115-2127` | Drop "usually happens after changing your password"; offer **Retry** alongside **Sign in**. Latch a ref the first time `clerkIsSignedIn === true` in a run and prefer arming on an observed true→false *transition*. **Do not convert this into an automatic sign-out.** | Copy change: none. The latch delays a genuine cold-start expiry banner, so pair it with #6 rather than shipping alone. |
| 6 | **Give Clerk a resource cache so a failed client fetch stops looking like a sign-out** | `artifacts/mobile/app/_layout.tsx:194-196` | Pass `__experimental_resourceCache`. Per `clerk-expo/dist/provider/ClerkProvider.js:73-74` this forces `rethrowOfflineNetworkErrors: true`, and `createClerkInstance.js:87-127` then wires the cached-resource fallback **and** the retry loop — the app self-heals instead of staying broken for the run. | **Moderate — the real one.** Experimental API (pin `@clerk/clerk-expo`, currently 2.19.31). It changes app-wide behaviour: every `_baseFetch` transport failure now *throws*, so audit sign-in/sign-up/`getToken`/`signOut` call sites for newly-thrown rejections. The backing store must be **expo-secure-store** — it persists the session JWT, and plaintext AsyncStorage would be a real regression on a PHI app. Needs a native build plus an airplane-mode cold-start test; sequence it as its own build. |
| 7 ✅ | **Make the boot session probe non-destructive** | `AuthContext.tsx:667-683`, `:1196` | Return tri-state `"alive" \| "gone" \| "unknown"`; only an explicit `null` answer may delete `SESSION_KEY`. Note the probe is `convex/auth.ts:49-56`, which takes a `userId` and performs **no** auth check — it can never detect a dead session, only a slow network. Consider dropping the 10s budget to ~3s once failure is non-destructive. | Low. Not a cause of any reported symptom (it produces "dumped at the sign-in screen", not a banner), but it is a silent permanent logout on a slow cold start. Do **not** "improve" it by making it authenticated — that converts a harmless false negative into a guaranteed forced logout during a token hiccup. |
| 8 ✅ | **Stop destroying the access code on a permission-only change** | `AuthContext.tsx:913-916` | Restore the session and raise `setAccessLock({ reason: … })` (as `:1545-1548` already does) instead of `clearAndBounce()`. Keep the genuine-revocation wipe at `:909-912`. Make the same call at `:2727` so restore and login agree. | Low exposure risk — the server already returns `[]` for a `viewReadings:false` code (`convex/careCircle.ts:1194`). Needs a new lock reason or the UI renders an ambiguous empty state. |
| 9 | **Plan the pk_test → production Clerk migration deliberately** | `artifacts/mobile/.env:8`, `convex/auth.config.ts:19` | — | The cutover will invalidate **every** session simultaneously. Ship it with an in-app forced re-auth flow, not silently — otherwise you reproduce symptom 1 at full volume on a day of your choosing. |

---

## Shipped

Fixes 1–3 are live on the `production` branch (OTA, applies on a device's second launch). No Convex
deploy was required — all three are client-side; `convex/` is unchanged.

- **1** — `settingsFromStorage` ref in `GlucoseContext.tsx`. The backfill now refuses to publish
  anything unless the values came from this device's saved settings or a user edit, so the
  placeholder 15/120/50 can never reach the server.
- **2** — a dedicated profile→local seeding effect. Without it, fix 1 alone would leave an owner's
  calculator running on defaults after every sign-in, since `insulin.tsx` reads the GlucoseContext
  locals and never `profile`. Deliberately does *not* set `settingsFromStorage`: those values came
  from the server, so there is nothing to publish back.
- **3** — `circleRole: "owner" | "member" | null` on AuthContext, set from the server's own
  `circle.isOwner`, reset to `null` at all four identity boundaries. The backfill now requires
  `circleRole === "owner"`. This is stronger than the `circleResolved` flag originally proposed
  here: "we got an answer" still misreads a member whose owner has no profile row to share
  (`shared: null` → `circleShared: null` → `isCircleMember: false`), whereas a positive ownership
  check does not. If the role never resolves the migration never runs, which is the safe failure.

Verification: typecheck clean; suite at 532 passing with the 7 long-standing `convex/doctor.test.ts`
failures unchanged; `git status convex/` empty, confirming no backend or dose-math change.

### Fix 4 — resolved 2026-08-26 (read via Clerk CLI, not the dashboard)

`clerk config pull --app app_3CLzIMs1mti5CBQEM9y9Ha7WNKy --keys session_settings` on instance
`next-osprey-15`: **`maximum_lifetime` enabled at 604800s (7 days)**, `inactivity_timeout` disabled,
multi-session disabled. Sessions hard-expire exactly 7 days after sign-in, active or not — the single
mechanism behind every observed mid-run session death (dad's "no readings", Brett's "Dexcom reconnect
needed" loop, the co-guardian settings resets via the since-fixed placeholder backfill). Verified the
same day against prod `cgmSyncState`: all five accounts `ok`/0 failures/readings minutes old, so none
of these incidents were ever CGM-side. **Remedy APPLIED same day** (Brett's decision: "no expiry"): `clerk config patch` set
`maximum_lifetime` to 315360000s (10 years — Clerk's maximum; a true disable is rejected because at
least one lifetime mechanism must stay enabled). Verified by re-pull, config_version v1_d0045187.
Existing sessions keep the 7-day expiry stamped at creation, so every device hits ONE more weekly
logout and is then signed in until sign-out. The #9 production migration must set this deliberately
on the new instance — it will NOT carry over.

### Second batch — fixes 5 (partial), 7, 8

Shipped OTA together. `convex/` untouched again, so no deploy. Every row below was scoped larger than
the doc said; the corrections matter more than the fixes.

- **5 ◐ — copy only.** The banner no longer asserts a cause. It said "this usually happens after
  changing your password", which the component cannot know: `sessionExpired` only observes that Clerk
  reports signed-out while we believe otherwise, and a failed cold-start fetch is indistinguishable
  from a real expiry. Users who had not touched their password were told they had. Now "Sign in to
  keep syncing" / "This device lost its connection to your account". The doc cited one string; there
  were **four** (alert title + body, banner title + subtitle). **The Retry half is NOT shipped** — no
  entry point exists and the only route is an `@internal` Clerk API. Still open.
- **7 ✅ — tri-state boot probe.** `restoreConvexBackedSession` now returns `"alive" | "gone" |
  "unknown"`; only a RESOLVED null is `"gone"`. The doc's minimal change (skip the `SESSION_KEY`
  delete) would **not** have fixed the symptom — `setIsSignedIn(true)` sits in the other branch, so
  the user still gets bounced to `/auth`. `"unknown"` therefore restores optimistically, matching what
  the access-code path already does on a network failure. Real risk was **medium**, not low: three
  consumers the doc missed (`sessionExpired`, the `isLoggedIn` onboarding bounce, and
  `signedInRestored`, which gates caregiver-code restore).
- **8 ✅ — permission change no longer destroys the code.** Four sites, not the two the doc lists:
  the cold-start restore, the **offline** restore (restored from cached permissions and raised no
  lock — stale PHI on screen), the 45s watcher, and `enterCaregiverMode`. The watcher patch is
  **mandatory, not optional**: its `else setAccessLock(null)` re-fires on the restore's own state
  updates and would clear the lock immediately. New `readings_off` lock reason + copy, deliberately
  worded as recoverable so a caregiver does not request a replacement code. Genuine revocation
  (`resolved === null`) still wipes, unchanged.

Verification: typecheck clean; 532 passing, the same 7 `convex/doctor.test.ts` failures.


## 5. What could not be determined

* **Whether the affected sessions actually died server-side.** This is the decisive open question for symptom 1, and it is answerable only from the Clerk dashboard for `next-osprey-15`: Sessions → Maximum lifetime / Inactivity timeout, plus whether the reporting users' sessions show as expired/revoked or still alive. Client code cannot tell a revoked session from a failed client fetch — both produce `{isLoaded: true, isSignedIn: false}`.
* **Whether there was a Clerk FAPI/DNS incident in the window.** Needs Clerk status/logs. Without it, the §1 mechanism is proven-reachable but not proven-fired.
* **Which build/OTA the affected users are on.** This decides symptom 3 outright: the "Exit"-with-no-confirm footgun exists in every build **before** 2026-08-06 and is fixed in HEAD. It also bounds how long the symptom-2 corruption has been reachable in the field. I did not query EAS (out of scope per your standing rule on Vercel/EAS, and I ran no `eas` commands).
* **No production data was read.** `npx convex data … --prod` is blocked by the known Convex CLI login drift (`~/.convex/config.json`, and the same failure occurs without `--prod`, so the token reaches neither environment). I did not attempt to re-auth. Consequently I have **zero** rows of evidence from `patientProfiles`, `careLinks`, `careAccessCodes`, or `cgmSyncState`.
* **The blast radius of the carbRatio corruption is therefore unmeasured.** When CLI access is restored, the query that sizes it: count `patientProfiles` rows whose `carbRatio/targetGlucose/correctionFactor` are exactly `15/120/50` **and** whose `updatedAt` falls after 2026-07-22, cross-referenced against owners with active `careLinks`. Every such owner's per-meal `doseSettingsByTime` overrides are **gone**, not recoverable from the row, and every co-guardian and access code in their circle has already inherited the defaults. Those owners must re-enter their dose settings by hand.
* **Two deployments exist in the tree** (`artifacts/mobile/.env:5` → `polished-badger-189`; root `.env.local` → `dev:clean-ptarmigan-904`). I checked whether a deployment flip could explain the cluster and **refuted it**: both exported bundles (`artifacts/mobile/dist/_expo/static/js/{ios,android}/entry-*.hbc`) contain `polished-badger` and zero occurrences of `clean-ptarmigan`, the root `.env.local` vars carry no `EXPO_PUBLIC_` prefix and sit outside the Expo project root so Metro cannot inline them, and — decisively — re-signing-in and re-entering the code both *worked*, which is impossible against a deployment lacking the rows. Whoever re-runs any prod query must still confirm which deployment the CLI selected first.
* **I did not reproduce anything on a device.** Every finding above is static analysis of the checked-out source and the installed `@clerk/clerk-expo@2.19.31` / `@clerk/clerk-js@5.127.1` / `convex@1.35.1` packages. The cheapest repro for #1/#7 needs no outage: cold-start signed in with the device in airplane mode.

---

## 6. Dose settings made server-owned — 2026-09-20

Fixes 1–3 removed one trigger and the resets kept coming (Brittany's circle, 2026-09-19). The cause
was the design, not another stray trigger: the ratios had **two sources of truth** — the device's
saved copy and the server profile — reconciled by "the device always wins", and nothing ever made a
device adopt newer server values. Three mechanisms were live:

1. **Stale-device revert.** The launch-time backfill (`GlucoseContext`) pushed this device's saved
   values over the server's whenever they differed. A second device on the owner account, or any
   change made elsewhere (another device, an approved doctor order), was silently undone the next
   time the stale device opened. Fix 1 had narrowed it to devices with saved values — exactly the
   stale case.
2. **The server accepted it.** `patientProfile.replace` is a whole-document replace that carried
   forward thresholds, codes and the access log but not the four dose fields, so any profile save
   from any client (stale cache, old bundle, onboarding re-run after an empty profile read) decided
   the dose math.
3. **Member fallback.** A co-guardian only saw the owner's ratios while the circle overlay was
   loaded. After every sign-in until it loaded, or whenever it failed, the app ran on the member's
   OWN row — which the original bug had stamped 15/120/50 and nothing repaired. No write involved.

Production at the time of the report: the owner's row held real values (30/160/160), so the server
had NOT been overwritten; the co-guardian's own row held 15/120/50. What the family saw as "resets"
was the client showing placeholders / the wrong row.

**What changed**

- `convex/patientProfile.ts`: `setDoseSettings` is the ONLY writer (explicit, range-validated,
  owner-only). `replace` carries existing dose values forward; only a row with none takes them from
  the payload (onboarding's first write). `get` resolves a linked member's dose fields from the
  circle OWNER's row, so no client can be shown a member's stale row.
- `doseSettingsAudit` (new table) + an access-log entry: every change records actor, source, app
  version, before → after. A generic save that TRIED to change them is recorded as `ignored` — that
  is how a still-stale device shows up.
- Mobile: the backfill is deleted. One adoption effect makes the device take the server's values
  whenever they are known (owner, member, or viewed patient) and cache them; the sign-in loader can
  no longer leave placeholders in place. `updateProfile` sends dose edits through `setDoseSettings`
  first; on failure the local profile keeps the previous dose values and the math re-adopts them.

**Known trade-off:** a device still on an old bundle can no longer change ratios (its generic save
is ignored, and logged). It gets the update prompt; the `ignored` audit rows show any edit lost in
the rollout window so it can be re-applied deliberately.

Deploy order: Convex first (backward compatible), then the OTA.
