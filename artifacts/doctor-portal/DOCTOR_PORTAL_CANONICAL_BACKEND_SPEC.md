# Doctor portal — canonical backend specification

> **⚠️ SUPERSEDED (historical design, 2026-06-25) — not what was built.** The portal never adopted
> the Clerk + direct-Convex design below, and none of its proposed function names exist. As
> implemented: the portal calls the shared Glucose Guardian **api-server** (REST, via
> `VITE_API_BASE_URL` → `https://glucose-guardian-ashen.vercel.app`) using the backend's own doctor
> Bearer-token auth (`convex/doctorAccounts.ts`, `convex/doctor.ts`, `convex/doctorAlerts.ts`). The
> api-server's `CONVEX_URL` points at **production, `polished-badger-189`**. The dev deployment and
> Clerk dev instance named below are no longer live for the portal.

**Implement this in the canonical backend repository, not in the doctor portal.**

- Backend repo: https://github.com/bretthoffman/glucose_guardian
- Convex deployment (shared): `dev:clean-ptarmigan-904`
- Convex cloud URL: `https://clean-ptarmigan-904.convex.cloud`
- Clerk app (shared, reuse): issuer `https://next-osprey-15.clerk.accounts.dev`

The doctor portal (Vite + React SPA) is the **consumer** of these functions. It must not
own the schema, authorization, or doctor/patient tables. All function names below are
**proposed contracts** — reconcile each with the names and tables already in
`convex/schema.ts` and reuse existing conventions rather than creating parallel tables.

Authentication is owned by Clerk. Authorization is owned by Convex. A valid Clerk session
proves identity only; it never by itself grants doctor access.

---

## 0. Preconditions to verify before writing code

1. `convex/auth.config.ts` contains a Clerk provider:
   ```ts
   export default {
     providers: [
       { domain: "https://next-osprey-15.clerk.accounts.dev", applicationID: "convex" },
     ],
   };
   ```
   If it is missing, points elsewhere, or uses a different application, fix it here. Do
   not create a second auth config in the portal.
2. Identify the **existing** patient tables. The patient app already syncs a
   `PatientSnapshot` containing `profile` (`PatientProfile`), `glucoseReadings`
   (`CGMReading`), `insulinLog` (`InsulinLogEntry`), `foodLog` (`FoodLogEntry`),
   `messages` (`DoctorMessage`), and `alertPreferences`. Reuse these. Doctor-facing
   queries read existing patient data; they must not duplicate it.
3. On the shared Clerk instance, confirm email-based sign-in is enabled (email + password, or
   email code) so doctors can use a work email. Decide whether to disable Google org-wide — it
   affects the patient app too, so it's Brett's call. The portal already hides social buttons in
   its own UI; a hard disable is a dashboard-only setting.
4. Identify the legacy doctor HTTP endpoints (`/api/doctor/login`,
   `/api/doctor/patient/:accessCode`, `/api/doctor/messages/:accessCode`, `syncPatientData`).
   The portal is migrating off these REST/code-only routes to Clerk-authenticated Convex
   client calls. Plan their deprecation; do not break the patient app's `syncPatientData`.

## 1. Naming reconciliation (fill in before implementing)

| This spec | Existing equivalent in `glucose_guardian` | Action |
|-----------|--------------------------------------------|--------|
| `doctors` | ? | reuse / extend / create |
| `patients` / patient profile | `PatientProfile` (exists) | reuse |
| `organizations` | ? | likely new |
| `doctorPatientGrants` | ? | likely new |
| `therapyOrders` | settings live in `PatientProfile` today | new (extract) |
| `doctorInvitations` | ? | likely new |
| `auditLog` | ? | reuse / new |

## 2. Identity resolution helper (used by every doctor function)

