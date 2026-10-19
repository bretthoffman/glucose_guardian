import { AlertTriangle, Clock, Phone, RefreshCw } from "lucide-react";
import type { PatientSnapshot } from "@doctor-portal/api-client-react";
import { formatDate, formatTime, parseDate } from "@/lib/utils";
import { computeMetrics, formatAge, isToday, STATUS_META, TREND_LABEL } from "@/lib/glucose-metrics";
import { PatientAvatar } from "@/components/PatientAvatar";
import { CaregiverName } from "@/components/CaregiverName";
import { useCareCircle } from "@/data/doctor-data";

/** Time for today's events, but a date once they're older — so a stale entry never reads as "now". */
function stamp(ts: string): string {
  return isToday(ts) ? formatTime(ts) : formatDate(ts);
}

function typeLabel(t?: string): string {
  return t === "type1" ? "Type 1" : t === "type2" ? "Type 2" : "Other";
}

/** Age from a date-of-birth ISO string, in years (or months under a year). */
function ageLabel(dob?: string): string | null {
  if (!dob) return null;
  const d = parseDate(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) {
    years--;
  }
  if (years < 0) return null;
  if (years >= 1) return `${years} yr${years === 1 ? "" : "s"}`;
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months--;
  months = Math.max(0, months);
  return `${months} mo`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">{label}</p>
      <p className="text-sm font-medium text-foreground mt-1 whitespace-nowrap">{value}</p>
    </div>
  );
}

export function PatientHeader({
  snapshot,
  onRefresh,
  refreshing,
  logsFromServer = false,
  source,
}: {
  snapshot: PatientSnapshot;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Meals/insulin come from the server-side log, so they're current even when the phone is idle. */
  logsFromServer?: boolean;
  /** "server" when the phone has never synced and this chart is built from server records. */
  source?: "phone" | "server";
}) {
  const p = snapshot.profile;
  const age = ageLabel(p.dateOfBirth);
  const syncMins = snapshot.syncedAt
    ? Math.max(0, Math.round((Date.now() - new Date(snapshot.syncedAt).getTime()) / 60000))
    : null;
  const m = computeMetrics(snapshot);
  const urgent = !m.stale && (m.status === "urgentHigh" || m.status === "urgentLow");
  const meta = m.status ? STATUS_META[m.status] : null;

  // Parents = the account holder and co-guardians from the Care Circle (never access-code
  // caregivers or family members). Until the roster is available, the synced guardian name.
  const circle = useCareCircle(snapshot.accessCode);
  const guardians = (circle ?? []).filter((c) => c.kind === "owner" || c.kind === "co_guardian");
  const selfManaged = (circle ?? []).some((c) => c.kind === "patient");
  const parentNames = guardians.length ? guardians.map((g) => g.name) : p.parentName ? [p.parentName] : [];

  return (
    <div className="bg-card border border-border rounded-2xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <PatientAvatar name={p.childName} photoDataUri={p.photoDataUri} className="w-11 h-11 text-base" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-display font-bold text-foreground leading-tight truncate">{p.childName}</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 shrink-0">
                {typeLabel(p.diabetesType)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
              <span>{p.dateOfBirth ? `${formatDate(p.dateOfBirth)}${age ? ` · ${age}` : ""}` : "DOB not set"}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">ID {snapshot.accessCode}</span>
              {p.caregiverPhone && (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {p.caregiverPhone}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {parentNames.length > 0 && (
          <div className="min-w-0 lg:border-l lg:border-border/60 lg:pl-6">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">
              {selfManaged ? "Guardians" : "Parents"}
            </p>
            <p className="text-sm mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {parentNames.map((name, i) => (
                <span key={name} className="inline-flex items-center">
                  <CaregiverName name={name} interactive={false} />
                  {i < parentNames.length - 1 && <span className="text-muted-foreground">,</span>}
                </span>
              ))}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 ml-auto">
          <Stat label="Last CGM" value={m.latest ? stamp(m.latest.timestamp) : "—"} />
          <Stat
            label="Last insulin"
            value={m.lastInsulin ? `${m.lastInsulin.units}u · ${stamp(m.lastInsulin.timestamp)}` : "—"}
          />
          <Stat label="Last meal" value={m.lastMeal ? stamp(m.lastMeal.timestamp) : "—"} />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full ${m.stale ? "bg-amber-500" : "bg-success"}`} />
            <span className="whitespace-nowrap">
              {m.latest && m.minutesSinceLatest != null ? `Updated ${formatAge(m.minutesSinceLatest)}` : "No CGM data"}
            </span>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh patient data"
              aria-label="Refresh patient data"
              className="rounded-md p-1 hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {m.stale && m.latest && m.minutesSinceLatest != null ? (
        <p className="mt-2.5 rounded-lg border px-3 py-2 text-xs flex items-center gap-2 bg-amber-500/10 text-amber-600 border-amber-500/30">
          <Clock className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">Data may be outdated</span> — last CGM reading {formatAge(m.minutesSinceLatest)} (
            {formatTime(m.latest.timestamp)}), so it may not reflect current glucose.
          </span>
        </p>
      ) : urgent && meta ? (
        <p className={`mt-2.5 rounded-lg border px-3 py-2 text-xs flex items-center gap-2 ${meta.chip}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">{meta.label}</span> — glucose is {m.latest?.value} mg/dL, trend{" "}
            {(TREND_LABEL[m.latest?.trend ?? "Flat"] ?? "Flat").toLowerCase()}.
          </span>
        </p>
      ) : null}

      {source === "server" && (
        <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          The patient's app hasn't synced with the portal yet, so this chart is built from their server
          records. Messages and treatment changes reach them once the app syncs.
        </p>
      )}
      {/* Without the server-side log, meals & insulin only reach the portal when the app syncs;
          make staleness explicit so an old entry is never mistaken for current activity. */}
      {source !== "server" && !logsFromServer && syncMins != null && syncMins > 180 && (
        <p className="mt-2 text-xs text-amber-600/90 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Meals &amp; insulin last synced from the app {formatAge(syncMins)} — newer entries in the app
          won't appear until it syncs again. (Glucose updates continuously.)
        </p>
      )}
    </div>
  );
}
