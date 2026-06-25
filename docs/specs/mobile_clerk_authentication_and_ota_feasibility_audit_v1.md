# Mobile Clerk Authentication and OTA Feasibility Audit (v1)

**Date:** 2026-06-25  
**Repository:** [glucose_guardian](https://github.com/bretthoffman/glucose_guardian)  
**Branch audited:** `master`  
**Audit mode:** Read-only except this Markdown file  
**Scope:** Authentication, account-linking, Clerk integration feasibility, and EAS Update (OTA) determination for the Glucose Guardian mobile app. **No implementation was performed.**

---

## Executive conclusion

The Glucose Guardian mobile app (`artifacts/mobile/`) today uses a **custom client-computed password digest** and **device-local AsyncStorage session flags**. Convex stores patient identity in the `users` table (`Id<"users">`) and authorizes nearly all patient mutations/queries by accepting **`userId` + `passwordHash`** from the client over an **unauthenticated** `ConvexHttpClient`. There is **no Clerk**, **no Google OAuth**, **no forgot-password flow**, and **no Convex JWT / `auth.config.ts`** in this monorepo.

Product direction calls for sharing the **existing Clerk application** (`next-osprey-15`) with the doctor portal. That integration **does not exist in this repository today** — the extracted doctor portal and in-monorepo doctor API use **separate custom email/password + bearer-token auth** (`doctorAccounts` / `doctorSessions`), not Clerk.

**OTA verdict: New build required** before shipping a production-grade Clerk integration (browser Google OAuth, durable Clerk sessions, and recommended `@clerk/expo` setup). The current TestFlight-compatible binary configuration (from `app.json` + `package.json`) already includes `expo-web-browser`, `expo-linking`, and URL scheme `mobile`, but is **missing** `expo-secure-store`, `expo-auth-session`, `@clerk/expo`, and the `@clerk/expo` config plugin. Adding these requires native code in a new EAS build. After that one build, subsequent auth UI and Convex identity-bridge logic can ship via EAS Update on the `production` channel.

**Password-hash import into Clerk is not feasible** for existing users: the legacy digest is a **non-standard hex encoding of a salted string**, not a supported `password_hasher` algorithm. Existing email/password users need a **staged claim / one-time reset** flow after Clerk user creation, not bulk hash import.

**Safest identity model:** Clerk `userId` (JWT `sub`) proves authentication; Convex maintains a **nullable `clerkUserId` (or mapping table)** on the existing `users` row; all medical data remains keyed by **`users._id`** unchanged.

---

## Known Clerk application endpoints (non-secret architecture references)

| Item | Value |
|------|--------|
| Clerk Frontend API URL | `https://next-osprey-15.clerk.accounts.dev` |
| Clerk Backend API URL | `https://api.clerk.com` |
| Clerk JWKS URL | `https://next-osprey-15.clerk.accounts.dev/.well-known/jwks.json` |
| Expected mobile public env | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| Expected server secret env | `CLERK_SECRET_KEY` (never in mobile bundle) |
| Doctor portal (external) env name | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (do not reuse on mobile) |

---

## Repository inspection record

| Check | Result |
|-------|--------|
| `pwd` | `/Users/bretthoffman/Documents/Gluco-Guardian` |
| Branch | `master` |
| Working tree before audit | **Not clean** — pre-existing modified/untracked files (CGM diagnostics, mobile index, Convex schema, etc.) unrelated to this audit |
| Recent commits | `176cd4a1 update`, `cd1c98b9 updates`, `1bbd0ea3 updates`, … |
| Monorepo layout | `artifacts/mobile/` (patient app), `artifacts/api-server/`, `convex/`, `lib/*` |
| Doctor portal in monorepo | **Removed** (see `DOCTOR_PORTAL_EXTRACTION_AUDIT_01.md`) |

---

## Part 1 — Mobile native and Expo identifiers

### Project location and tooling

| Field | Value | Source |
|-------|--------|--------|
| Expo project root | `artifacts/mobile/` | directory layout |
| Package name | `@workspace/mobile` | `artifacts/mobile/package.json` |
| Package manager | **pnpm** (workspace) | root `package.json`, `pnpm-workspace.yaml` |
| Main entry | `expo-router/entry` | `artifacts/mobile/package.json` |
| Workflow | **Managed** (no `ios/` or `android/` checked in) | glob search |
| Prebuild / bare | Neither checked in; EAS Build generates native projects | `app.json`, `eas.json` |

### Versions (from `artifacts/mobile/package.json`)

| Field | Version |
|-------|---------|
| Expo SDK | `~54.0.27` (lock resolves `54.0.33`) |
| React Native | `0.81.5` |
| Expo Router | `~6.0.17` |
| React | `19.1.0` (catalog) |
| `expo-updates` | `~29.0.17` |

### App identity (`artifacts/mobile/app.json`)

| Field | Value |
|-------|--------|
| App name | `Glucose Guardian` |
| Expo slug | `mobile` |
| App version | `1.0.0` |
| iOS bundle identifier | `com.bretthoffman.glucoseguardian` |
| Android package name | **Not explicitly set** (`"android": {}`) |
| Expo owner / account | **Not set in repo** (confirm in Expo dashboard) |
| EAS project ID | `febbed6c-81e8-475e-aa62-93bc0128fef3` |
| iOS build number | **Not in repo** (`eas.json` → `appVersionSource: "remote"`, `autoIncrement: true`) |
| Android version code | **Not in repo** (same EAS remote versioning) |
| Runtime version | `{ "policy": "appVersion" }` → **`1.0.0`** |
| URL scheme | **`mobile`** |
| Additional URL schemes | None configured |
| `newArchEnabled` | `true` |
| `userInterfaceStyle` | `automatic` |

### EAS configuration (`artifacts/mobile/eas.json`)

| Profile | Channel | Notes |
|---------|---------|-------|
| `development` | (default) | `developmentClient: true`, internal distribution |
| `preview` | `preview` | internal distribution |
| `production` | **`production`** | `environment: "production"`, `autoIncrement: true` |

**Production OTA channel:** `production`  
**Updates URL:** `https://u.expo.dev/febbed6c-81e8-475e-aa62-93bc0128fef3`

### Deep linking and universal links

| Item | Status |
|------|--------|
| Custom scheme | `mobile://` (from `"scheme": "mobile"`) |
| `expo-linking` | Installed `~8.0.10` |
| Associated domains (iOS) | **None** |
| Universal links | **None** |
| Android intent filters | **None custom** (Expo prebuild defaults only) |
| `Linking.createURL` / auth redirect helpers | **Not used** today |
| Deprecated `auth.expo.io` proxy | **Must not be used** (CVE-2023-28131) |

### Expo plugins (`app.json`)

```json
"plugins": ["expo-router", "expo-font", "expo-web-browser"]
```

No `@clerk/expo`, no `expo-secure-store`.

### Expo Go compatibility

The app is built and distributed via **EAS / TestFlight**, not Expo Go. Comments in `SettingsModal.tsx` note Expo Go compatibility for `<Modal>`, but **Clerk browser OAuth and durable sessions are not compatible with Expo Go** (custom scheme + native modules). Treat **development builds / TestFlight** as the target.

### TestFlight / runtime assumptions

- Runtime version policy `appVersion` ties OTA updates to **`1.0.0`** until app version changes in a new native build.
- `BUILD_NOTES.md` documents `eas build --platform ios --profile production` and `eas update --channel production --environment production`.
- Reviewer test credentials are documented in `BUILD_NOTES.md` (email/password); **no Google sign-in exists today**.

---

## Part 2 — Native dependency inventory (Clerk-relevant)

| Package | Installed | Version | Native code | In current binary config | New build if added | Expo Go | OTA JS alone |
|---------|-----------|---------|-------------|--------------------------|-------------------|---------|--------------|
| `@clerk/clerk-expo` | **Absent** | — | Yes (legacy package) | No | **Yes** | Partial / limited | **No** |
| `@clerk/expo` | **Absent** | — | Yes (Core 3; config plugin) | No | **Yes** | Hooks only w/o native features | **No** |
| `@clerk/clerk-react` | **Absent** | — | No (web) | No | No (web only) | N/A | N/A |
| `@clerk/shared` | **Absent** (transitive only in lock as optional peer of `convex`) | — | No | No | — | — | — |
| `expo-auth-session` | **Absent** | — | **Yes** | **No** | **Yes** | Limited | **No** |
| `expo-web-browser` | **Yes** | `~15.0.10` | **Yes** | **Yes** (plugin) | No | Yes | N/A (already native) |
| `expo-secure-store` | **Absent** | — | **Yes** | **No** | **Yes** | No | **No** |
| `expo-linking` | **Yes** | `~8.0.10` | **Yes** | **Yes** | No | Yes | N/A |
| `expo-crypto` | **Absent** | — | **Yes** | **No** | **Yes** (native Google only) | — | Not needed for **browser** OAuth |
| `react-native-url-polyfill` | **Absent** | — | No | No | No | — | Yes (JS) |
| `@react-native-async-storage/async-storage` | **Yes** (devDependencies) | `2.2.0` | **Yes** | **Yes** | No | Yes | N/A |
| Custom auth native packages | **None** | — | — | — | — | — | — |

**Notes:**

- `pnpm-lock.yaml` contains **no** entries for `expo-auth-session` or `expo-secure-store` — they are not transitive dependencies today.
- Clerk’s recommended Expo setup (`@clerk/expo`, `expo-secure-store`, `expo-auth-session`, `expo-web-browser`) requires **`@clerk/expo` config plugin** which embeds native Clerk SDKs at prebuild time.
- Installing Clerk packages via OTA **without** a matching binary would cause **runtime native module missing** crashes.

---

## Part 3 — Current mobile authentication architecture

### High-level model

```
┌─────────────────┐     hashPassword()      ┌──────────────────┐
│  auth.tsx UI    │ ───────────────────────►│  AuthContext     │
│  email/password │                         │  AsyncStorage    │
└─────────────────┘                         │  account+session │
                                            └────────┬─────────┘
                                                     │ userId + passwordHash
                                                     ▼
                                            ┌──────────────────┐
                                            │ ConvexHttpClient │
                                            │ (no JWT)         │
                                            └────────┬─────────┘
                                                     ▼
                                            ┌──────────────────┐
                                            │ convex/auth.ts   │
                                            │ patient* modules │
                                            └──────────────────┘
```

**Authentication authority today:** Custom client digest + Convex `users.passwordHash` equality check (not Clerk, not Convex Auth JWT).

### Key files

| Concern | File(s) |
|---------|---------|
| Sign-up / sign-in UI | `artifacts/mobile/app/auth.tsx` |
| Auth state | `artifacts/mobile/context/AuthContext.tsx` |
| Convex client | `artifacts/mobile/utils/convex-auth-client.ts` |
| Route guards | `artifacts/mobile/app/_layout.tsx` |
| Storage keys | `artifacts/mobile/constants/storage-keys.ts` |
| Backend register/login | `convex/auth.ts` |
| Patient authorization | `assertPatientAuth()` in `convex/patientProfile.ts`, `patientCgm.ts`, `patientGlucose.ts`, `patientGuardianPin*.ts`, `patientCgmSync.ts`, etc. |

### Sign-up (`createAccount`)

| Step | Behavior |
|------|----------|
| Screen | `auth.tsx` — "Create Account" tab |
| Fields | Email, password (min 6 chars), confirm password |
| Email normalization | `trim().toLowerCase()` (client) |
| Password validation | Min length 6; match confirm (client only) |
| Hashing | `hashPassword()` in `AuthContext.tsx` (client) |
| Backend | `api.auth.register` mutation |
| Duplicate email | Convex throws `"Email already registered"` |
| Profile provisioning | **None** at signup — `profile` cleared; user routed to onboarding when `isSignedIn && !isLoggedIn` |
| Session | `ACCOUNT_KEY` + `SESSION_KEY="true"` in AsyncStorage |

### Sign-in (`signIn`)

| Step | Behavior |
|------|----------|
| Screen | `auth.tsx` — "Sign In" tab |
| Verification | Client hashes password; `api.auth.login` query compares to `users.passwordHash` |
| Session persistence | `UserAccount` JSON: `{ email, passwordHash, convexUserId }` + `SESSION_KEY` |
| Token expiration | **None** — digest is static until password changes |
| Cold start | Reads AsyncStorage; if `convexUserId`, calls `api.auth.getUser` + hydrates profile/CGM |
| Failure | Alert "Incorrect email or password"; offline fallback for legacy local-only accounts without `convexUserId` |
| Rate limiting | **None** |
| Plaintext password storage | **Never** — only held in React state during submit |

### Sign-out vs logout

| Action | Function | Clears | Preserves |
|--------|----------|--------|-----------|
| **Sign out** (Dashboard) | `signOut()` | `SESSION_KEY`; resets caregiver/doctor session flags | `ACCOUNT_KEY`, profile, CGM local cache, theme |
| **Logout** | `logout()` | All auth/profile/CGM/glucose local keys | **Theme preference** (`THEME_PREFERENCE_STORAGE_KEY` — intentional) |
| Backend invalidation | **None** for patients | — | CGM credentials remain server-side in Convex secret tables |

### Session restoration

On launch, `AuthProvider` `load()`:

1. Reads profile, CGM, account, session from AsyncStorage.
2. If `SESSION_KEY === "true"` and account has `convexUserId`, validates user still exists via `api.auth.getUser` (10s timeout).
3. Hydrates profile/CGM from Convex using `passwordHash` as credential.

There is **no refresh token** and **no SecureStore**.

### Password hashing (structure only — no real values)

**Location:** Client (`AuthContext.hashPassword`) and Convex `users.passwordHash` column.

**Algorithm:**

1. Construct string: `gg::{plaintext}::glucose_guardian_2025`
2. For each character, append `charCodeAt(i).toString(16).padStart(2, "0")` (hex encoding of UTF-16 code units)
3. Store resulting hex string

**Properties:**

- Not salted per-user (fixed application salt string)
- Not a standard password hash (not bcrypt, scrypt, Argon2, PBKDF2)
- Deterministic given password
- Verified by string equality on client and server

**Clerk import feasibility:** **Not supported.** Clerk `password_digest` / `password_hasher` accepts standard algorithms (bcrypt, scrypt, Argon2, PBKDF2 variants, etc.), not this custom hex encoding. **Bulk import cannot preserve passwords.**

**Guardian PIN (separate):** Server-side scrypt in `convex/guardianPin/hashNode.ts` — unrelated to account password.

### Missing auth features today

| Feature | Status |
|---------|--------|
| Google OAuth | **Not implemented** |
| Forgot password | **Not implemented** |
| Email verification | **Not implemented** |
| Clerk | **Not referenced in mobile code** |
| JWT / bearer patient session | **Not implemented** |

---

## Part 4 — Convex user identity and data ownership

### Canonical patient identity

| Aspect | Value |
|--------|--------|
| Canonical table | `users` |
| ID type | Convex `Id<"users">` |
| Mobile reference | `account.convexUserId` (stringified `_id`) |
| Email | Stored normalized lowercase; indexed `by_email` |
| Clerk field | **Not present** (planned: optional `clerkUserId` per `CONVEX_V2_PATIENT_PLAN.md`) |

### Tables keyed by `users._id`

| Table | Index / key | Data |
|-------|-------------|------|
| `patientProfiles` | `by_userId` | Profile, caregiver/doctor codes, access log |
| `patientGuardianPins` | `by_userId` | Guardian PIN verifier |
| `patientCgmConnections` | `by_userId` | CGM metadata |
| `patientDexcomCredentials` | `by_userId` | Server-only Dexcom secrets |
| `patientLibreCredentials` | `by_userId` | Server-only Libre secrets |
| `patientGlucoseReadings` | `by_user_time` | Glucose history |
| `cgmSyncState` | `by_user_provider` | Ingestion health / queue |

### Doctor / caregiver access (separate from owner auth)

| Mode | Credential | Convex path |
|------|------------|-------------|
| Caregiver (standalone device) | 6-char `caregiverCode` | `patientProfile.getByCaregiverCode`, `patientGlucose.listRecentForCaregiver` |
| Doctor (in-app code mode) | 6-char `doctorCode` | Local profile only; sync via API `POST /api/doctor/sync` |
| Doctor portal (external) | Bearer token → `doctorAccounts` | **Separate** `doctorAccounts` table — not `users` |

### Target identity model (approved direction)

1. **Clerk** proves identity (`sub` / `userId` in JWT).
2. **Convex** resolves Clerk ID → exactly one `users._id` (via `clerkUserId` column or `identityLinks` table).
3. **No rewrite** of glucose, CGM, profile, or guardian data — all remain on `users._id`.
4. **Authorization** migrates from `passwordHash` args to `ctx.auth.getUserIdentity()` + internal lookup.
5. **Doctor permissions** must never be implied by patient Clerk auth.

---

## Part 5 — Existing-account transition analysis

“Migration” means **changing the authentication authority to Clerk** while preserving Convex data — not forcing users from password to Google.

### Existing email/password user

| Question | Answer |
|----------|--------|
| Keep password via Clerk hash import? | **No** — hash format unsupported |
| One-time reset required? | **Yes**, unless user sets a new password through Clerk forgot-password / claim flow |
| Attach first Clerk identity | After Clerk sign-in, Convex mutation (authenticated via Clerk JWT) looks up `users.by_email` where email matches **Clerk-verified** primary email |
| Prove ownership | Clerk JWT + `email_verified` (and/or completed password reset to known email) |
| Prevent duplicate Convex user | Server-side: if `clerkUserId` already linked to another row, reject; if email exists unlinked, **link** rather than `insert` |

**Recommended staged flow for legacy password users:**

1. User signs in with Clerk email/password (after operator creates Clerk user via reset, or user completes forgot-password).
2. Convex `identity.resolveOrLink` checks verified email against `users.by_email`.
3. If match: set `users.clerkUserId`, return existing `users._id`.
4. If no match: create new `users` row (true new user) + onboarding.
5. Retire client `passwordHash` transport only after cutover window.

### Existing user chooses Google (same verified email)

| Risk | Mitigation |
|------|------------|
| Unverified email | **Do not link** — require `email_verified` from Clerk JWT / User object |
| Case differences | Normalize to lowercase (already Convex convention) |
| Duplicate legacy emails | `by_email` index should be unique; if duplicates exist, **operator data cleanup** before migration |
| Guardian-managed accounts | Link only the **owner** `users` row; caregivers use codes, not Clerk |
| Google email mismatch | Use Clerk’s verified primary email, not client input |
| Account takeover | Never trust client-supplied email; link only inside Convex action with Clerk JWT validation |

**Clerk Dashboard:** Review **Account linking** settings (automatic linking of OAuth to existing accounts with same verified email). Prefer **verified-email-only** linking; disable unsafe automatic merges if they allow unverified matches.

### New Google user

1. Clerk creates identity on successful OAuth.
2. Mobile receives session via `setActive({ session })`.
3. Convex action: `getUserIdentity()` → if no `clerkUserId` mapping and no verified email match → `insert users` + empty profile path → onboarding.
4. **Idempotency:** repeat calls return same mapping for same Clerk `sub`.

### New email/password user

1. Clerk `signUp` + email verification (per Dashboard policy).
2. Convex provisioning same as Google after first authenticated request.
3. UI can remain current `auth.tsx` layout; handlers call Clerk SDK instead of `api.auth.register`.

### User with both Google and password

Same verified email → **one Clerk user** (Clerk multi-factor strategy) → **one Convex `users` row**. User may attach second sign-in method in Clerk account settings after verification.

---

## Part 6 — Forgot-password architecture

### Preferred mobile flow (design only)

1. User taps **Forgot password?** on sign-in.
2. Enter email → Clerk `signIn.create` with `strategy: "reset_password_email_code"` (or equivalent Expo SDK flow).
3. User enters email code in-app.
4. User sets new password + confirm.
5. Clerk activates session → `setActive`.
6. Convex links/resolves existing account by verified email + `clerkUserId`.

### Clerk Expo APIs (expected)

| Capability | Likely SDK surface |
|------------|-------------------|
| Start reset | `useSignIn()` → `signIn.create({ strategy: "reset_password_email_code", identifier: email })` |
| Verify code | `signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code })` |
| Set password | `signIn.resetPassword({ password })` |
| Session | `setActive({ session: signIn.createdSessionId })` |
| Resend | Clerk sign-in resend methods (rate-limited server-side) |
| Enumeration-safe UX | Always show generic copy: "If an account exists, we sent a code" |

**Support with installed versions:** **N/A today** — Clerk not installed. With `@clerk/expo` + new native build, **email code reset is supported** via JavaScript hooks (no native Google module required).

### Legacy custom accounts

Clerk cannot reset a password that exists only as the legacy hex digest in Convex. Options:

| Option | Recommendation |
|--------|----------------|
| Hash import | **Not feasible** |
| Forced one-time reset | **Primary path** for existing email users |
| Authenticated in-app claim | For already-signed-in legacy users during transition window |
| Email verification claim | Same as reset flow — proves mailbox control |

During transition, **dual auth**: legacy `passwordHash` path remains until `clerkUserId` is set, then legacy path disabled for that user.

### Google-only users (no password)

- Forgot-password screen should **not promise** password reset for every email.
- Generic messaging: "Try continuing with Google" or "Sign in with Google".
- Optional: authenticated users add password later via Clerk account/security settings.
- **Do not** expose whether email exists (enumeration-safe copy only).

---

## Part 7 — Browser-based Google OAuth architecture

### Approved approach

**Browser-based Clerk OAuth** using:

- `@clerk/expo` `useSSO()` or `useOAuth({ strategy: "oauth_google" })`
- `expo-web-browser` (`openAuthSessionAsync`)
- `expo-auth-session` `AuthSession.makeRedirectUri()`
- `expo-linking` (scheme resolution)
- `tokenCache` from `@clerk/expo/token-cache` (requires `expo-secure-store`)

**Not in scope:** Native `@react-native-google-signin` / `useSignInWithGoogle()` (would add `expo-crypto` + more native surface).

### Redirect URI (derived from configured scheme `mobile`)

Use `AuthSession.makeRedirectUri()` — reads `scheme: "mobile"` from `app.json`.

| Environment | Expected redirect pattern |
|-------------|---------------------------|
| TestFlight / production build | `mobile://` or `mobile://redirect` (exact path depends on `makeRedirectUri` options — **must be measured at implementation time**) |
| Development build | Same scheme unless overridden |
| Expo Go | **Not supported** for this flow |
| Local dev | Development build with same scheme |

**Clerk Dashboard allowlist:** Add mobile redirect URLs under **Native applications** / **Redirect URLs** (exact paths per Clerk Expo docs). Also enable **Native API** for the Clerk application.

**Do not use** `https://auth.expo.io/...` proxy.

### Google Cloud / Clerk configuration

| Item | Operator action |
|------|-----------------|
| Clerk Google social connection | Enable in Clerk Dashboard |
| Development vs production Clerk | Confirm instance; production may require custom Google OAuth client |
| Custom Google OAuth credentials | Required for production Google sign-in (Clerk docs); dev may use Clerk shared credentials |
| Google Cloud Console | OAuth client IDs for iOS/Android/Web if Clerk prompts |

---

## Part 8 — OTA versus new-build determination

### Already in current binary configuration

| Capability | Present |
|------------|---------|
| `expo-web-browser` native module | **Yes** |
| `expo-linking` | **Yes** |
| URL scheme `mobile` | **Yes** |
| `expo-updates` | **Yes** |
| Runtime `1.0.0` / channel `production` | **Yes** |
| Expo SDK 54 / RN 0.81 | **Yes** |

### Missing for Clerk (browser OAuth + durable sessions)

| Capability | Present |
|------------|---------|
| `expo-secure-store` | **No** |
| `expo-auth-session` | **No** |
| `@clerk/expo` + config plugin | **No** |
| Clerk Native API (embedded SDKs) | **No** |

### OTA feasibility verdict

## **New build required**

**Exact reason:** The dependencies and config plugin required for `@clerk/expo` session persistence (`expo-secure-store`), OAuth redirect URI generation (`expo-auth-session`), and Clerk native application support (`@clerk/expo` plugin) are **absent** from `artifacts/mobile/package.json` and `app.json`. OTA can only ship JavaScript that calls native modules **already embedded** in the TestFlight binary; adding these packages without rebuilding will fail at runtime.

**Smallest native change set for one new build:**

1. `pnpm exec expo install @clerk/expo expo-secure-store expo-auth-session expo-web-browser` (web-browser already present; reinstall for SDK alignment).
2. Add plugins: `expo-secure-store`, `@clerk/expo` to `app.json`.
3. Keep scheme `mobile` (no change required unless Clerk testing proves otherwise).
4. `eas build --platform ios --profile production` (and Android when needed).
5. Configure `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in EAS `production` environment.

**After that build:** Auth UI, Convex identity bridge, forgot-password, and Google OAuth **JavaScript** can ship via `eas update --channel production --environment production`.

### Operator checks if binary drift is suspected

| Check | Command / location |
|-------|-------------------|
| Installed native modules in shipped build | EAS build logs / Expo dashboard build details |
| Runtime version on device | Expo Updates debug or `expo-updates` manifest |
| Embedded scheme | iOS `Info.plist` `CFBundleURLSchemes` from build artifact |

---

## Part 9 — Clerk-to-Convex authentication architecture

### Current Convex auth state in this monorepo

| Item | Status |
|------|--------|
| `convex/auth.config.ts` | **Does not exist** |
| `ctx.auth.getUserIdentity()` usage | **None** |
| Clerk JWT provider | **Not configured** |
| Patient auth | `userId` + `passwordHash` in function args |
| Doctor auth | Separate `doctorAccounts` + API bearer tokens |

**Important:** The **doctor portal Clerk application** referenced in product direction is **not wired in this repository**. Doctor routes use `convex/doctorAccounts.ts` with the same legacy hex `passwordHash` pattern via API server.

### Can the same Clerk application authenticate mobile users?

**Yes, architecturally** — one Clerk app can issue JWTs for multiple clients (Next.js doctor portal + Expo mobile) using the same issuer (`https://next-osprey-15.clerk.accounts.dev`).

### Required Convex changes (future — not implemented)

1. Add `convex/auth.config.ts`:

```ts
export default {
  providers: [
    {
      domain: "https://next-osprey-15.clerk.accounts.dev",
      applicationID: "convex", // confirm in Clerk JWT template
    },
  ],
};
```

2. Deploy auth config to Convex.
3. Create/confirm Clerk **JWT template** for Convex (`aud` / claims per Convex Clerk docs).
4. Mobile: replace `ConvexHttpClient` with `ConvexReactClient` + `ConvexProviderWithClerk` (or auth fetch wrapper supplying Clerk session token).
5. Add `users.clerkUserId` (unique index) + identity resolution mutations/actions.
6. Refactor `assertPatientAuth` → `requirePatientIdentity(ctx)` using JWT + mapping.

### Patient vs doctor separation

| Rule | Enforcement |
|------|-------------|
| Patient Clerk JWT | Maps only to `users` / patient functions |
| Doctor Clerk JWT (portal) | Maps only to `doctorAccounts` or separate doctor role table |
| No automatic cross-role | Explicit role claim or separate Clerk organizations / metadata |
| CGM API routes | Continue server-secret gating; patient identity from Clerk-protected Convex calls |

### Legacy coexistence during transition

- Feature flag: if no Clerk token, optionally allow legacy `passwordHash` on **specific** functions until migration complete.
- New users: Clerk-only.
- Log Clerk `sub` on link for audit.

---

## Part 10 — Environment variable inventory

| Variable | Classification | Purpose |
|----------|----------------|---------|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Mobile bundle / EAS production env | Clerk provider |
| `EXPO_PUBLIC_CONVEX_URL` | Mobile bundle / EAS | Convex endpoint (already used) |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile bundle / EAS | API server (CGM proxy, doctor sync) |
| `CLERK_SECRET_KEY` | API server or Convex actions / **never mobile** | User import, admin APIs, webhook verification |
| `CONVEX_URL` | API server private | Server-side Convex client |
| `CONVEX_DOCTOR_API_SECRET` | API server + Convex env | Doctor account API |
| `CONVEX_PATIENT_BACKEND_SECRET` | API server + Convex env | Patient backend routes |
| Clerk issuer / JWKS | Convex auth config | JWT validation |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel / doctor portal only | **Do not copy name to mobile** |

### EAS Update + new `EXPO_PUBLIC_` variables

`eas update --environment production` **can inject** newly added `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` into the JS bundle **without** a new native build, **provided** runtime version matches and the binary already contains required native modules. The publishable key is not compiled into native code.

---

## Part 11 — Clerk Dashboard operator checklist

Confirm in [Clerk Dashboard](https://dashboard.clerk.com) for instance `next-osprey-15`:

| Item | Navigation / action |
|------|---------------------|
| Application name / instance | Dashboard home |
| Publishable key | **API keys** → copy for `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (operator only; not in repo) |
| Native API enabled | **Configure → Native applications** |
| Google social connection | **User & Authentication → Social connections → Google** |
| Email/password enabled | **User & Authentication → Email, password** |
| Email verification required | **Email** settings |
| Password requirements | **Password** settings (align with mobile min 6 or tighten with UX update) |
| Sign-up fields | **User & Authentication** |
| Account linking behavior | **Account linking** — verified email only |
| Session lifetime | **Sessions** |
| Allowed redirect URLs | **Native applications** / **Paths** — add `mobile://` redirect URIs |
| Email templates | **Customization → Emails** (reset code template) |
| Sender name/domain | **Email** settings |
| Development vs production instance | **Instances** |
| Production activation | Clerk production checklist |
| Custom Google OAuth | Google connection → use custom credentials for production |
| Branding | **Customization** |
| User import | **Users** → import tool (for metadata only; **not** legacy hashes) |

**Do not** paste `CLERK_SECRET_KEY` into this repo or chat logs.

---

## Part 12 — Recommended staged implementation

### Stage 1 — Identity bridge and compatibility foundation

| Item | Detail |
|------|--------|
| Work | `ClerkProvider`, `tokenCache`, `ConvexProviderWithClerk`, `users.clerkUserId`, `identity.resolve` action, legacy auth flag |
| Files | `app/_layout.tsx`, new `context/ClerkConvexProvider.tsx`, `convex/auth.config.ts`, `convex/identity.ts`, `convex/schema.ts` |
| Deployment | **New native build** + Convex deploy |
| OTA | Not yet for Clerk-dependent code |
| Rollback | Feature flag to legacy auth; leave `clerkUserId` nullable |
| Blockers | Native build, publishable key in EAS |

### Stage 2 — New Google OAuth path

| Item | Detail |
|------|--------|
| Work | `useSSO` / OAuth button on `auth.tsx`, redirect handling, `setActive`, new-user provisioning |
| Files | `auth.tsx`, identity action, tests |
| Deployment | OTA (after Stage 1 build) + Convex |
| Rollback | Hide Google button via OTA |
| Blockers | Clerk Google connection, redirect allowlist |

### Stage 3 — Clerk email/password sign-up and sign-in

| Item | Detail |
|------|--------|
| Work | Replace `createAccount` / `signIn` internals with Clerk; keep UI |
| Files | `AuthContext.tsx`, `auth.tsx`, Convex identity |
| Deployment | OTA + Convex |
| Rollback | Feature flag per method |

### Stage 4 — Forgot-password recovery

| Item | Detail |
|------|--------|
| Work | Forgot password UI + Clerk email code flow |
| Files | `auth.tsx`, new components |
| Deployment | OTA |
| Rollback | Hide link |

### Stage 5 — Existing-account transition

| Item | Detail |
|------|--------|
| Work | Email match linking, forced reset campaign, duplicate detection |
| Files | `convex/identity.ts`, migration scripts (server-side with `CLERK_SECRET_KEY`) |
| Deployment | Convex + operator comms |
| Rollback | Keep legacy path for unlinked users |

### Stage 6 — Legacy-auth retirement

| Item | Detail |
|------|--------|
| Work | Remove `passwordHash` transport, `api.auth.login`, client `hashPassword` |
| Files | Convex patient modules, `AuthContext.tsx`, API routes |
| Deployment | OTA + Convex |
| Rollback | Re-enable legacy flag if needed |

**Recommended first implementation stage after audit:** **Stage 1** (plus the **one required native build**).

---

## Part 13 — Required testing plan (future)

### Google OAuth

- [ ] New Google sign-up
- [ ] Returning Google sign-in
- [ ] Canceled browser OAuth
- [ ] OAuth provider error
- [ ] App killed during OAuth → return to app
- [ ] Redirect lands on `mobile://` handler
- [ ] Duplicate callback / double `setActive` idempotency

### Email/password

- [ ] New sign-up with verification
- [ ] Sign-in
- [ ] Existing-user Clerk link by verified email
- [ ] Unverified email cannot claim account
- [ ] Duplicate legacy email handling

### Forgot password

- [ ] Email code sent (generic UX)
- [ ] Wrong / expired code
- [ ] Resend throttling
- [ ] New password + session active
- [ ] Google-only email → guided to Google (no enumeration)

### Session / data integrity

- [ ] Sign-out preserves theme; clears Clerk session
- [ ] App restart session restoration (`tokenCache`)
- [ ] Device restart
- [ ] Clerk outage graceful error
- [ ] Convex outage graceful error
- [ ] Unauthorized doctor role blocked
- [ ] Caregiver codes still work
- [ ] No duplicate Convex profile
- [ ] Glucose + CGM data preserved
- [ ] Dark / Light / Automatic on auth screens

### Distribution

- [ ] TestFlight binary (new build)
- [ ] OTA update on `production` channel
- [ ] Runtime version mismatch rejected

---

## Security risks and account-takeover protections

| Risk | Mitigation |
|------|------------|
| Client-supplied email linking | Link only in Convex with Clerk JWT + verified email |
| Legacy `passwordHash` leakage | Retire transport; hash is weak — do not reuse as security boundary long-term |
| Duplicate Convex profiles | Unique `clerkUserId`; transactional link by email |
| Doctor role escalation | Separate doctor identity; explicit authorization |
| OAuth redirect hijacking | Custom scheme only; allowlist in Clerk; no expo auth proxy |
| Account enumeration | Generic forgot-password copy |
| Caregiver code brute force | Rate limit (future); 6-char codes — monitor abuse |

---

## Rollback strategy

1. **OTA:** Ship flag to hide Clerk UI and restore legacy `AuthContext` paths.
2. **Convex:** Keep legacy `assertPatientAuth` functions until Stage 6.
3. **Clerk:** Disabling Clerk strand existing users with `clerkUserId` set — avoid disabling without migration complete.
4. **Native build:** Previous binary remains on store; OTA can target prior channel if needed.

---

## Unresolved questions

1. **Exact TestFlight build fingerprint** — confirm on EAS that the live binary matches current `app.json` plugins (no manual native edits).
2. **Doctor portal Clerk integration** — live in external repo; confirm JWT template and role claims match what Convex will enforce for patients.
3. **Android package name** — set explicitly before Android Clerk/Google configuration.
4. **Expo account owner** — not in repo; needed for EAS dashboard operations.
5. **Duplicate `users.email` rows** — operator should verify production Convex data has unique emails before email-based linking.
6. **Google account production credentials** — confirm whether Clerk production instance uses custom Google OAuth client.
7. **Minimum password length** — mobile allows 6; Clerk default may be 8 — align policy and UI.

---

## Exact next implementation package recommendation

1. **Operator:** Complete Clerk Dashboard checklist (§11); add `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to EAS production; enable Native API + Google + redirect URLs.
2. **Engineering package 1 (native):** Install `@clerk/expo`, `expo-secure-store`, `expo-auth-session`; update `app.json` plugins; `eas build` iOS production.
3. **Engineering package 2 (backend):** Add `convex/auth.config.ts`, `users.clerkUserId`, identity resolution action; deploy Convex.
4. **Engineering package 3 (mobile OTA):** Wire `ClerkProvider` + `ConvexProviderWithClerk`; feature-flagged; legacy auth still works.
5. **Engineering package 4 (OTA):** Google OAuth button + linking flows.
6. **Engineering package 5 (OTA + ops):** Email/password cutover + forgot-password + legacy user reset campaign.

---

## Validation record

| Check | Result |
|-------|--------|
| Packages installed | **No** |
| Native builds | **No** |
| Convex deploy | **No** |
| EAS Update | **No** |
| Secrets used | **No** |
| Files modified for audit | `docs/specs/mobile_clerk_authentication_and_ota_feasibility_audit_v1.md` only (intended) |

---

*End of audit v1.*