```ts
// convex/doctorAuth.ts  (name to reconcile)
export async function getAuthedDoctor(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  const doctor = await ctx.db
    .query("doctors")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();
  if (!doctor) return { status: "not_provisioned", identity };
  if (doctor.status === "suspended") return { status: "suspended", doctor };
  if (doctor.status !== "active") return { status: "pending", doctor };
  return { status: "active", doctor };
}

export async function requireActiveDoctor(ctx) {
  const r = await getAuthedDoctor(ctx);
  if (r.status !== "active") throw new ConvexError({ code: r.status.toUpperCase() });
  return r.doctor;
}

export async function assertGrant(ctx, doctor, patientId, { prescriber = false } = {}) {
  const grant = await ctx.db
    .query("doctorPatientGrants")
    .withIndex("by_doctor_patient", q =>
      q.eq("doctorId", doctor._id).eq("patientId", patientId))
    .unique();
  if (!grant || grant.status !== "active") throw new ConvexError({ code: "NO_GRANT" });
  if (prescriber && !grant.isPrescriber) throw new ConvexError({ code: "NOT_PRESCRIBER" });
  return grant;
}
```

Never trust client-supplied `doctorId`, `role`, `isDoctor`, or an unchecked `patientId`.

## 3. Schema additions (reconcile with existing tables)

```ts
doctors: defineTable({
  clerkUserId: v.string(),          // Clerk identity.subject — the binding
  email: v.string(),
  displayName: v.string(),
  organizationId: v.id("organizations"),
  role: v.union(v.literal("doctor"), v.literal("org_admin")),
  specialty: v.optional(v.string()),
  title: v.optional(v.string()),    // MD, DO, NP, PA, RN, CDE/CDCES
  npi: v.optional(v.string()),      // 10-digit National Provider Identifier (optional)
  status: v.union(v.literal("active"), v.literal("pending"), v.literal("suspended")),
  createdAt: v.number(),
}).index("by_clerkUserId", ["clerkUserId"])
  .index("by_org", ["organizationId"]),

organizations: defineTable({
  name: v.string(),                 // MUSC, WakeMed, Roper, Duke, ...
  slug: v.string(),
  allowedEmailDomains: v.array(v.string()), // e.g. ["musc.edu"] — work-email auto-provision
}).index("by_slug", ["slug"]),

doctorPatientGrants: defineTable({
  doctorId: v.id("doctors"),
  patientId: v.id("patients"),      // reconcile with existing patient table id
  isPrescriber: v.boolean(),        // designated prescriber gate for order writes
  status: v.union(v.literal("active"), v.literal("pending"), v.literal("revoked")),
  grantedBy: v.optional(v.id("doctors")),
  grantedAt: v.number(),
  revokedAt: v.optional(v.number()),
}).index("by_doctor_patient", ["doctorId", "patientId"])
  .index("by_patient", ["patientId"]),

therapyOrders: defineTable({       // server-owned source of truth for settings
  patientId: v.id("patients"),
  carbRatio: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  insulinTypes: v.optional(v.array(v.string())),
  alertThresholds: v.optional(v.object({
    low: v.optional(v.number()), high: v.optional(v.number()),
    urgentLow: v.optional(v.number()), urgentHigh: v.optional(v.number()),
  })),
  version: v.number(),
  status: v.union(v.literal("proposed"), v.literal("acknowledged"),
                  v.literal("active"), v.literal("superseded")),
  proposedByDoctorId: v.id("doctors"),
  proposedAt: v.number(),
  note: v.optional(v.string()),
  acknowledgedAt: v.optional(v.number()),  // set by caregiver app
  supersededAt: v.optional(v.number()),
}).index("by_patient_status", ["patientId", "status"]),

doctorInvitations: defineTable({
  email: v.string(),
  organizationId: v.id("organizations"),
  role: v.union(v.literal("doctor"), v.literal("org_admin")),
  isPrescriberDefault: v.boolean(),
  token: v.string(),
  status: v.union(v.literal("pending"), v.literal("accepted"),
                  v.literal("revoked"), v.literal("expired")),
  invitedBy: v.optional(v.id("doctors")),
  expiresAt: v.number(),
  acceptedClerkUserId: v.optional(v.string()),
  acceptedAt: v.optional(v.number()),
}).index("by_email", ["email"]).index("by_token", ["token"]),

auditLog: defineTable({             // append-only
  at: v.number(),
  actorType: v.union(v.literal("doctor"), v.literal("caregiver"), v.literal("system")),
  actorDoctorId: v.optional(v.id("doctors")),
  clerkUserId: v.optional(v.string()),
  action: v.string(),               // e.g. "view_patient", "propose_order"
  patientId: v.optional(v.id("patients")),
  field: v.optional(v.string()),
  oldValue: v.optional(v.any()),
  newValue: v.optional(v.any()),
  reason: v.optional(v.string()),
}).index("by_patient", ["patientId"]).index("by_actor", ["actorDoctorId"]),
```

