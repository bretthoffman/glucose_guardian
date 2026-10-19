import { useState } from "react";
import { useLocation } from "wouter";
import {
  LogOut,
  ChevronRight,
  Building2,
  Lock,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Trash2,
  Settings,
} from "lucide-react";
import { useSession } from "@/auth/use-session";
import { useIsDemo } from "@/auth/mock-session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/utils";
import { computeMetrics, formatAge, STATUS_META, type GlucoseStatus } from "@/lib/glucose-metrics";
import { PatientAvatar } from "@/components/PatientAvatar";
import { useCurrentDoctor } from "@/auth/use-current-doctor";
import {
  useDoctorPatients,
  useLinkPatient,
  useUnlinkPatient,
  usePatientSnapshot,
} from "@/data/doctor-data";
import { readDecision, isDecisionUnseen } from "@/data/notifications";
import { DoctorProfileDialog } from "@/components/DoctorProfileDialog";
import { DoctorAlertsBell } from "@/components/DoctorAlertsBell";
import { ThemeToggle } from "@/lib/theme";
import { AttentionStrip } from "@/components/AttentionStrip";
import { BrandLogo } from "@/components/BrandLogo";
import type { DoctorLinkedPatient } from "@doctor-portal/api-client-react";

function diabetesLabel(t?: string): string | undefined {
  if (t === "type1") return "Type 1";
  if (t === "type2") return "Type 2";
  return t ? "Other" : undefined;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

const ACCENT: Record<GlucoseStatus, string> = {
  urgentHigh: "border-l-destructive",
  urgentLow: "border-l-destructive",
  high: "border-l-warning",
  low: "border-l-orange-500",
  target: "border-l-success",
};

// Triage priority — most urgent floats to the top via CSS order.
const ORDER: Record<GlucoseStatus, number> = {
  urgentHigh: 0,
  urgentLow: 0,
  high: 1,
  low: 1,
  target: 2,
};

function TrendArrow({ trend, className = "w-4 h-4" }: { trend: string; className?: string }) {
  switch (trend) {
    case "DoubleUp":
    case "SingleUp":
      return <ArrowUp className={className} />;
    case "FortyFiveUp":
      return <ArrowUpRight className={className} />;
    case "FortyFiveDown":
      return <ArrowDownRight className={className} />;
    case "SingleDown":
    case "DoubleDown":
      return <ArrowDown className={className} />;
    default:
      return <ArrowRight className={className} />;
  }
}

function PatientCard({
  entry,
  doctorId,
  onOpen,
  onRemove,
}: {
  entry: DoctorLinkedPatient;
  doctorId?: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { snapshot, isLoading, error } = usePatientSnapshot(entry.accessCode);
  const m = snapshot ? computeMetrics(snapshot) : null;
  const profile = snapshot?.profile;
  const decision = readDecision(snapshot);
  const hasUpdate = !!decision && isDecisionUnseen(doctorId, entry.accessCode, decision);
  const name = profile?.childName ?? entry.displayName ?? entry.accessCode;
  const dtype = diabetesLabel(profile?.diabetesType);
  const status = m?.status ?? null;
  const stale = m?.stale ?? false;
  const meta = status ? STATUS_META[status] : null;
  const showStatus = !!meta && !stale;
  const order = !m || !m.latest ? (isLoading ? 5 : 4) : stale ? 3 : ORDER[status!];
  const accent = m?.latest && !stale ? ACCENT[status!] : "border-l-border";

  return (
    <div
      style={{ order }}
      className={`bg-card border border-border border-l-4 ${accent} rounded-2xl flex items-center hover:border-primary/40 transition-colors`}
    >
      <button onClick={onOpen} className="flex items-center gap-4 flex-1 min-w-0 p-4 text-left">
        <PatientAvatar name={name} photoDataUri={profile?.photoDataUri} className="w-11 h-11" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">{name}</span>
            {dtype && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                {dtype}
              </span>
            )}
            <span className="text-xs font-mono text-muted-foreground">{entry.accessCode}</span>
            {showStatus && meta && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${meta.chip}`}>
                {meta.label}
              </span>
            )}
            {stale && (
              <span
                title="The CGM hasn't reported recently — the value shown is the last known reading, not current glucose."
                className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-600 border-amber-500/30"
              >
                No recent data
              </span>
            )}
            {hasUpdate && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                New update
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isLoading
              ? "Loading…"
              : error
                ? "Couldn't load — your session may have expired"
                : m?.latest
                  ? `Last reading ${formatTime(m.latest.timestamp)}`
                  : "Pending sync — no data yet"}
            {m?.a1c && ` · A1C ~${m.a1c}%`}
            {m && m.count > 0 && ` · TIR ${m.tir}%`}
          </p>
        </div>

        {m?.latest ? (
          <div className="text-right shrink-0">
            <div
              className={`flex items-center justify-end gap-1 ${stale ? "text-muted-foreground" : meta?.text}`}
            >
              <TrendArrow trend={m.latest.trend} className="w-4 h-4" />
              <span className="text-2xl font-display font-bold">{m.latest.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {stale && m.minutesSinceLatest != null ? formatAge(m.minutesSinceLatest) : "mg/dL"}
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground shrink-0">No data</span>
        )}
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </button>
      <button
        onClick={onRemove}
        title="Remove from your list"
        aria-label={`Remove ${name} from your list`}
        className="p-2 mr-3 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function PatientList() {
  const [, setLocation] = useLocation();
  const { signOut, lock, canLock } = useSession();
  const demo = useIsDemo();
  const access = useCurrentDoctor();
  const doctor = access.status === "active" ? access.doctor : undefined;
  const org = access.status === "active" ? access.organization : undefined;

  const { data: patients, refetch } = useDoctorPatients();
  const { mutate: linkPatient, isPending } = useLinkPatient();
  const { mutate: unlinkPatient, isPending: isUnlinking } = useUnlinkPatient();
  const [code, setCode] = useState("");
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<DoctorLinkedPatient | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const visible = patients.filter(
    (p) => (p.displayName ?? "").toLowerCase().includes(q) || p.accessCode.toLowerCase().includes(q),
  );

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkMsg(null);
    try {
      const linked = await linkPatient(code.trim().toUpperCase());
      refetch();
      setLinkMsg(`Linked ${linked.displayName ?? linked.accessCode} — now in your list below.`);
      setCode("");
    } catch (err) {
      setLinkMsg(err instanceof Error ? err.message : "Could not link patient.");
    }
  }

  async function handleRemove() {
    if (!removing) return;
    const p = removing;
    try {
      await unlinkPatient(p.accessCode);
      setRemoving(null);
      refetch();
      setLinkMsg(
        `Removed ${p.displayName ?? p.accessCode} from your list. Re-link anytime with code ${p.accessCode}.`,
      );
    } catch (err) {
      setRemoving(null);
      setLinkMsg(err instanceof Error ? err.message : "Could not remove patient.");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="w-10 h-10" />
            <div>
              <p className="font-display font-bold text-foreground leading-tight">Glucose Guardian</p>
              {org && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {org.name}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <DoctorAlertsBell />
            </div>
            {doctor && (
              <button
                onClick={() => setProfileOpen(true)}
                title="Edit your profile"
                className="flex items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-secondary transition-colors"
              >
                <PatientAvatar
                  name={doctor.displayName}
                  photoDataUri={doctor.photoDataUri}
                  className="w-8 h-8 text-xs"
                />
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {doctor.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doctor.specialty || doctor.email}
                  </p>
                </div>
                <Settings className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            )}
            {canLock && (
              <Button variant="ghost" size="sm" onClick={lock}>
                <Lock className="w-4 h-4 mr-2" /> Lock
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <section>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Your patients</h1>
          <p className="text-muted-foreground text-sm">
            {patients.length === 0
              ? "Link a patient with the Doctor Code from their Glucose Guardian app."
              : `${patients.length} linked patient${patients.length === 1 ? "" : "s"} · sorted by urgency.`}
          </p>
        </section>

        <AttentionStrip
          patients={patients}
          doctorId={doctor?.id}
          onOpen={(code) => setLocation(`/patient/${code}/overview`)}
        />

        {demo ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              These sample patients are already linked. In the real portal, you add a patient by entering
              the Doctor Code their family shares from the Glucose Guardian app.
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardContent className="p-5">
            <form onSubmit={handleLink} className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Link a patient by Doctor Code
                </label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 7ZD36Z"
                  className="uppercase tracking-widest"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={!code.trim() || isPending}>
                {isPending ? "Linking…" : "Link patient"}
              </Button>
            </form>
            {linkMsg && <p className="text-sm text-muted-foreground mt-3">{linkMsg}</p>}
          </CardContent>
        </Card>
        )}

        {patients.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients by name…"
              className="pl-9"
            />
          </div>
        )}

        <section className="flex flex-col gap-3">
          {patients.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
              No linked patients yet. Enter a Doctor Code above to add one.
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No patients match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            visible.map((entry) => (
              <PatientCard
                key={entry.accessCode}
                entry={entry}
                doctorId={doctor?.id}
                onOpen={() => setLocation(`/patient/${entry.accessCode}/overview`)}
                onRemove={() => setRemoving(entry)}
              />
            ))
          )}
        </section>
      </main>

      {removing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => !isUnlinking && setRemoving(null)}
        >
          <div
            className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Trash2 className="w-5 h-5 text-destructive" />
            </div>
            <h2 className="text-lg font-display font-bold text-foreground">
              Remove {removing.displayName ?? removing.accessCode} from your list?
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              This removes the patient from your portal only. Their account and data stay in Glucose
              Guardian — you can re-link anytime with their Doctor Code{" "}
              <span className="font-mono text-foreground">{removing.accessCode}</span>.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setRemoving(null)} disabled={isUnlinking}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRemove} disabled={isUnlinking}>
                {isUnlinking ? "Removing…" : "Remove patient"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <DoctorProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}
