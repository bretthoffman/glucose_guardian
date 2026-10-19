# Doctor portal — multi-tenancy + therapy write-back plan

A phased plan to take the doctor portal from today's single-access-code login to a
multi-organization portal where doctors see only their own patients and can adjust
therapy settings that flow back to the patient app safely.

## Decisions locked

- **Server is the source of truth for therapy settings.** The patient app will be
  changed to pull active settings down from the server instead of pushing them up.
- **Caregiver confirmation.** A doctor's change is `proposed` until the parent/caregiver
  acknowledges it in the app; only then does it become `active` and affect dosing.
- **Designated prescriber.** Within a patient's care, only the assigned prescribing
  doctor can edit orders. Other linked doctors view but cannot change.

## Repo boundaries (important)

This work spans three codebases. Each item below is tagged:

- `[portal]` — **this repo** (Vite + React doctor portal). Frontend only.
- `[backend]` — the Gluco-Guardian Convex monorepo (separate repo). Source of truth,
  auth, authorization, audit. Not present here.
- `[app]` — the patient mobile app (separate repo, in development).

The portal can never enforce access on its own — it renders what the authorized API
returns. All isolation and all write authorization live in `[backend]`.

## Current state (verified in this repo)

- Login is the deprecated single access code: `src/hooks/use-auth.ts` stores
  `gg_doc_access_code` / `gg_doc_patient_name`. No doctor accounts, no org.
- Routes are `/`, `/login`, `/dashboard/:tab` (`src/App.tsx`). No patient-detail route.
- Panels are read-only — no edit/save/mutation in `src/components/panels/`.
- Data flows one way: the app POSTs a full `PatientSnapshot` via `syncPatientData`
  (`lib/api-client-react`), including `profile.carbRatio` / `correctionFactor` /
  `targetGlucose`. A naive doctor write would be overwritten by the next app sync.
- `DOCTOR_PORTAL_ACCOUNTS_MIGRATION_01.md` describes a doctor-accounts migration, but
  that migration is **not** present in this repo's code or generated client. Phase 1
  below implements it and adds org scoping on top.

## Target data model

- `organizations` — MUSC, WakeMed, Roper, Duke, … (the tenant).
- `doctors` — `{ id, email, passwordHash, organizationId, role, specialty }`.
- `patients` — the child; identity + `accessCode`. Patient-owned data (consent-based
  sharing), with `organizationId` as the home/admin org.
- `doctorPatientLinks` — `{ doctorId, patientId, isPrescriber }`. Gates read **and** write.
- `observations` — `glucoseReadings`, `foodLog`, `insulinLog`, `alerts`. App-owned,
  append-only, read-only to doctors.
- `therapyOrders` — `{ carbRatio, correctionFactor, targetGlucose, insulinTypes,
  alertThresholds, version, status, proposedBy, proposedAt, acknowledgedAt }`.
  Server-owned, versioned. Pulled from `PatientProfile` today.
- `auditLog` — immutable: `{ actorDoctorId, patientId, field, oldValue, newValue,
  at, reason, ackStatus }`. Covers both reads of PHI and order changes.

---

## Phase 1 — Doctor accounts + organization isolation

**Goal:** doctors log in as themselves, scoped to their organization, and see only the
patients linked to them. Read-only. This alone delivers the core ask ("doctors log in,
see their patients, no crossing over") and is safe to ship before any write-back.

- `[backend]` `organizations` + `doctors` tables; auth (register / login / logout / me)
  issuing a bearer token that resolves to `{ doctorId, organizationId, role }`.
- `[backend]` Every patient/message query filtered by `organizationId` **and** an
  existing `doctorPatientLink`. Organization is derived from the token, never from the
  request body or query string.
- `[backend]` Patient linking requires patient/caregiver approval or a one-time expiring
  code — closes the "guess a 6-char access code from another org" risk.
- `[backend]` Begin writing `auditLog` entries for patient-data reads.
- `[portal]` Implement the accounts migration the doc describes (not yet in this repo):
  - `AuthProvider` / auth context; replace `src/hooks/use-auth.ts`.
  - Login + register pages; token + expiry in session storage.
  - Bearer injection in `lib/api-client-react/src/custom-fetch.ts`.
  - Protected routes; patient list at `/`; patient detail at `/patient/:accessCode/:tab`;
    legacy `/dashboard/*` redirects to `/`.
  - Regenerate the API client from the backend's current OpenAPI.
  - Doctor name + organization in the header.

**Done when:** a MUSC doctor logs in, sees only their linked patients, and cannot reach a
Duke patient even by editing the URL or any request.

## Phase 2 — Observations / orders split (move the source of truth)

**Goal:** make therapy settings server-owned without changing behavior yet. De-risks the
architectural change before adding any editing UI.

- `[backend]` New `therapyOrders` record per patient, versioned, seeded from the current
  `PatientProfile` values.
- `[backend]` Split `syncPatientData`: observations ingest stays app → server; settings
  become a server → app read. The app no longer pushes settings up as authoritative.
- `[app]` Pull active settings from the server and apply them to the dosing calculation;
  keep pushing observations up. **This is the load-bearing app change.**
- `[portal]` Display current orders read-only, with version and "last changed by".

**Done when:** the app drives dosing from server-held settings, and an app sync no longer
overwrites them.

## Phase 3 — Doctor write-back with the safety lifecycle

**Goal:** the actual feature. A prescriber proposes a change; the caregiver confirms; the
app applies it. Last, because it sits on Phase 2's system of record and the safety
machinery below.

- `[backend]` Order-write endpoint. Authorization: same org + linked + `isPrescriber`.
  Optimistic concurrency via `version` (reject stale writes). Range/sanity validation
  (flag a fat-fingered 1:1 vs 1:15 ratio). Writes an `auditLog` entry.
- `[backend]` Order lifecycle: `proposed → acknowledged → active → superseded`. Prior
  values retained, never deleted.
- `[app]` Caregiver sees the proposed change, confirms; on confirm it goes `active`, the
  app applies it and logs it locally; notification on change.
- `[portal]` Editing UI in the panels (`InsulinPanel`, etc.): prescriber proposes a change
  with a note; shows pending vs active state and history; non-prescribers are read-only;
  client-side range warnings before submit.

**Done when:** a prescriber changes a ratio, the caregiver confirms in the app, the app
doses on the new value, and the whole chain is in the audit log.

## Phase 4 — Portal polish + enterprise readiness

- Triage dashboard: patients out of range, time-in-range, last sync, flags — a population
  view instead of a flat list (reuse `recharts` + existing panels).
- Surface critical low/high alerts rather than making doctors hunt for them.
- Org-admin screens: manage doctors, assign the prescriber per patient.
- SSO (SAML / OIDC) for large systems that won't accept email/password.
- Audit-log viewer.
- Compliance: BAA with the backend host, encryption at rest/in transit, retention policy.

---

## One decision still open

**How do doctors get attached to an organization?** Options: auto-map by email domain
(`@musc.edu` → MUSC), invite links from an org admin, or an admin approval queue.
Recommendation: invite links from an org admin, with email-domain as a convenience
default. Needed before Phase 1 backend work; the portal side is unaffected either way.

## Cross-cutting (every phase)

- Authorization is enforced in `[backend]` from the token. The portal is never trusted.
- Versioning + optimistic concurrency on orders so two people can't silently clobber.
- Audit log is append-only and written from day one.
- This is pediatric PHI — caregiver acknowledgement on orders and a BAA are not optional.
