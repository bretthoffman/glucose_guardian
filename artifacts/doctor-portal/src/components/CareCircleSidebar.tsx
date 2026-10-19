import { MessageSquare, Smartphone } from "lucide-react";
import { useLocation } from "wouter";
import { useCareCircle, type CareCircleMember } from "@/data/doctor-data";
import { CaregiverName } from "@/components/CaregiverName";
import { formatAge } from "@/lib/glucose-metrics";

function roleLine(m: CareCircleMember): string {
  switch (m.kind) {
    case "owner":
      return "Account owner";
    case "patient":
      return "Patient · own account";
    case "co_guardian":
      return "Co-guardian";
    case "patient_device":
      return "Patient's own phone";
    default: {
      const active =
        m.lastUsedAt != null
          ? ` · active ${formatAge(Math.max(0, Math.round((Date.now() - m.lastUsedAt) / 60_000)))}`
          : "";
      return `Access code${active}`;
    }
  }
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/**
 * The patient's Care Circle in the sidebar: everyone currently in it (from the app), with the
 * doctor's own title for each (click a name to set it) and a shortcut to message the ones this
 * doctor can reach — parents via the guardian thread, school nurses via their doctor chat.
 */
export function CareCircleSidebar({ accessCode }: { accessCode: string }) {
  const members = useCareCircle(accessCode);
  const [, setLocation] = useLocation();
  if (members === null) {
    // The backend update that serves the roster isn't deployed yet — say so instead of hiding.
    return (
      <div className="px-3 pb-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 mt-2 mb-1">Care Circle</p>
        <p className="text-[11px] text-muted-foreground px-1 leading-snug">
          Shows everyone in the patient's circle once the latest backend update is deployed.
        </p>
      </div>
    );
  }
  if (!members.length) return null;

  const message = (m: CareCircleMember) =>
    setLocation(
      `/patient/${accessCode}/messages?to=${m.messaging === "nurse" ? encodeURIComponent(m.id.slice("code:".length)) : "parents"}`,
    );

  return (
    <div className="px-3 pb-3" data-tour="care-circle">
      <div className="flex items-center justify-between px-1 mt-2 mb-1.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Care Circle</p>
        <span className="text-[10px] text-muted-foreground">{members.length}</span>
      </div>
      <div className="space-y-0.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-start gap-2 px-1.5 py-1.5 rounded-xl hover:bg-secondary/40">
            <span className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0 mt-0.5">
              {m.kind === "patient_device" ? <Smartphone className="w-3.5 h-3.5" /> : initials(m.name)}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              {m.kind === "patient_device" ? (
                <span className="font-medium text-foreground">{m.name}</span>
              ) : (
                <CaregiverName name={m.name} />
              )}
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{roleLine(m)}</p>
              {m.accounts.map((a) => (
                <p key={a.name} className="text-[11px] text-muted-foreground leading-tight mt-0.5 flex flex-wrap items-center gap-x-1">
                  <span>Signed in as</span>
                  <CaregiverName name={a.name} />
                  {a.organization && <span>· {a.organization}</span>}
                </p>
              ))}
            </div>
            {m.messaging && (
              <button
                type="button"
                onClick={() => message(m)}
                title={m.messaging === "nurse" ? `Message ${m.name}` : "Message the parents"}
                aria-label={m.messaging === "nurse" ? `Message ${m.name}` : "Message the parents"}
                className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground px-1 mt-2 leading-snug">
        Click a name to note who they are — it saves for you. You can message parents and school
        nurses.
      </p>
    </div>
  );
}
