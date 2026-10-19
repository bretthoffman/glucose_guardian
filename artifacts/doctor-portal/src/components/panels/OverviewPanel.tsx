import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowDownRight,
  Calculator,
  Clock,
  SlidersHorizontal,
  Settings2,
  Sparkles,
  Syringe,
  Utensils,
  Camera,
  MessageSquare,
  Stethoscope,
  User,
  LayoutGrid,
} from "lucide-react";
import type { FoodLogEntry, PatientSnapshot } from "@doctor-portal/api-client-react";
import { formatDate, formatTime, getGlucoseColor } from "@/lib/utils";
import { readLabA1c } from "@/data/doctor-data";
import type { PatientDetail } from "@/data/contracts";
import { MealDetailModal } from "@/components/MealResponsePanel";
import { buildDayReview, localDayKey } from "@/lib/day-review";
import { mealHasViewablePhoto } from "@/lib/meal-photo";
import { DoseCalculationCard } from "@/components/DoseCalculationCard";
import { CaregiverName } from "@/components/CaregiverName";
import {
  computeMetrics,
  detectPatterns,
  formatAge,
  isToday,
  STATUS_META,
  glucoseStatus,
  TREND_LABEL,
} from "@/lib/glucose-metrics";
import { GlucoseChart } from "@/components/GlucoseChart";

// ── Customizable widget registry ─────────────────────────────────────────────
const STORAGE_KEY = "gg_overview_widgets";

type WidgetGroup = "kpi" | "chart" | "wide" | "module";
interface WidgetDef {
  id: string;
  label: string;
  group: WidgetGroup;
}

const WIDGETS: WidgetDef[] = [
  { id: "current", label: "Current Glucose", group: "kpi" },
  { id: "a1c", label: "Estimated A1C / GMI", group: "kpi" },
  { id: "tir", label: "Time in Range", group: "kpi" },
  { id: "insulinToday", label: "Insulin Today", group: "kpi" },
  { id: "tar", label: "Time Above Range", group: "kpi" },
  { id: "cgm", label: "CGM Chart", group: "chart" },
  { id: "dose", label: "Dose Calculation", group: "wide" },
  { id: "ratios", label: "Ratios & Factors", group: "module" },
  { id: "patterns", label: "Detected Patterns", group: "module" },
  { id: "readings", label: "Recent Readings", group: "module" },
  { id: "food", label: "Food Log", group: "module" },
  { id: "insulinLog", label: "Insulin Log (Today)", group: "module" },
  { id: "messages", label: "Recent Messages", group: "module" },
];

function allOn(): Record<string, boolean> {
  return Object.fromEntries(WIDGETS.map((w) => [w.id, true]));
}

function loadVisible(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...allOn(), ...saved };
  } catch {
    return allOn();
  }
}

