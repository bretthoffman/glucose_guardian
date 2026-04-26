# PATIENT_APP_CHANGE_01

## What was changed

- Updated doctor sync URL resolution in `syncToDoctor` to use the shared mobile API URL helper.
- Removed the local/manual base URL branching that previously used `EXPO_PUBLIC_DOMAIN` and a hardcoded localhost fallback.
- Kept the endpoint path and request body the same (`/api/doctor/sync`, same payload structure).

## Exact files changed

- `artifacts/mobile/context/AuthContext.tsx`

## Why this change was made

- This aligns doctor sync with the same API base URL strategy already used by other mobile `/api/*` calls via `apiUrl(...)`.
- It eliminates one-off URL resolution logic in `AuthContext`, reducing environment drift and inconsistent behavior across API calls.

## Behavior intentionally left unchanged

- No auth architecture changes (local auth/session behavior remains exactly as-is).
- No feature logic changes in doctor sync (same trigger behavior, same payload fields, same silent error handling).
- No backend route changes (`/api/doctor/sync` remains the target endpoint).
- No Vercel/Replit cleanup in this task.

## Follow-up concerns noticed

- `syncToDoctor` still swallows all errors (`catch {}`), which keeps current behavior but can hide sync failures during debugging.
- This was intentionally not changed to keep scope narrow.

## Verification checklist (manual)

- [ ] Start mobile app with the same environment you normally use for API-backed features.
- [ ] Sign in and ensure a profile exists with a generated doctor code.
- [ ] Trigger doctor sync flow (dashboard auto-sync path where doctor code is present).
- [ ] Confirm doctor sync still succeeds (no regressions in doctor portal snapshot availability).
- [ ] Confirm other API-backed features still work (chat/food/cgm) to verify base URL strategy remains consistent.
- [ ] Confirm no new auth/session behavior changes were introduced.
