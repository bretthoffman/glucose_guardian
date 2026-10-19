import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard,
  LineChart,
  Syringe,
  SlidersHorizontal,
  MessageSquare,
  Bell,
  LogOut,
  Lock,
  ChevronsUpDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  HelpCircle,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PatientAvatar } from "@/components/PatientAvatar";
import { PatientHeader } from "@/components/PatientHeader";
import { ProductTour, TOUR_EVENT, type TourStep } from "@/components/ProductTour";
import { computeMetrics, STATUS_META, formatAge } from "@/lib/glucose-metrics";
import { OverviewPanel } from "@/components/panels/OverviewPanel";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { InsulinPanel } from "@/components/panels/InsulinPanel";
import { TherapyOrdersPanel } from "@/components/panels/TherapyOrdersPanel";
import { MessagesPanel } from "@/components/panels/MessagesPanel";
import { NotificationsPanel } from "@/components/panels/NotificationsPanel";
import { DoctorProfileDialog } from "@/components/DoctorProfileDialog";
import { DoctorAlertsBell } from "@/components/DoctorAlertsBell";
import { ThemeToggle } from "@/lib/theme";
import { AssistantWidget } from "@/components/AssistantWidget";
import { CaregiverTitlesProvider } from "@/components/CaregiverName";
import { CareCircleSidebar } from "@/components/CareCircleSidebar";
import { BrandLogo } from "@/components/BrandLogo";
import { useSession } from "@/auth/use-session";
import { useCurrentDoctor } from "@/auth/use-current-doctor";
import {
  DEFAULT_HISTORY_DAYS,
  usePatientDetail,
  usePatientGlucoseHistory,
  withGlucoseHistory,
} from "@/data/doctor-data";
import { isDecisionUnseen, markDecisionSeen } from "@/data/notifications";

// `inNav: false` tabs are still valid routes (reached from Overview cards) but hidden from the
// sidebar — the three lookalike pages collapse into one Overview home. Flip these back to true
// to restore them in the nav.
const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, inNav: true },
  { id: "chart", label: "CGM / A1C Trends", icon: LineChart, inNav: false },
  { id: "insulin", label: "Insulin Log", icon: Syringe, inNav: false },
  { id: "orders", label: "Treatment Settings", icon: SlidersHorizontal, inNav: true },
  { id: "messages", label: "Messages", icon: MessageSquare, inNav: true },
  { id: "notifications", label: "Notifications", icon: Bell, inNav: true },
];
const DRILL_DOWN = ["chart", "insulin"];

const TOUR_STEPS: TourStep[] = [
  {
    tab: "overview",
    selector: '[data-tour="patient"]',
    title: "Your patient at a glance",
    body: "Name, type, and their latest glucose live here — always visible, on every screen.",
  },
  {
    tab: "overview",
    selector: '[data-tour="customize"]',
    title: "Make the Overview yours",
    body: "Show or hide any card. Uncheck what you don't need and the rest reflow — or Clear all and add just what you want.",
  },
  {
    tab: "overview",
    selector: '[data-tour="drilldown"]',
    title: "Cards open deeper tools",
    body: "Many cards link to a full view — like “Full trends” here. Let's open the ones tucked behind these links.",
  },
  {
    tab: "chart",
    selector: '[data-tour="range"]',
    title: "CGM / A1C Trends",
    body: "Opened from the CGM card. Filter from 3 days to a year to see whether control is improving or slipping.",
  },
  {
    tab: "chart",
    selector: '[data-tour="insights"]',
    title: "Plain-language insights",
    body: "A quick read on what's driving the A1C and where to look next.",
  },
  {
    tab: "insulin",
    selector: '[data-tour="calendar"]',
    title: "Daily Review — pick any day",
    body: "Reached from the Food Log (“Daily review”) and Insulin (“View all”) cards. Step with the arrows, drag the strip, or click the date for a calendar.",
  },
  {
    tab: "insulin",
    selector: '[data-tour="meals"]',
    title: "Meals, insulin & response",
    body: "Each meal shows its carbs, the insulin given, and the glucose before and after — so you can see what worked.",
  },
  {
    tab: "insulin",
    selector: '[data-tour="actions"]',
    title: "Act on what you see",
    body: "Add a clinical note, message the caregiver, or propose a treatment change right from the review.",
  },
  {
    tab: "orders",
    selector: '[data-tour="treatment"]',
    title: "Treatment Settings",
    body: "Propose carb-ratio and correction changes — they take effect only after the caregiver confirms in the app.",
  },
  {
    tab: "messages",
    selector: '[data-tour="messages-input"]',
    title: "Message the caregiver",
    body: "Chat directly with the patient's guardian here.",
  },
  {
    tab: "overview",
    selector: '[data-tour="nav"]',
    title: "Getting around",
    body: "Overview is home. Treatment Settings and Messages are in the nav; the deep CGM and insulin views open from their cards.",
  },
  {
    tab: "overview",
    selector: '[data-tour="switch"]',
    title: "Switch patients anytime",
    body: "Jump back to your full patient list whenever you need to.",
  },
];