function TrendIcon({ trend, className = "w-4 h-4" }: { trend: string; className?: string }) {
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

function Ring({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const tone = pct >= 70 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="shrink-0">
      <circle cx="23" cy="23" r={r} fill="none" stroke="var(--color-border)" strokeWidth="5" />
      <circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
        transform="rotate(-90 23 23)"
      />
    </svg>
  );
}

function Kpi({
  label,
  children,
  foot,
  right,
}: {
  label: string;
  children: ReactNode;
  foot?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 h-full">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">{children}</div>
        {right}
      </div>
      {foot && <div className="text-xs text-muted-foreground mt-1.5">{foot}</div>}
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function QuickStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-display font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export function OverviewPanel({
  data,
  accessCode,
  detail,
}: {
  data: PatientSnapshot;
  accessCode: string;
  /** Proposal state for the dose card's "Suggest a change". */
  detail?: PatientDetail;
}) {
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState<Record<string, boolean>>(loadVisible);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!customizeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setCustomizeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [customizeOpen]);

  const persist = (next: Record<string, boolean>) => {
    setVisible(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const toggle = (id: string) => persist({ ...visible, [id]: !visible[id] });
  const resetAll = () => persist(allOn());
  const clearAll = () => persist(Object.fromEntries(WIDGETS.map((w) => [w.id, false])));

  const m = computeMetrics(data);
  const z = m.zones;
  const p = data.profile;
  const patterns = detectPatterns(data);
  const status = m.status ? STATUS_META[m.status] : null;
  const a1cNum = m.a1c ? Number(m.a1c) : null;
  const labA1c = readLabA1c(data);
  const [mealDetail, setMealDetail] = useState<FoodLogEntry | null>(null);
  // The same meal pop-out as the Daily Review, built from that meal's day.
  const mealReview = useMemo(
    () => (mealDetail ? buildDayReview(data, localDayKey(new Date(mealDetail.timestamp))) : null),
    [mealDetail, data],
  );
  const mealForDetail = mealReview?.meals.find((m) => m.id === mealDetail?.id) ?? null;
  const go = (tab: string) => setLocation(`/patient/${accessCode}/${tab}`);
  const editLink = (
    <button onClick={() => go("orders")} className="text-xs text-primary hover:underline">
      Edit
    </button>
  );
  const fullView = (tab: string, label = "Full view", tourId?: string) => (
    <button
      data-tour={tourId}
      onClick={() => go(tab)}
      className="text-xs text-primary hover:underline flex items-center gap-1"
    >
      {label} <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );

  const messages = data.messages ?? [];
  const recentReadings = [...m.readingsAsc].reverse().slice(0, 6);
  const todayInsulin = (data.insulinLog ?? [])
    .filter((l) => isToday(l.timestamp))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const meals = [...(data.foodLog ?? [])].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  function renderWidget(id: string): ReactNode {
    switch (id) {
      case "current":
        return (
          <Kpi
            label="Current Glucose"
            foot={
              !m.latest ? (
                "No data"
              ) : m.stale && m.minutesSinceLatest != null ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <Clock className="w-3.5 h-3.5" />
                  {formatAge(m.minutesSinceLatest)} · may be outdated
                </span>
              ) : status ? (
                <span className={`flex items-center gap-1 ${status.text}`}>
                  <TrendIcon trend={m.latest.trend} className="w-3.5 h-3.5" />
                  {TREND_LABEL[m.latest.trend] ?? "Flat"} · {status.label}
                </span>
              ) : undefined
            }
          >
            <span
              className={`text-3xl font-display font-bold ${
                m.stale ? "text-muted-foreground" : (status?.text ?? "text-foreground")
              }`}
            >
              {m.latest?.value ?? "--"}
            </span>
            <span className="text-sm text-muted-foreground ml-1">mg/dL</span>
          </Kpi>
        );
      case "a1c":
        return (
          <Kpi
            label="Estimated A1C / GMI"
            foot={
              labA1c
                ? `Lab ${labA1c.value}% (${formatDate(labA1c.measuredAt)}) · Goal < 7.0%`
                : "Goal: < 7.0%"
            }
            right={
              a1cNum != null ? (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    a1cNum > 7 ? STATUS_META.high.chip : STATUS_META.target.chip
                  }`}
                >
                  {a1cNum > 7 ? "High" : "On target"}
                </span>
              ) : undefined
            }
          >
            <span className="text-3xl font-display font-bold text-foreground">
              {m.a1c ? `${m.a1c}%` : "--"}
            </span>
          </Kpi>
        );
      case "tir":
        return (
          <Kpi label="Time in Range (24h)" foot="Goal: > 70%" right={<Ring pct={m.tir} />}>
            <span className="text-3xl font-display font-bold text-foreground">{m.tir}%</span>
          </Kpi>
        );
      case "insulinToday":
        return (
          <Kpi label="Insulin Today" foot="Total dose">
            <span className="text-3xl font-display font-bold text-foreground">
              {m.insulinToday.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground ml-1">u</span>
          </Kpi>
        );
      case "tar":
        return (
          <Kpi label="Time Above Range" foot="Goal: < 25%">
            <span
              className={`text-3xl font-display font-bold ${
                m.tar > 25 ? "text-destructive" : "text-foreground"
              }`}
            >
              {m.tar}%
            </span>
          </Kpi>
        );
      case "cgm":
        return (
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-foreground">Continuous Glucose Monitor</h3>
              {fullView("chart", "Full trends", "drilldown")}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-5">
              <QuickStat label="Average" value={m.average != null ? `${m.average}` : "--"} />
              <QuickStat label="Highest" value={m.highest != null ? `${m.highest}` : "--"} accent="text-warning" />
              <QuickStat label="Lowest" value={m.lowest != null ? `${m.lowest}` : "--"} accent="text-orange-600 dark:text-orange-500" />
              <QuickStat
                label="Variability"
                value={m.variability}
                accent={m.variability === "High" ? "text-warning" : "text-foreground"}
              />
              <QuickStat label="Sensor Usage" value={m.sensorUsage != null ? `${m.sensorUsage}%` : "--"} />
            </div>
            <GlucoseChart readings={m.readingsAsc} zones={z} height={300} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 text-xs text-muted-foreground">
              <Legend hex={STATUS_META.target.hex} label={`Target ${z.low}–${z.high}`} />
              <Legend hex={STATUS_META.high.hex} label={`High ${z.high}–${z.urgentHigh}`} />
              <Legend hex={STATUS_META.urgentHigh.hex} label={`Urgent >${z.urgentHigh}`} />
              <Legend hex={STATUS_META.low.hex} label={`Low <${z.low}`} />
            </div>
          </div>
        );
      case "dose":
        return (
          <SectionCard title="Dose Calculation" icon={Calculator} action={editLink}>
            <DoseCalculationCard snapshot={data} detail={detail} />
          </SectionCard>
        );
      case "ratios":
        return (
          <SectionCard title="Ratios & Factors" icon={SlidersHorizontal} action={editLink}>
            <div className="space-y-2.5 text-sm">
              <KeyVal label="Carb Ratio" value={`1u : ${p.carbRatio ?? "--"}g`} />
              <KeyVal label="Correction Factor" value={`1u : ${p.correctionFactor ?? "--"} mg/dL`} />
              <KeyVal label="Target Glucose" value={`${p.targetGlucose ?? "--"} mg/dL`} />
            </div>
          </SectionCard>
        );
      case "patterns":
        return (
          <SectionCard title="Detected Patterns" icon={Sparkles}>
            <ul className="space-y-2.5">
              {patterns.map((pat) => (
                <li key={pat} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  {pat}
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      case "readings":
        return (
          <SectionCard title="Recent Readings" icon={Stethoscope} action={fullView("chart", "View all")}>
            {recentReadings.length ? (
              <div className="space-y-1">
                {recentReadings.map((r, i) => {
                  const meta = STATUS_META[glucoseStatus(r.value, z)];
                  return (
                    <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-muted-foreground">{formatTime(r.timestamp)}</span>
                      <span className={`flex items-center gap-1 ${meta.text}`}>
                        <TrendIcon trend={r.trend} className="w-3.5 h-3.5" />
                      </span>
                      <span
                        className={`font-medium px-2 py-0.5 rounded-full text-xs ${getGlucoseColor(r.value)}`}
                      >
                        {r.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No readings yet.</p>
            )}
          </SectionCard>
        );
      case "food":
        return (
          <SectionCard title="Food Log" icon={Utensils} action={fullView("insulin", "Daily review")}>
            {meals.length ? (
              <div className="space-y-3">
                {meals.slice(0, 4).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setMealDetail(f)}
                    title="View meal details"
                    className="w-full flex items-center justify-between gap-3 text-sm text-left rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate flex items-center gap-1.5">
                        {f.foodName}
                        {mealHasViewablePhoto(f) ? (
                          <span title="Has a photo — open to view" className="inline-flex shrink-0">
                            <Camera className="w-3 h-3 text-primary" />
                          </span>
                        ) : (
                          f.fromPhoto && <Camera className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0">
                        <span className="whitespace-nowrap">{formatTime(f.timestamp)}</span>
                        {f.authorName && (
                          <>
                            <span className="whitespace-nowrap">· by</span>
                            {/* Inside the row button, so plain text; titles are set elsewhere. */}
                            <CaregiverName name={f.authorName} interactive={false} />
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-foreground font-medium shrink-0">{f.estimatedCarbs}g</span>
                  </button>
                ))}
                {meals.length > 4 && (
                  <button
                    onClick={() => go("insulin")}
                    className="w-full text-left text-xs text-primary hover:underline px-1.5"
                  >
                    +{meals.length - 4} more — open Daily Review
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No meals logged.</p>
            )}
          </SectionCard>
        );
      case "insulinLog":
        return (
          <SectionCard title="Insulin Log (Today)" icon={Syringe} action={fullView("insulin", "View all")}>
            {todayInsulin.length ? (
              <div className="space-y-2.5">
                {todayInsulin.slice(0, 4).map((l) => (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-primary">{l.units}u</span>
                      <span className="text-muted-foreground ml-2 capitalize">{l.type}</span>
                      {l.authorName && (
                        <span className="block text-[11px] text-muted-foreground">
                          by <CaregiverName name={l.authorName} />
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{formatTime(l.timestamp)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No insulin logged today.</p>
            )}
          </SectionCard>
        );
      case "messages":
        return (
          <SectionCard title="Recent Messages" icon={MessageSquare} action={fullView("messages", "View all")}>
            {messages.length ? (
              <div className="space-y-3">
                {messages.slice(-3).map((msg) => (
                  <div key={msg.id} className="flex items-start gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        msg.sender === "doctor" ? "bg-primary" : "bg-secondary border border-border"
                      }`}
                    >
                      {msg.sender === "doctor" ? (
                        <Stethoscope className="w-3.5 h-3.5 text-primary-foreground" />
                      ) : (
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground line-clamp-2">{msg.text}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {msg.sender === "doctor" ? "You" : "Caregiver"} · {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No messages yet.</p>
            )}
          </SectionCard>
        );
      default:
        return null;
    }
  }

  const kpis = WIDGETS.filter((w) => w.group === "kpi" && visible[w.id]);
  const modules = WIDGETS.filter((w) => w.group === "module" && visible[w.id]);
  const showChart = !!visible["cgm"];
  // Full-width sections (the dose formula reads left to right, so it can't sit in a column).
  const wides = WIDGETS.filter((w) => w.group === "wide" && visible[w.id]);
  const nothingVisible = kpis.length === 0 && modules.length === 0 && wides.length === 0 && !showChart;

  return (
    <div className="space-y-5">
      {/* Customize toolbar */}
      <div className="flex items-center justify-end">
        <div className="relative" ref={customizeRef}>
          <button
            data-tour="customize"
            onClick={() => setCustomizeOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <Settings2 className="w-4 h-4" /> Customize
          </button>
          {customizeOpen && (
            <div className="absolute right-0 top-full mt-2 z-30 w-64 bg-card border border-border rounded-xl shadow-2xl p-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Show on overview
                </p>
                <div className="flex items-center gap-3">
                  <button onClick={clearAll} className="text-xs text-primary hover:underline">
                    Clear all
                  </button>
                  <button onClick={resetAll} className="text-xs text-destructive hover:underline">
                    Reset
                  </button>
                </div>
              </div>
              <div className="space-y-0.5 max-h-80 overflow-y-auto">
                {WIDGETS.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-secondary cursor-pointer text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={!!visible[w.id]}
                      onChange={() => toggle(w.id)}
                      className="accent-primary w-4 h-4"
                    />
                    {w.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {nothingVisible ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-2xl">
          <LayoutGrid className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p className="text-sm">Nothing to show. Use Customize to add cards back.</p>
        </div>
      ) : (
        <>
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
              {kpis.map((w) => (
                <div key={w.id}>{renderWidget(w.id)}</div>
              ))}
            </div>
          )}

          {showChart && renderWidget("cgm")}

          {wides.map((w) => (
            <div key={w.id}>{renderWidget(w.id)}</div>
          ))}

          {modules.length > 0 && (
            <div className="columns-1 md:columns-2 xl:columns-3 gap-5">
              {modules.map((w) => (
                <div key={w.id} className="break-inside-avoid mb-5">
                  {renderWidget(w.id)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <MealDetailModal
        meal={mealForDetail}
        food={mealDetail ?? undefined}
        snapshot={data}
        review={mealReview}
        onClose={() => setMealDetail(null)}
      />
    </div>
  );
}

function Legend({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: hex }} />
      {label}
    </span>
  );
}

function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
