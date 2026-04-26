# Doctor sync trace (`syncToDoctor`)

This document is based on **repository inspection only** (no behavior changes). It traces where `syncToDoctor` is invoked and what must be true for data to reach `GET /api/doctor/patient/:accessCode`.

---

## 1. Every file/location where `syncToDoctor` is called

| File | Line(s) | What happens |
|------|---------|----------------|
| `artifacts/mobile/app/(tabs)/dashboard.tsx` | **185** | Immediate call: `syncToDoctor(mapped);` inside a `useEffect`. |
| `artifacts/mobile/app/(tabs)/dashboard.tsx` | **186** | Recurring call: `setInterval(() => syncToDoctor(mapped), 120_000)` (every 2 minutes). |

**Definition / implementation (not a separate call site):**  
`artifacts/mobile/context/AuthContext.tsx` — `syncToDoctor` is defined around **539–581** and exposed on the auth context (**~633**).

**Other mentions:** Planning/audit markdown (`CONVEX_V1_PLAN.md`, `PROJECT_AUDIT.md`, `PATIENT_APP_*.md`, etc.) reference `syncToDoctor` but do not invoke it.

---

## 2. Exact conditions required for it to run

### A. UI layer — `dashboard.tsx` `useEffect` (gates **all** current invocations)

From `artifacts/mobile/app/(tabs)/dashboard.tsx` **178–188**:

```178:188:artifacts/mobile/app/(tabs)/dashboard.tsx
  useEffect(() => {
    if (!profile?.doctorCode || !history.length) return;
    const mapped = history.map((e) => ({
      value: e.glucose,
      trend: typeof e.dexcomTrend === "string" ? e.dexcomTrend : "Flat",
      timestamp: e.timestamp,
    }));
    syncToDoctor(mapped);
    const timer = setInterval(() => syncToDoctor(mapped), 120_000);
    return () => clearInterval(timer);
  }, [profile?.doctorCode, history.length]);
```

**All of the following must hold for `syncToDoctor` to be scheduled from the app today:**

1. **`profile?.doctorCode`** is set (non-empty).
2. **`history.length` > 0** — at least one glucose entry in `GlucoseContext` history (typically from CGM sync / local readings).
3. The **Dashboard** tab screen is mounted long enough for this effect to run (the hook lives only on the Dashboard route component).

The effect’s dependency array is **`[profile?.doctorCode, history.length]`** — it does **not** list `syncToDoctor` or full `history`; when `history.length` is unchanged, the effect does not re-run (so the mapped payload used for the interval may lag if readings update without a length change — **observed from code**, relevant for debugging stale syncs).

### B. Auth layer — `syncToDoctor` body (gates the HTTP request)

From `artifacts/mobile/context/AuthContext.tsx` **539–547**:

- Uses refs for profile, insulin log, food log, alert prefs, doctor messages.
- **Early return:** if `!currentProfile?.doctorCode`, the function returns and **does not** call `fetch`.
- Otherwise it `POST`s `apiUrl("/api/doctor/sync")` with a snapshot built from current ref state and the passed-in `glucoseReadings` (default `[]` if omitted).

**Note:** Nothing else in the mobile tree calls `syncToDoctor(...)` with a grep for `syncToDoctor(` — so **Dashboard is the only trigger**.

---

## 3. Does generating a doctor code alone trigger a sync?

**No (based on current code).**

- **`generateDoctorCode`** (`artifacts/mobile/context/AuthContext.tsx` **481–494**) updates the profile (`doctorCode`, `doctorCodeIssuedAt`) and access log; it does **not** call `syncToDoctor`.
- UI call sites for `generateDoctorCode` are in `dashboard.tsx` (e.g. around **1722**, **1758**); they show alerts but do not invoke `syncToDoctor`.

So a **valid doctor code can exist on the device** while **no server-side patient row** exists until a successful `POST /api/doctor/sync`.

---

## 4. Most likely reason a valid doctor code still returns  
`{"error":"No patient data found for this access code"}`

That JSON is the **404** body from `GET /api/doctor/patient/:accessCode` when the backend has **no stored patient snapshot for that code** (Convex `doctorPortalState` without `profile`, or legacy in-memory `patientStore` miss).

**Most likely in this codebase:** the app **never successfully completed** `POST /api/doctor/sync` for that code, because:

1. **`history.length` is 0** — the Dashboard `useEffect` bails out before calling `syncToDoctor`, so the backend never receives a sync even though `doctorCode` is set.
2. The user **has not stayed on / opened the Dashboard tab** after setting the code and getting history — sync is only hooked on the Dashboard screen.
3. **`syncToDoctor` fails silently** — the implementation uses `try { ... await fetch(...) } catch {}` (**580**), so network/base URL errors do not surface in UI; the server would still have no data.

Less primary but possible: environment/deploy mismatch (API URL, Convex vs in-memory fallback), or code mismatch (unlikely here: sync uppercases `accessCode` to match the API).

---

## 5. Single best next implementation / debug step

**Verify end-to-end that `POST /api/doctor/sync` returns success for the same access code the doctor uses** (device network inspector, proxy, or API/Convex logs) **after** the patient has **at least one glucose reading in app history** and has opened the **Dashboard** tab.

If that POST never appears or never returns 2xx, fix URL/connectivity first; if POST succeeds but GET still 404, trace server routing/storage for that deployment.

---

## Quick reference

| Question | Answer |
|----------|--------|
| Only call sites | `dashboard.tsx` **185–186** |
| Must have doctor code? | Yes (`profile?.doctorCode` + `syncToDoctor` guard) |
| Must have glucose history? | Yes (`history.length` in Dashboard effect) |
| Code generation → sync? | **No** |
