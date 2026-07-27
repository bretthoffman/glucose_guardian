# PREBUILD_PLAN_01 — the next native build (iPad · Push alerts · Clerk auth)

Companion to `PREBUILD_AUDIT_01.md` (findings). This doc records the **decisions** and the **implementation
plan**. Nothing here is built yet — this is the pick-up point when iPad screenshots are ready.

Baseline: Expo SDK 54, RN 0.81.5, new arch on, `runtimeVersion.policy = appVersion` → every item below is a
native change, so it needs a version bump and a real build (no OTA).

---

## Decisions (locked)

| # | Decision |
|---|---|
| 1 | **iPad:** `supportsTablet: true` + **`requireFullScreen: true`** (full screen only, no Split View; portrait lock honored). |
| 2 | **Alerts must work with the app closed** → real push notifications, not just local. Includes non-critical informational alerts (e.g. "your caregiver just logged an insulin dose"). Per-type user control, exposed both in-app **and** via the iOS Settings → Notifications → Glucose Guardian entry. |
| 3 | **Critical Alerts:** apply to Apple now (answer below: it's independent of App Review). |
| 4 | **Auth:** Clerk owns **both** Google and email/password. Convex trusts Clerk JWTs. |
| 5 | **Existing accounts:** fresh start is acceptable — no email-linking migration required. (Consequence noted below.) |
| 6 | **Clean cutover confirmed** (not dual-auth). Only ~4–5 users, all in close contact; access-code linking is **not in serious use yet** — they were waiting for this build's alerts before rolling it out. So orphaning old rows costs almost nothing. |
| 7 | **Convex client: migrate to `ConvexReactClient`** (not `ConvexHttpClient` + per-call `setAuth`). Approach: swap the client + add the providers first (existing imperative calls keep working), **then** convert the polling contexts to `useQuery` subscriptions. Rationale in §3.2, conversion list in §3.2a. |
| 9 | **Deployment split (IMPORTANT).** The installed app has `dev:clean-ptarmigan-904` **baked into the build** (`artifacts/mobile/.env`), so that dev deployment *is* production for existing users. It is now **FROZEN** on the current code. All new backend work targets the project's **production** deployment, and the new build's `EXPO_PUBLIC_CONVEX_URL` points there. Fresh deployment + clean cutover = no data migration at all. |
| 10 | **iPad screenshots:** captured on real hardware (not simulator), in a few days. |
| 8 | **Convex plan upgraded to Starter** (pay-as-you-go). Resource limits are **no longer a concern** — overages just bill (Database I/O ≈ $0.22/GB over 1 GB). This *removes cost* as a driver for the subscription work; it's now purely about responsiveness and correctness. |

### Consequence of #5 — read before building
Each `users` row owns that account's profile, logs, care-circle links, access codes, doctor code, and CGM
credentials. If everyone re-registers, **all of that is orphaned**: guardians re-enter Dexcom credentials,
re-create kid/caregiver access codes, and re-link co-guardians; old logs won't appear.
This is fine for a small tester group, and it's what makes the clean cutover in §3 possible.
*If that ever becomes unacceptable, email-linking on first Clerk sign-in is a small addition (~one function)
— it attaches `clerkId` to the existing row by matching email and preserves everything.*

---

## Native build validation (no local Xcode)

This Mac has **Command Line Tools only** — no Xcode, no CocoaPods — so the Swift in
`modules/notification-settings/` **cannot be compiled locally**. EAS Build compiles it in the cloud, so
no local Xcode is needed to ship; but the first EAS build is the first compile that Swift ever gets.

**Validate cheaply first:** `eas build --platform ios --profile preview` compiles the identical native
code without committing to a submission. Only run the production build once that passes.

**Escape hatch** if it fails and you need to ship immediately:
```
rm -rf artifacts/mobile/modules/notification-settings
```
Autolinking stops finding it and the JS uses `requireOptionalNativeModule` + a null guard, so nothing
else breaks — you lose only the deep-link routing (the iOS "Notification Settings" row still appears
and still opens the app). If it fails, suspect `import EXNotifications` or the podspec's
`s.dependency 'EXNotifications'`.

**Never commit an `ios/` directory.** There isn't one today, which is what makes `app.json` the source
of truth for `supportsTablet` / `requireFullScreen` / entitlements. If you ever run
`npx expo prebuild` locally, delete the generated `ios/` afterwards — a committed one would silently
override `app.json` from then on.

## ✅ CUTOVER EXECUTED (2026-07-23)

Brett cleared it with the existing users (breakage + new accounts accepted) and ordered the switch.
State now:

- **Prod `polished-badger-189` is the main deployment.** Full repo deployed: 147 functions / 22
  modules verified via `function-spec`, new schema live (pushTokens, pushAlertState, users.by_clerkId).
  All 4 env vars present (3 secrets + `CLERK_JWT_ISSUER_DOMAIN`). Live-tested over the public API:
  queries execute; a migrated function with no identity cleanly returns null.
- **`artifacts/mobile/.env` now points at prod.** Clerk is the auth system.
- **The dev freeze is LIFTED.** `dev:clean-ptarmigan-904` is a true dev environment again —
  `npx convex dev` / `codegen` may push there freely; only deprecated legacy installs still read it.
- **Remaining to finish the cutover (Brett):**
  1. Vercel: set `CONVEX_URL=https://polished-badger-189.convex.cloud` + redeploy the api-server
     (this same redeploy ships `/api/predict`, turning on real AI predictions).
  2. Smoke test on device: `pnpm dev` in `artifacts/mobile` + Expo Go → create account, Google
     sign-in, onboarding, dashboard. (Push tokens don't register in Expo Go — that part needs the
     EAS preview build.)

## Deployment targets (confirmed 2026-07-23)

| Role | Deployment | URL | State |
|---|---|---|---|
| **Frozen — existing users** | `dev:clean-ptarmigan-904` | `https://clean-ptarmigan-904.convex.cloud` | current code; **do not push** |
| **New build target** | **prod** `polished-badger-189` | `https://polished-badger-189.convex.cloud` | confirmed via `convex deploy --dry-run` |

`artifacts/mobile/.env` still points at **dev** — correct for now. Switch `EXPO_PUBLIC_CONVEX_URL` to the prod
URL when we start backend work that must run for real (Clerk/push), since that's the point local dev needs the
new backend. Vercel's `CONVEX_URL` flips to prod at ship time, not before (§ api-server note).

## 🛑 Operational hazard while dev is frozen

`npx convex dev` and **`npx convex codegen` PUSH FUNCTIONS to `dev:clean-ptarmigan-904`** — the deployment the
installed app uses. Running either against it now would ship half-finished backend code straight to live users.

**Rules until the new build ships:**
- Do **not** run `convex dev` / `convex codegen` while `CONVEX_DEPLOYMENT=dev:clean-ptarmigan-904`.
- Backend work is verified **locally** with `convex-test` (`npx vitest run`) + `tsc` — no deployment needed.
- When generated types are required for a new module, either point `CONVEX_DEPLOYMENT` at the new deployment
  first, or hand-add the entry to `convex/_generated/api.d.ts` (there's precedent for this in the repo).
- `npx convex deploy` targets **prod** and is safe — it never touches the dev deployment.

## Critical Alerts — APPLICATION SUBMITTED (2026-07-23)

Submitted via the Developer Relations form. What was declared to Apple — **the implementation must match this,
because App Review may verify it**:

- **App Type:** Healthcare · **Bundle ID:** `com.bretthoffman.glucoseguardian` · **Frequency:** Rarely
- **Critical Alerts are used ONLY for user-configured urgent glucose thresholds** (default ≤55 mg/dL urgent low,
  ≥250 mg/dL urgent high).
- **Everything else stays a STANDARD notification** — non-urgent high/low, care-log activity ("caregiver logged
  an insulin dose"), care-circle messages, doctor messages, treatment proposals.
- Alerts are **rate-limited** so a sustained out-of-range reading doesn't repeat excessively (→ the cooldown/
  dedupe state in §2.2 is now a commitment, not just a nicety).
- Users can disable Critical Alerts **in-app and in iOS Settings** (→ §2.2a server-side prefs + §2.4).

**Next:** watch email for Apple's reply. A follow-up asking for stronger justification is routine, not a
rejection. On approval → enable the entitlement on the App ID → regenerate the provisioning profile
(`eas credentials`) → add `com.apple.developer.usernotifications.critical-alerts` to `ios.entitlements`.
If it's *not* approved by build time, ship without it and soften the dashboard copy that currently advertises
critical alerts.

## Reference: why the application is independent of the build

**The entitlement request is completely separate from App Review.** It goes to Apple Developer Relations
through the request form, is evaluated by hand, and is granted against your **Team + App ID**
(`com.bretthoffman.glucoseguardian`) — not against a binary.

- **Apply now.** You do not need a submitted build, and waiting gains you nothing. Apple's review is the long pole.
- **Approval does not expire because you haven't shipped.** There is no "void it if you don't build in N days"
  mechanic. Approval grants the *capability* on the App ID; you then include the entitlement in a provisioning
  profile whenever you're ready.
- **After approval:** enable the entitlement on the App ID, regenerate the provisioning profile
  (`eas credentials` can do this), and add the entitlement key to `app.json` (§2).
- **App Review is a later, separate gate.** Reviewers may check the critical-alert usage is genuine — a CGM
  low-glucose alarm is exactly the approved use case, so keep the justification consistent between the
  entitlement request and the app's behavior.
- Apply with the **exact bundle ID you'll ship**, and describe the life-safety case: overnight severe
  hypoglycemia must sound through silent mode / Focus.

---

## 1. iPad

**`app.json` → `ios`:** `supportsTablet: true`, `requireFullScreen: true`.

**Layout sweep** (large-canvas issues, none structural):
- Add a shared max-width content container (~700pt) so pages don't stretch edge-to-edge on a 13" canvas.
- `FloatingTabBar` (`app/(tabs)/_layout.tsx`) is `width: "100%"` → cap it, otherwise 5 tiny icons in a huge pill.
- `GlucoseGauge` renders at fixed `size={172}` — fine, but re-center within the capped container.
- Charts (`CGMChart`, `TrendChart`) and `DashboardSectionModal` already use `useWindowDimensions` → should adapt.
- Modals already use `presentationStyle="pageSheet"` → correct on iPad.

**Blocking on Brett:** iPad screenshots (12.9"/13") for App Store Connect — required once `supportsTablet: true`.

---

## 2. Alerts — push architecture (the big functional add)

Goal: alerts arrive **with the app closed**, for both urgent glucose events and informational care events.
Everything today is *local* (`trigger: null`, scheduled from the running app), so this is new infrastructure.

### 2.1 What must be correct **in the build** (everything else is OTA-able afterwards)
This is the key sequencing point Brett raised — get these right once, then tune freely without rebuilding:
1. `"expo-notifications"` added to `app.json` → `plugins`.
2. **APNs key** configured in EAS credentials (`eas credentials`) so the Expo push service can deliver to iOS.
3. The permission request asks for the **full option set** up front:
   `allowAlert`, `allowSound`, `allowBadge`, **`provideAppNotificationSettings: true`**, and
   `allowCriticalAlerts` (only meaningful once the entitlement lands).
   > Verified present in the installed `expo-notifications@0.32.16`:
   > `provideAppNotificationSettings` (request) and `providesAppNotificationSettings` (status).
4. **Critical Alerts entitlement** in `ios.entitlements` — *if* approved before submission; otherwise ship
   without it and soften the dashboard copy that currently advertises it.
5. Notification **categories** registered (the category *set* is native-ish; the copy/actions are JS).
6. Bundle ID unchanged.

Visible alert pushes do **not** need `UIBackgroundModes`. That's only for silent/`content-available` pushes —
out of scope unless we later want background data refresh.

**After the build, these stay OTA-updatable:** new alert types, wording, thresholds, which events fire,
the in-app preferences UI, and the per-type toggles.

### 2.2 Backend (Convex)
- **New table `pushTokens`** — must cover *both* identity kinds, since caregiver/kid devices sign in by code:
  `{ userId?, code?, expoPushToken, platform, deviceId, prefs, updatedAt, disabledAt? }`, indexed by user, by
  code, and by token (dedupe). One row per device.
- **Registration:** on launch (permission granted), fetch the Expo push token and upsert it against the current
  identity (guardian `userId`, or the access `code` for kid/caregiver sessions). Re-upsert on identity change
  and on token rotation; clear on sign-out.
- **Sending:** a Convex **action** POSTs to the Expo Push API (`https://exp.host/--/api/v2/push/send`), batched.
  Mutations enqueue it with `ctx.scheduler.runAfter(0, ...)` so writes stay fast and the send is retryable.
- **Triggers** (each resolves recipients from the circle, always excluding the actor):
  - `careLogs.add*` → "‹Author› logged 2u for ‹Child›" to the other guardians + relevant code holders.
  - `careMessages.sendMessage` → to the other endpoint of the thread.
  - `cgmIngest` cron → **server-side threshold crossing detection** → glucose alerts to guardians.
    *This is the piece that makes glucose alarms work when the app is closed*, and it replaces relying on
    `app/(tabs)/index.tsx:414` (which only runs in the foreground). Needs its own cooldown/dedupe state so a
    sustained low doesn't spam every 5 minutes — mirror the existing `ALERT_COOLDOWN_MS` idea, but persisted.
  - Doctor messages / treatment proposals → existing local paths get a push counterpart.
### ⚠️ 2.2a Per-type toggles MUST be stored server-side (not local)
This is a hard architectural requirement, not a preference. Once alerts originate from the **backend**, the
**server** is the thing deciding whether to send a push — so it must be able to read the user's per-type
preferences at send time. Toggles kept only in device state / AsyncStorage are invisible to the server, so a
"muted" category would still fire.

- Store prefs in Convex: either on the device row (`pushTokens.prefs`) or a per-user prefs row. Per-device is
  the better fit here, since one guardian may want glucose alarms on their phone but not their iPad.
- Every send path reads prefs **before** enqueuing, and skips muted categories.
- The in-app Alerts UI writes to that server record (and may keep a local mirror purely for instant UI feedback).
- Note the contrast with today's `alertPrefs.notificationsEnabled` / `emergencyAlertsEnabled`, which are
  deliberately **device-local** because everything is currently scheduled on-device. Those semantics change:
  anything that gates a *push* has to move server-side. (The four numeric glucose thresholds are already synced
  to `patientProfiles.alertPreferences`, so the server can read those today.)

### 2.3 Alert categories (initial set)
`glucose_urgent` (critical-alert eligible) · `glucose_high_low` · `care_log` (someone logged food/insulin) ·
`messages` · `doctor`. Each is independently toggleable.

### 2.4 User control — two surfaces
- **In-app:** expand the dashboard Alerts window into a proper preferences section with a row per category
  (writes to the server-side prefs above). Pure JS → OTA-updatable after the build.
- **iOS Settings:** because we request `provideAppNotificationSettings`, iOS Settings → Notifications →
  Glucose Guardian shows a link that opens **our** in-app alert settings screen.
  ⚠️ **Verify during implementation:** how `expo-notifications@0.32.16` surfaces the iOS
  `openSettingsFor:` callback (route/listener). If it isn't exposed, this may need a small native shim or
  config-plugin patch — worth confirming early since it's a build-time capability, not an OTA one.

### 2.5 Critical alerts via push — verify
Delivering a *critical* alert by push requires the APNs payload to carry the critical sound flag
(`sound: { critical: true, name: "default", volume: 1.0 }`). **Confirm the Expo push service passes this
through** before promising overnight alarm behavior; if it doesn't, the fallback is sending those pushes to
APNs directly from a Convex action rather than through Expo's relay.

---

## 3. Clerk auth (Google + email/password) — clean cutover

Because fresh accounts are acceptable (decision #5), we can skip the dual-auth bridge I originally recommended
and do a **clean cutover**, which is simpler and less total work. TypeScript makes this safe: `passwordHash` is
in the arg validators of ~69 functions, so removing it is compiler-enforced — every stale call site fails to
typecheck rather than failing at runtime.

### 3.1 Backend
- `convex/auth.config.ts`:
  ```ts
  export default { providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] };
  ```
- Convex env var `CLERK_JWT_ISSUER_DOMAIN` (Clerk Frontend API URL) — set in **dev and prod**.
- Schema `users`: add `clerkId` + `by_clerkId` index; **drop `passwordHash`** (and the fake `hashPassword`).
- Replace `assertPatientAuth(userId, passwordHash)` with a single helper:
  `requireUser(ctx)` → `ctx.auth.getUserIdentity()` → `by_clerkId` lookup → the `users` row (auto-provision on
  first call). Then delete `userId`/`passwordHash` from all guardian-facing validators.
- `convex/auth.ts` (`register`/`login`) is retired.

**Unaffected — no changes needed:** all access-code paths (`resolveActiveAccessCode`, kid/caregiver code
sessions) authenticate by *code*, and the doctor portal REST bridge authenticates by `accessCode` + server
secret. The blast radius is guardian-account calls only.

### 3.2 Client
- Add `@clerk/clerk-expo` + `expo-secure-store` (token cache).
- Wrap the tree in `ClerkProvider` + `ConvexProviderWithClerk`.

#### DECIDED: migrate to `ConvexReactClient` (decision #7)
The app currently builds a fresh one-shot `ConvexHttpClient` per call (`utils/convex-auth-client.ts`, used by
AuthContext / GlucoseContext / MessagesContext / predictionClient). `ConvexProviderWithClerk` targets
`ConvexReactClient`. **Migrate.** Reasons, in order of weight:

1. **Token refresh is handled for us.** Clerk's Convex-template JWTs are short-lived (about a minute by
   default). With the HTTP client we'd have to call `getToken({ template: "convex" })` and manage expiry
   *ourselves on every call* — cache it wrong and you get intermittent, hard-to-debug auth failures. This is
   the single biggest correctness risk of the HTTP route, and the provider removes it entirely.
2. **It is NOT a big-bang rewrite.** `ConvexReactClient` still exposes imperative `client.query()` /
   `client.mutation()` / `client.action()`. So existing imperative call sites — which is most of ours, since
   they live inside `useCallback`s, effects, and flows like `runPrediction` / `enterKidView` / `openThread`
   that can't become hooks — keep working with a client swap. We then convert poll-driven reads to `useQuery`
   **incrementally**, at our own pace.
3. **Responsiveness.** Today we re-read on fixed timers regardless of whether anything changed: messages 15s,
   open thread 8s, hydrate 60s, access lock 45s, plus glucose polls. Subscriptions push the instant data
   changes — messages and cross-guardian log sync stop feeling laggy, and we delete a pile of timer code.
   *(Note: this is no longer a cost argument. Convex is now on the Starter plan (decision #8), so Database I/O
   overage simply bills at ~$0.22/GB instead of threatening service interruption. Reduced reads are a welcome
   side effect, not the reason.)*
4. **Longevity:** it's the documented, supported Convex + Clerk integration. The HTTP route means owning the
   auth glue forever and never being able to adopt subscriptions.

**Migration shape (two stages, deliberately separated):**
- **Stage 1 — swap + providers.** Replace `ConvexHttpClient` with a single shared `ConvexReactClient`
  (`utils/convex-auth-client.ts` currently constructs a *new* client on every call — fix that too), wrap the
  tree in `ClerkProvider` + `ConvexProviderWithClerk`, and verify every existing **imperative** call still
  works unchanged. Nothing else moves. This is the stage that must land with the build.
- **Stage 2 — convert the polls.** Replace timer-driven reads with `useQuery` subscriptions and delete the
  timers. Can land incrementally, and is OTA-safe once the build ships.

### 3.2a Polling contexts to convert (Stage 2)
| Where | Current | Convert to |
|---|---|---|
| `context/MessagesContext.tsx` | `listThreads` every **15s** (`POLL_MS`) | `useQuery` subscription → live threads + unread badges |
| `components/CareThreadMessaging.tsx` | `listMessages` every **8s** while a thread is open | `useQuery` → instant message delivery |
| `context/AuthContext.tsx` hydrate loop | memberships / `circleContext` / `listLogs` every **60s** | `useQuery` → cross-guardian logs + shared settings land immediately |
| `context/AuthContext.tsx` access lock | `resolveAccessCode` every **45s** | `useQuery` → immediate lock/unlock on schedule or revoke |
| `context/GlucoseContext.tsx` | remote reading polls | `useQuery` on the readings query (CGM ingest cadence still governs *new data*) |

Watch-outs: (a) `useQuery` is a hook, so these must be read at component/provider top level — the contexts are
providers, which fits, but imperative one-shot calls inside callbacks should **stay** imperative;
(b) access-code sessions authenticate by *code*, not Clerk identity, so their subscriptions carry the code as
an argument and are unaffected by the auth cutover; (c) keep the existing optimistic-write merge logic
(`mergeCloudLogs`) — subscriptions change *when* data arrives, not the merge semantics.
- `AuthContext`: `signIn`/`createAccount`/`hashPassword` and the `passwordHash` plumbing come out;
  `messagingIdentity` and friends key off the Clerk-backed user id instead.

### 3.3 Sign-in screen (`app/auth.tsx`)
Order, per Brett: **"Continue with Google" on top**, divider, then the existing email/password form, with a
**"Forgot your password?"** link under the password field. The access-code and doctor-code entry paths are
untouched.

### 3.4 Forgot password (Clerk-owned, works for typed emails)
Custom flow, no hosted UI:
1. `signIn.create({ strategy: "reset_password_email_code", identifier: email })` → Clerk emails a code.
2. User enters code + new password.
3. `signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code, password })` → `setActive()`.

Clerk owns delivery, templates, expiry, and rate-limiting. **This only works because email/password accounts
now live in Clerk** — which is exactly why decision #4 was the right call.

### 3.5 Security note (resolved by this work)
Today's `hashPassword` (`AuthContext.tsx:452`) hex-encodes `gg::<password>::glucose_guardian_2025` — reversible,
stored on-device, and sent on every request. The cutover removes it entirely; Clerk handles password storage.

---

## 4. Build & submit checklist (Brett)

**Start now (long lead):**
- [x] ~~Apply for the Critical Alerts entitlement~~ — **submitted 2026-07-23**; awaiting Apple's reply.
- [ ] Create the Clerk app: enable **Google OAuth** + **Email/Password**, create the **`convex` JWT template**,
      copy the publishable key + Frontend API URL.
- [ ] Google Cloud OAuth client for bundle ID `com.bretthoffman.glucoseguardian`.
- [ ] iPad screenshots (12.9"/13").

**At build time:**
- [ ] Bump `version` in `app.json` (native change ⇒ new runtimeVersion).
- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in EAS env; `CLERK_JWT_ISSUER_DOMAIN` in Convex (dev + prod).
- [ ] APNs push key via `eas credentials`.
- [ ] Critical-alerts entitlement + regenerated provisioning profile (if approved).
- [ ] `npx convex deploy` — this also carries the already-built, still-undeployed work: log edit/delete,
      `careMessages`, `predictionReferences`.
- [ ] Vercel redeploy for `/api/predict` (AI prediction graph).

## Open items to resolve during implementation
1. ~~Reactive vs HTTP client~~ — **decided: migrate to `ConvexReactClient`** (§3.2).
2. How expo-notifications surfaces the iOS "app notification settings" callback (§2.4).
3. Whether Expo's push relay passes through the APNs critical-alert sound flag (§2.5).
4. Server-side alert cooldown/dedupe policy for sustained out-of-range glucose (§2.2).
5. Prefs granularity: per-device (recommended) vs per-user for the server-side toggles (§2.2a).