## 4. Functions — the exact frontend contracts

Names are proposed; reconcile with existing conventions. The portal calls these via the
Convex client with Clerk identity attached.

### Queries

- `organizations.search({ query })` → organizations matching the typed query, for the login
  org picker. **Public (no auth)** — it runs before sign-in. Must be backed by a real
  server-side directory, not a hardcoded list: the full US set is millions of records and can't
  ship in the SPA. Source it from CMS NPPES (filter org/provider records by the endocrinology
  taxonomy `207RE0101X`, plus related pediatric-endo codes) and/or curate per onboarding. Return
  a capped result set (e.g. top 25) and `log()` nothing sensitive.
- `doctors.getCurrent()` → discriminated state, **not** a throw on missing profile:
  `{ status: "active", doctor, organization } | { status: "not_provisioned" } |
  { status: "pending" } | { status: "suspended" }`.
  This is the first call the portal makes after sign-in to choose which screen to render.
- `doctorPatients.list()` → `Array<{ patientId, displayName, accessCode, hasData,
  lastReadingAt, syncedAt, flags }>`. Returns only patients with an active grant for the
  authed doctor. Server-filtered; org wall enforced here.
- `doctorPatients.get({ accessCode | patientId })` → authorized patient detail: profile
  (demographics only — not authoritative settings), glucose history, insulin log, food
  log, current `active` therapy order, alert preferences. Authz: `requireActiveDoctor` +
  `assertGrant`. Writes an `auditLog` "view_patient" entry.
- `doctorMessages.list({ patientId })` → messages. Authz: `assertGrant`.
- `therapyOrders.current({ patientId })` → `{ active, proposed? }`. Authz: `assertGrant`.
- `therapyOrders.history({ patientId })` → version history. Authz: `assertGrant`.

### Mutations

- `doctorMessages.send({ patientId, body })`. Authz: `assertGrant`. Audit.
- `doctorPatients.linkByDoctorCode({ code })` → resolves the app-generated **Doctor Code**
  (full-edit, e.g. `7ZD36Z`) to a patient and creates an active grant **immediately** — the
  code itself is the patient's consent, so there is no separate approval step. (The app also
  issues a view-only **Caregiver Code**; this portal uses only the Doctor Code.) Returns the
  linked patient. Authz: `requireActiveDoctor`; rate-limit; reject unknown/expired codes.
  NOTE: the existing backend already serves this via REST HTTP actions — `POST /api/doctor/login`
  (validate) and `GET /api/doctor/patient/:code` (real `PatientSnapshot`). The portal can use
  those today as the bridge; the Convex function above is the clean target.
- `therapyOrders.propose({ patientId, changes, note, baseVersion })`. Authz:
  `assertGrant` with `prescriber: true` + same org. Optimistic concurrency: reject if
  `baseVersion !== current.version`. Range/sanity validation (flag implausible ratios).
  Creates a `proposed` order; does **not** go active. Audit "propose_order".
- `therapyOrders.acknowledge({ orderId })` — **caregiver/app only, not the portal.**
  Transitions `proposed → active`, supersedes the prior active order, stamps
  `acknowledgedAt`. Audit "acknowledge_order".
- Admin: `doctorInvitations.create / revoke`, `doctorInvitations.accept({ token })`
  (resolves on first matching Clerk sign-in → creates the `active` doctor profile bound
  to `clerkUserId`), `doctorPatients.revokeGrant`, `doctors.suspend`.

## 5. Doctor provisioning (no self-service)

- A Clerk user with no `doctors` row gets `getCurrent() → not_provisioned`. The portal
  shows "access not provisioned / invitation required" and exposes no patient data.