function typeLabel(t?: string): string {
  return t === "type1" ? "Type 1" : t === "type2" ? "Type 2" : "Other";
}

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

export function PatientDetail({ accessCode, tab }: { accessCode: string; tab: string }) {
  const [, setLocation] = useLocation();
  const { signOut, lock, canLock } = useSession();
  const access = useCurrentDoctor();
  const doctor = access.status === "active" ? access.doctor : undefined;
  const { data: detail, isLoading, isFetching, refetch } = usePatientDetail(accessCode);
  // The multi-day views (Charts, Daily Review) get the full CGM history; everything else keeps
  // the live snapshot so its "24h" figures stay 24 hours.
  const [historyDays, setHistoryDays] = useState(DEFAULT_HISTORY_DAYS);
  const history = usePatientGlucoseHistory(accessCode, historyDays);
  const historySnapshot = useMemo(
    () => (detail ? withGlucoseHistory(detail.snapshot, history.readings) : undefined),
    [detail, history.readings],
  );
  const needHistoryDays = useCallback(
    (days: number) => setHistoryDays((cur) => Math.max(cur, days)),
    [],
  );
  const navigateTab = useCallback(
    (t: string) => setLocation(`/patient/${accessCode}/${t}`),
    [setLocation, accessCode],
  );
  const current = TABS.some((t) => t.id === tab) ? tab : "overview";

  // Badge the Notifications tab when the caregiver's latest decision hasn't been opened yet.
  const decision = detail?.lastDecision;
  const accessCodeVal = detail?.accessCode;
  const [decisionSeenBump, setDecisionSeenBump] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const notificationUnseen = useMemo(
    () =>
      decision && accessCodeVal && doctor?.id
        ? isDecisionUnseen(doctor.id, accessCodeVal, decision)
        : false,
    // decisionSeenBump forces a re-read of localStorage after we mark the decision seen.
    [decision, accessCodeVal, doctor?.id, decisionSeenBump],
  );
  useEffect(() => {
    if (current === "notifications" && decision && accessCodeVal && doctor?.id) {
      markDecisionSeen(doctor.id, accessCodeVal, decision);
      setDecisionSeenBump((n) => n + 1);
    }
  }, [current, decision, accessCodeVal, doctor?.id]);

  if (isLoading) return <LoadingScreen message="Loading patient…" />;
  if (!detail) return <NotLinked accessCode={accessCode} onBack={() => setLocation("/")} />;

  const name = detail.snapshot.profile.childName;
  const gm = computeMetrics(detail.snapshot);
  const gstatus = gm.status ? STATUS_META[gm.status] : null;

  return (
    <CaregiverTitlesProvider accessCode={detail.accessCode}>
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="w-64 bg-card border-r border-border flex flex-col shrink-0">
        <div className="p-4 flex items-center gap-2.5 border-b border-border/60">
          <BrandLogo className="w-10 h-10" />
          <div className="leading-tight">
            <p className="font-display font-bold text-foreground">Glucose Guardian</p>
            <p className="text-[11px] text-muted-foreground">Diabetes Care Portal</p>
          </div>
        </div>

        <div className="p-3 border-b border-border/60" data-tour="patient">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
            Patient
          </p>
          <button
            onClick={() => setLocation("/")}
            title="Switch patient"
            className="w-full flex items-center gap-2.5 p-2 rounded-xl border border-border hover:bg-secondary/50 transition-colors text-left"
          >
            <PatientAvatar
              name={name}
              photoDataUri={detail.snapshot.profile.photoDataUri}
              className="w-8 h-8 text-xs"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{name}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {typeLabel(detail.snapshot.profile.diabetesType)} · {detail.accessCode}
              </p>
            </div>
            <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>

          <div
            className={`mt-2 rounded-xl border px-3 py-2 ${
              gm.latest && !gm.stale && gstatus ? gstatus.chip : "border-border bg-secondary/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {gm.stale ? "Last Glucose" : "Current Glucose"}
              </p>
              {gm.latest && gm.minutesSinceLatest != null && (
                <span className="text-[10px] text-muted-foreground">
                  {formatAge(gm.minutesSinceLatest)}
                </span>
              )}
            </div>
            {gm.latest ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`text-xl font-display font-bold ${
                    gm.stale ? "text-muted-foreground" : (gstatus?.text ?? "text-foreground")
                  }`}
                >
                  {gm.latest.value}
                </span>
                <span className="text-[11px] text-muted-foreground">mg/dL</span>
                <span className={`ml-auto ${gm.stale ? "text-muted-foreground" : gstatus?.text}`}>
                  <TrendArrow trend={gm.latest.trend} className="w-4 h-4" />
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">No CGM data</p>
            )}
          </div>

          <button
            data-tour="switch"
            onClick={() => setLocation("/")}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <ArrowLeftRight className="w-4 h-4" /> Switch Patient
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
        <nav className="p-3 space-y-1" data-tour="nav">
          {TABS.filter((t) => t.inNav).map((item) => {
            const Icon = item.icon;
            const isActive =
              current === item.id || (item.id === "overview" && DRILL_DOWN.includes(current));
            return (
              <button
                key={item.id}
                onClick={() => setLocation(`/patient/${detail.accessCode}/${item.id}`)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
                }`}
              >
                <Icon className={`w-[18px] h-[18px] ${isActive ? "text-primary" : "opacity-70"}`} />
                {item.label}
                {item.id === "notifications" && notificationUnseen && (
                  <span
                    className="ml-auto w-2 h-2 rounded-full bg-red-500"
                    title="New caregiver decision"
                  />
                )}
              </button>
            );
          })}
        </nav>
        <CareCircleSidebar accessCode={detail.accessCode} />
        </div>

        <div className="p-3 border-t border-border space-y-1">
          {doctor && (
            <div className="flex items-center gap-2.5 px-2 py-2">
              <PatientAvatar
                name={doctor.displayName}
                photoDataUri={doctor.photoDataUri}
                className="w-8 h-8 text-xs"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{doctor.displayName}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {doctor.specialty || doctor.email}
                </p>
              </div>
              <ThemeToggle className="p-1.5 shrink-0" />
              <DoctorAlertsBell />
              <button
                onClick={() => setProfileOpen(true)}
                title="Edit your profile"
                aria-label="Edit your profile"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <HelpCircle className="w-[18px] h-[18px] opacity-70" /> Take a Tour
          </button>
          {canLock && (
            <button
              onClick={lock}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Lock className="w-[18px] h-[18px] opacity-70" /> Lock
            </button>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-[18px] h-[18px] opacity-70" /> Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-[1600px] mx-auto p-5 lg:p-6 space-y-5">
          {DRILL_DOWN.includes(current) && (
            <button
              onClick={() => setLocation(`/patient/${detail.accessCode}/overview`)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Overview
            </button>
          )}
          <PatientHeader
            snapshot={detail.snapshot}
            onRefresh={refetch}
            refreshing={isFetching}
            logsFromServer={detail.logsFromServer}
            source={detail.source}
          />
          <div key={current} className="animate-fade-in">
            {current === "overview" && (
              <OverviewPanel data={detail.snapshot} accessCode={detail.accessCode} detail={detail} />
            )}
            {current === "chart" && (
              <ChartPanel
                data={historySnapshot ?? detail.snapshot}
                historyLoading={history.isLoading}
                onNeedHistoryDays={needHistoryDays}
              />
            )}
            {current === "insulin" && (
              <InsulinPanel data={historySnapshot ?? detail.snapshot} accessCode={detail.accessCode} />
            )}
            {current === "orders" && <TherapyOrdersPanel detail={detail} />}
            {current === "messages" && (
              <MessagesPanel accessCode={detail.accessCode} patientName={name} />
            )}
            {current === "notifications" && (
              <NotificationsPanel detail={detail} patientName={name} />
            )}
          </div>
        </div>
      </main>
      <ProductTour steps={TOUR_STEPS} enabled={current === "overview"} onNavigate={navigateTab} />
      <DoctorProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <AssistantWidget accessCode={detail.accessCode} patientName={name} />
    </div>
    </CaregiverTitlesProvider>
  );
}

function NotLinked({ accessCode, onBack }: { accessCode: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center bg-card border border-border rounded-2xl p-8 shadow-xl">
        <BrandLogo className="w-16 h-16 mx-auto mb-6" />
        <h2 className="text-xl font-bold text-foreground mb-2">Patient not found</h2>
        <p className="text-muted-foreground text-sm mb-6">
          No linked patient matches access code{" "}
          <span className="font-mono text-foreground">{accessCode}</span>. It may not be linked to
          your account.
        </p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to patients
        </Button>
      </div>
    </div>
  );
}
