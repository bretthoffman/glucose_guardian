# PREBUILD_AUDIT_01 — iPad, Alerts, Clerk/Google sign-in, Forgot password

Audit only — no code changed. Scope: the four items that require a new native build, audited against the
current code so we can land them together in one build.

Current baseline: Expo SDK **54**, RN **0.81.5**, new architecture **on**, `runtimeVersion.policy = appVersion`
(so a native change ⇒ new build ⇒ bump `version`; OTA cannot carry any of this).

---

## 1. iPad support

### Current state
`artifacts/mobile/app.json`:
- `ios.supportsTablet: **false**` — this is the only thing actually blocking iPad.
- `orientation: "portrait"` (app-wide lock).
- No `ios.requireFullScreen`.

### What has to happen
1. `ios.supportsTablet: true`.
2. **Decide multitasking vs full screen.** This is the real decision, not a toggle:
   - `ios.requireFullScreen: true` → app always owns the whole screen; Split View/Slide Over disabled; the
     `portrait` orientation lock is **honored**. Simplest, matches "works full screen with iPads."
   - `requireFullScreen: false` (Apple's default) → iPadOS **ignores the orientation lock** and the app must
     render correctly in landscape and in arbitrary Split View widths. Much more layout work.
   - **Recommendation: `requireFullScreen: true` for this build.** It's the low-risk path and can be relaxed later.
3. **Layout sweep.** The app is mostly flex-based and should scale, but these need eyes on a 12.9" canvas:
   - `components/GlucoseGauge.tsx` is rendered at a fixed `size={172}` — fine, but it will look lost centered in
     a 1024pt-wide card. Consider a max-width content container (~700pt) so pages don't stretch edge-to-edge.
   - `components/FloatingTabBar` (in `app/(tabs)/_layout.tsx`) is `width: "100%"` — on iPad it becomes a very
     wide pill with 5 tiny icons. Worth a max-width.
   - Charts (`CGMChart`, `TrendChart`) and `DashboardSectionModal` already use `useWindowDimensions` → should adapt.
   - Modals use `presentationStyle="pageSheet"` — renders as a centered sheet on iPad; already correct.
4. **Submission side (Brett):** once `supportsTablet: true`, App Store Connect **requires iPad screenshots**
   (12.9" / 13"). A build declaring iPad support cannot be submitted without them. Budget time for this.

### Verdict
Low technical risk, but it's not a one-line change — it's one line plus a layout pass plus iPad screenshots.

---

## 2. Alerts / notifications

### Current state (important nuance)
`expo-notifications@~0.32.16` **is installed** and `services/notifications.ts` is fully built: notification
categories with a Reply text-input action, permission helpers, and three schedulers
(`scheduleGlucoseAlert`, `scheduleDoctorMessageNotification`, `scheduleTreatmentProposalNotification`).
`app/_layout.tsx` registers categories + response listeners (incl. cold-start taps).

**Every notification is LOCAL** — all use `trigger: null`, scheduled by the app itself. There are no push
tokens, no server-sent notifications, and no background tasks anywhere in the app.

Three concrete gaps:

**(a) `expo-notifications` is NOT in `app.json` → `plugins`.** It's a dependency but not a config plugin entry.
Add `"expo-notifications"` (with Android icon/color/sounds config if wanted). Required for correct native setup.

**(b) Alerts only fire while the app is running.** `scheduleGlucoseAlert` is called from a reading-update effect
in `app/(tabs)/index.tsx:414`. If the app is swiped away/killed, **no glucose alert will ever fire** — even
though the Convex CGM cron keeps ingesting readings server-side. For a diabetes app this is the single most
important limitation to be explicit about. Two options:
   - **Ship as-is** (foreground/backgrounded alerts only) — honest, and no new infrastructure.
   - **Real push** (a follow-on project, not a config toggle): store an Expo push token per device, have the
     Convex cron detect threshold crossings server-side and call the Expo Push API. This is what makes alerts
     work with the app closed. Requires an **APNs key** in EAS credentials + `UIBackgroundModes: ["remote-notification"]`.
     *This* is almost certainly the "extra step during build submission" Brett remembers — it is **not** needed
     for the current local-only alerts.

**(c) Critical Alerts entitlement is requested but not held.** `requestNotificationPermissions()` passes
`allowCriticalAlerts: true`, and `dashboard.tsx` shows "Critical alerts available in standalone build". Without
Apple's entitlement iOS silently refuses that option, so the promise in the UI can't be kept. To actually get it:
   1. Apply: <https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/> —
      **continuous glucose monitoring is an explicitly approved use case**, so odds are good, but Apple reviews
      each request by hand and it takes time. **Apply now, before the build.**
   2. On approval: add `com.apple.developer.usernotifications.critical-alerts` to `ios.entitlements` in
      `app.json` and regenerate the provisioning profile.
   - If not approved in time: ship without it and soften the dashboard copy (otherwise the UI advertises a
     feature the build can't deliver).

### Verdict
Alerts largely already work; the build mainly needs the **plugin entry**. The two judgment calls are the
**critical-alerts entitlement** (apply immediately — long lead time) and whether "alerts when the app is closed"
is in scope (it's a separate push project).

---

## 3. Google sign-in via Clerk — the big one

### Current state
- **No Clerk packages installed.** Also missing `expo-secure-store` (Clerk's token cache needs it).
- **Convex has no auth integration at all**: no `convex/auth.config.ts`, and **zero** uses of
  `ctx.auth.getUserIdentity()`.
- Authorization today is a **bearer credential passed as a function argument**: every call takes
  `{ userId, passwordHash }` and compares the stored hash. That's **69 function signatures across 18 files**
  (`careLogs`, `careCircle`, `careMessages`, `predictionReferences`, `patientProfile`, `caregiverAccounts`, …).

### Two blocking problems
1. **Google users have no password.** There is no `passwordHash` to send, so *every* authenticated call in the
   app fails for them unless the model changes. Google sign-in cannot be bolted on next to the current model.
2. **SECURITY — `hashPassword` is not a hash.** `context/AuthContext.tsx:452` builds
   `gg::<password>::glucose_guardian_2025` and hex-encodes it. That is **trivially reversible** — anyone with
   the database, a captured request, or the device's AsyncStorage can recover every user's plaintext password.
   It is also sent on every single request. This should be treated as a real vulnerability, and it independently
   justifies moving auth to a real provider rather than extending the current scheme.

### The recommended path: Clerk owns BOTH methods
Make Clerk the identity provider for **Google *and* email/password**. Convex then trusts Clerk-issued JWTs.

**Backend**
- `convex/auth.config.ts`:
  ```ts
  export default { providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] };
  ```
- Set `CLERK_JWT_ISSUER_DOMAIN` in the Convex dashboard (dev **and** prod) = Clerk Frontend API URL. Create the
  `convex` JWT template in Clerk.
- Schema: add `users.clerkId` (optional) + a `by_clerkId` index. Keep `email`.
- Functions: authorize from `ctx.auth.getUserIdentity()` → resolve `clerkId` → the `users` row, instead of
  `{userId, passwordHash}`.

**Client**
- Add `@clerk/clerk-expo` + `expo-secure-store`; wrap the tree in `ClerkProvider` + `ConvexProviderWithClerk`.
  Note this pairs with `ConvexReactClient`; the app currently uses one-shot `ConvexHttpClient` everywhere
  (`utils/convex-auth-client.ts`) — that plumbing has to change, or tokens must be attached to the HTTP client manually.

**Migration of existing accounts** — link on first Clerk sign-in by email: if a `users` row with that email
exists, attach `clerkId` to it (preserving all their logs/circle/codes); else create one.

**Un-affected (good news):** the access-code paths (kid/caregiver codes, `resolveActiveAccessCode`) authenticate
by *code*, not by user — they need **no change**. Same for the doctor portal REST bridge (`accessCode` + server
secret). So the blast radius is guardian-account calls only.

**Phasing (strongly recommended):** make functions accept **either** a Clerk identity **or** the legacy
`{userId, passwordHash}` for one release. That lets us migrate file-by-file with the app working throughout,
instead of a big-bang rewrite where one missed signature logs everyone out.

### The faster alternative (and why I don't recommend it)
Keep the passwordHash model and, for Google users, mint a random server-side secret stored in `passwordHash`.
Ships sooner and touches few files — but it keeps the reversible-password scheme, and (see §4) it gives us
**no** forgot-password story for email users. It's a stopgap, not a foundation.

### Sign-in screen (`app/auth.tsx`, 575 lines)
Layout requested: **Google button above**, existing email/password below. The screen already has
Create/Sign-in tab state, plus separate access-code and doctor-code entry paths — those stay untouched.
Add: a "Continue with Google" button at top, a divider, then the existing form, and a **"Forgot your password?"**
link under the password field.

### Verdict
This is the largest item by far — a genuine auth migration, not a feature toggle. It should be planned as its
own phased project with its own doc, and it's the schedule driver for the build.

---

## 4. Forgot password

**Direct answer to Brett's question:** yes — Clerk can send the reset email for manually-typed email accounts,
**but only if those accounts actually live in Clerk.** Clerk can't reset a password it doesn't store, so this
only works if we move email/password auth to Clerk (i.e. the recommended path in §3). This is the strongest
argument for doing §3 properly rather than the stopgap.

**How it works** (`@clerk/clerk-expo`, custom flow — no hosted UI needed):
1. `signIn.create({ strategy: "reset_password_email_code", identifier: email })` → Clerk emails a code.
2. User enters code + new password.
3. `signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code, password })` → then `setActive()`.

Clerk owns the email delivery, templates, expiry, and rate-limiting — nothing for us to build or host.

**If we did NOT move to Clerk**, we'd have to build it ourselves: a reset-token table, an email provider
(e.g. Resend), token expiry/single-use, plus a deep link back into the app — meaningful work, and it would still
sit on top of the reversible "hash". Not recommended.

---

## Sequencing + who does what

**Do first (long lead time, blocking):**
- **Brett:** apply for the Critical Alerts entitlement now (§2c) — Apple's review is the long pole.
- **Brett:** create the Clerk application; enable Google OAuth + Email/Password; create the `convex` JWT template;
  supply the publishable key. (Google OAuth also needs a Google Cloud OAuth client + the iOS bundle ID
  `com.bretthoffman.glucoseguardian`.)

**Then, in code (roughly in this order):**
1. iPad: `supportsTablet` + `requireFullScreen` + layout sweep. *(smallest, independent)*
2. Notifications: add the `expo-notifications` plugin; decide on the closed-app push question; add the
   entitlement if/when approved.
3. Clerk migration, phased: `auth.config.ts` + schema `clerkId` → dual-auth acceptance → client providers →
   migrate the 18 files → Google button + forgot-password UI → drop legacy passwordHash.

**At build/submit time (Brett):**
- Bump `version` (native change ⇒ new runtimeVersion ⇒ OTA won't cover it).
- Add `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to EAS env; set `CLERK_JWT_ISSUER_DOMAIN` in Convex (dev + prod).
- `npx convex deploy` — this build's backend also carries the already-built-but-undeployed work
  (log edit/delete, careMessages, predictionReferences).
- Vercel redeploy for `/api/predict`.
- APNs key **only if** we implement real push; iPad screenshots in App Store Connect.

## Open questions for Brett
1. iPad: full-screen only (recommended), or full Split View multitasking support?
2. Alerts: is "alerts fire when the app is closed" in scope for this build (a push project), or ship
   foreground-only alerts now?
3. Clerk: phased dual-auth (recommended, safer) or a single big-bang cutover?
4. Existing users: on first Clerk sign-in, auto-link by email (recommended) — confirm that's acceptable.
