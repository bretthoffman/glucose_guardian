import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { DoctorLinkedPatient, PatientSnapshot } from "@doctor-portal/api-client-react";
import { usePatientSnapshot } from "@/data/doctor-data";
import { computeMetrics, formatAge } from "@/lib/glucose-metrics";
import { hasPendingProposal, isDecisionUnseen, readDecision } from "@/data/notifications";

interface AttentionIssue {
  sev: "critical" | "warn" | "info";
  label: string;
}

const SEV_STYLE: Record<AttentionIssue["sev"], string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  info: "border-primary/40 bg-primary/10 text-primary",
};

function issuesFor(
  snapshot: PatientSnapshot | undefined,
  doctorId: string | undefined,
  code: string,
): AttentionIssue[] {
  if (!snapshot) return [];
  const m = computeMetrics(snapshot);
  const name = snapshot.profile?.childName ?? code;
  const out: AttentionIssue[] = [];
  if (m.latest && !m.stale) {
    if (m.status === "urgentLow") {
      out.push({ sev: "critical", label: `${name}: urgent low ${m.latest.value}` });
    } else if (m.status === "urgentHigh") {
      out.push({ sev: "critical", label: `${name}: urgent high ${m.latest.value}` });
    }
  }
  if (m.minutesSinceLatest != null && m.minutesSinceLatest > 12 * 60) {
    out.push({ sev: "warn", label: `${name}: no data ${formatAge(m.minutesSinceLatest)}` });
  }
  if (hasPendingProposal(snapshot)) {
    out.push({ sev: "info", label: `${name}: change awaiting caregiver` });
  }
  const d = readDecision(snapshot);
  if (d && isDecisionUnseen(doctorId, code, d)) {
    out.push({ sev: "info", label: `${name}: change ${d.status}` });
  }
  return out;
}

/**
 * Invisible per-patient probe: subscribes to the same snapshot query the patient card uses
 * (deduped by react-query) and reports this patient's attention issues up to the strip.
 */
function Probe({
  entry,
  doctorId,
  onReport,
}: {
  entry: DoctorLinkedPatient;
  doctorId?: string;
  onReport: (code: string, issues: AttentionIssue[]) => void;
}) {
  const { snapshot } = usePatientSnapshot(entry.accessCode);
  useEffect(() => {
    onReport(entry.accessCode, issuesFor(snapshot, doctorId, entry.accessCode));
  }, [snapshot, doctorId, entry.accessCode, onReport]);
  return null;
}

/**
 * Cross-patient triage strip for the patient list: urgent lows/highs, stale sensors, pending
 * proposals, and unseen caregiver decisions as clickable chips. Renders nothing when all clear.
 */
export function AttentionStrip({
  patients,
  doctorId,
  onOpen,
}: {
  patients: DoctorLinkedPatient[];
  doctorId?: string;
  onOpen: (accessCode: string) => void;
}) {
  const [issues, setIssues] = useState<Record<string, AttentionIssue[]>>({});
  const report = useCallback((code: string, list: AttentionIssue[]) => {
    setIssues((prev) => {
      const cur = prev[code] ?? [];
      const same =
        cur.length === list.length &&
        cur.every((c, i) => c.label === list[i].label && c.sev === list[i].sev);
      return same ? prev : { ...prev, [code]: list };
    });
  }, []);

  const all = patients.flatMap((p) =>
    (issues[p.accessCode] ?? []).map((i) => ({ ...i, code: p.accessCode })),
  );

  return (
    <>
      {patients.map((p) => (
        <Probe key={p.accessCode} entry={p} doctorId={doctorId} onReport={report} />
      ))}
      {all.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2.5">
            <AlertTriangle className="w-4 h-4 text-warning" /> Attention needed
          </p>
          <div className="flex flex-wrap gap-2">
            {all.map((i, idx) => (
              <button
                key={`${i.code}-${idx}`}
                onClick={() => onOpen(i.code)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-opacity hover:opacity-80 ${SEV_STYLE[i.sev]}`}
              >
                {i.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