- **Primary path (chosen): work-email domain match.** On first sign-in, match the verified
  Clerk email domain against `organizations.allowedEmailDomains`. A match auto-creates the
  doctor profile in that org (`active`, or `pending` if you want a light review). Non-matching
  emails fall back to invitation or the admin approval queue.
- Provisioning path: an `org_admin` creates a `doctorInvitation` (email + org + role).
  When that person signs in with Clerk under the matching verified email and accepts, the
  backend creates the `active` doctor profile bound to their `clerkUserId`.
- **First admin** is provisioned by a controlled operator action (a one-off seed mutation
  run via the Convex dashboard/CLI by the operator), never a public path.
- **Portal login wiring (this phase).** The portal's org-picker + work-email screens become the
  real production login by wiring them to Clerk (`useSignIn` / `useSignUp`, social hidden). This
  is deliberately deferred until provisioning exists — until `doctors.getCurrent` resolves a
  profile, a signed-in doctor lands on `not_provisioned` and the flow has nowhere to go. Today
  the portal's `/login` is Clerk's email-only component; the org-first flow is the dev experience.

## 6. Settings source-of-truth migration (depends on an app change)

- One-time migration: seed `therapyOrders` (status `active`, `version: 1`) from each
  patient's current `PatientProfile.carbRatio / correctionFactor / targetGlucose` and
  `alertPreferences`.
- App change (separate repo): the patient app pulls the `active` therapy order down and
  drives dosing from it; it keeps pushing **observations** up via `syncPatientData` but
  stops pushing **settings** up as authoritative. Without this, doctor changes get
  overwritten by the next sync.

## 7. Generated Convex API — cross-repo contract

The portal needs `convex/_generated/api` types to call these functions type-safely.
Recommended, in order of preference:

1. Publish a small versioned package from `glucose_guardian` (e.g.
   `@glucose-guardian/convex-api`) exporting the generated `api` + types; the portal adds
   it as a dependency.
2. Or commit a synced copy in the portal under a clearly labeled path
   (`lib/convex-api/`) updated by a documented script (`pnpm sync:convex-api`) that copies
   from a local backend checkout. Never an undocumented manual copy.

The portal connects with `VITE_CONVEX_URL`; it does not use a Convex deploy key.

## 8. Portal screen → contract map (what unblocks the frontend)

| Portal state / screen | Backend function | Blocked until backend lands |
|------------------------|------------------|------------------------------|
| App load → route decision | `doctors.getCurrent` | yes |
| Patient list `/` | `doctorPatients.list` | yes |
| Link a patient | `doctorPatients.requestLink` | yes (+ app approval) |
| Patient detail `/patient/:code/*` | `doctorPatients.get` | yes |
| Messages tab | `doctorMessages.list` / `.send` | yes |
| Insulin/settings tab (read) | `therapyOrders.current` / `.history` | yes |
| Settings change (prescriber) | `therapyOrders.propose` | yes |
| Not-provisioned / pending / suspended | `doctors.getCurrent` status | yes |

## 9. Backend security checklist (must hold)

- `ctx.auth.getUserIdentity()` on every doctor function; reject null.
- Resolve to an `active` doctor; reject `not_provisioned` / `pending` / `suspended` for
  protected data.
- Patient-specific access requires an `active` grant; order writes also require
  `isPrescriber`.
- No plaintext passwords stored; Clerk owns auth. No second username/password system.
- `auditLog` is append-only; never log secrets.
- Optimistic concurrency + range validation on order writes.
- Org isolation derived from the doctor profile, never from client input.
- The quick-access PIN is a client-side, device-bound soft lock over a live session — never a
  backend credential and never primary auth. Record login / lock / unlock and PIN-failure
  lockouts in `auditLog`; full-login rate-limiting, MFA, and passkeys are Clerk's job.

## 10. Out of scope here / deferred

- No Convex/Vercel/EAS deploy and no live-data mutation as part of this spec.
- First-admin seed is an explicit operator action.
- Org onboarding mechanism (email-domain vs invite vs approval) — recommend invite links
  from an org admin with email-domain as a convenience default; decide before building
  `doctorInvitations.accept`.
