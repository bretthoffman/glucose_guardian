import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Download,
  Utensils,
  Syringe,
  Sunrise,
  Sun,
  Sunset,
  Cookie,
  Camera,
  TrendingUp,
  TrendingDown,
  Minus,
  Bell,
  SlidersHorizontal,
  Sparkles,
  AlertTriangle,
  MessageSquare,
  StickyNote,
  Plus,
  Target,
  Clock,
  Droplet,
  Gauge,
  CircleDot,
  Users,
} from "lucide-react";
import type { PatientSnapshot } from "@doctor-portal/api-client-react";
import { STATUS_META, glucoseStatus } from "@/lib/glucose-metrics";
import { MealDetailModal } from "@/components/MealResponsePanel";
import {
  buildDayReview,
  buildDayChips,
  shiftDayKey,
  dayKeyBounds,
  dataDayKeySet,
  localDayKey,
  defaultDayKey,
  SLOT_LABEL,
  type DayEvent,
  type DayMeal,
  type DayReview,
  type DoseType,
  type MealSlot,
} from "@/lib/day-review";
import { DayTimelineChart } from "@/components/DayTimelineChart";
import { CaregiverName, WhoLogged, useCaregiverLabel } from "@/components/CaregiverName";
import { caregiverKey } from "@/data/caregivers";
import { BEFORE_WINDOW_MIN, describeOffset, formatSpan, type EventReading } from "@/lib/meal-glucose";

const RANGES = [
  { id: 3, label: "3H" },
  { id: 6, label: "6H" },
  { id: 12, label: "12H" },
  { id: 24, label: "24H" },
];

const SLOT_META: Record<MealSlot, { Icon: typeof Sun; color: string; ring: string }> = {
  breakfast: { Icon: Sunrise, color: "text-amber-600 dark:text-amber-400", ring: "border-amber-400/30 bg-amber-400/10" },
  lunch: { Icon: Sun, color: "text-orange-600 dark:text-orange-400", ring: "border-orange-400/30 bg-orange-400/10" },
  dinner: { Icon: Sunset, color: "text-rose-600 dark:text-rose-400", ring: "border-rose-400/30 bg-rose-400/10" },
  snack: { Icon: Cookie, color: "text-purple-600 dark:text-purple-400", ring: "border-purple-400/30 bg-purple-400/10" },
};

const DOSE_BADGE: Record<DoseType, { label: string; cls: string }> = {
  bolus: { label: "Bolus", cls: "bg-primary/15 text-primary border-primary/30" },
  correction: { label: "Correction", cls: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30" },
  basal: { label: "Basal", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  manual: { label: "Manual", cls: "bg-secondary text-muted-foreground border-border" },
};

function clock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ratioText(value?: number): string {
  return value != null ? `1:${value}` : "—";
}

const minKey = (...keys: string[]) => keys.reduce((a, b) => (a < b ? a : b));
const maxKey = (...keys: string[]) => keys.reduce((a, b) => (a > b ? a : b));

function startOfMonthDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function exportDayCsv(review: DayReview, patientName: string, who: (name: string) => string) {
  const head = [
    "Time",
    "Event",
    "Carbs(g)",
    "Before (mg/dL)",
    "Before time",
    "2h after (mg/dL)",
    "2h after time",
    "Minutes after",
    "Insulin(u)",
    "CR",
    "CF",
    "Type",
    "Meal logged by",
    "Insulin logged by",
    "Notes",
  ];
  const quote = (v: string) => `"${v.replace(/"/g, "''")}"`;
  const rows = review.events.map((e) => [
    clock(e.timestamp),
    e.label,
    e.carbs ?? "",
    e.before?.value ?? "",
    e.before ? clock(e.before.timestamp) : "",
    e.after?.value ?? "",
    e.after ? clock(e.after.timestamp) : "",
    e.after?.offsetMin ?? "",
    e.units ?? "",
    e.kind === "meal" ? ratioText(review.ratios.carbRatio) : "—",
    ratioText(review.ratios.correctionFactor),
    e.doseType ?? "",
    e.mealBy ? quote(who(e.mealBy)) : "",
    e.doseBy ? quote(who(e.doseBy)) : "",
    quote(e.note),
  ]);
  const csv = [head, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${patientName.replace(/\s+/g, "-")}-${review.key}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Small building blocks ───────────────────────────────────────────────────

function StatCard({
  label,
  icon: Icon,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  icon: typeof Sun;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-2xl font-display font-bold ${accent ?? "text-foreground"}`}>
        {value}
        {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function RailCard({
  title,
  icon: Icon,
  badge,
  children,
}: {
  title: string;
  icon: typeof Sun;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </h3>
        {badge}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DirectionIcon({ d }: { d: DayMeal["direction"] }) {
  if (d === "up") return <TrendingUp className="w-3.5 h-3.5 text-warning" />;
  if (d === "down") return <TrendingDown className="w-3.5 h-3.5 text-orange-600 dark:text-orange-500" />;
  if (d === "stable") return <Minus className="w-3.5 h-3.5 text-success" />;
  return null;
}

function Glucose({ value, zones }: { value: number | null; zones: DayReview["zones"] }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={STATUS_META[glucoseStatus(value, zones)].text}>{value}</span>;
}

/** "7:25 AM · 5 min before" — when a before/after reading was taken, relative to the event. */
function readingWhen(r: EventReading): string {
  return `${clock(r.timestamp)} · ${describeOffset(r.offsetMin)}`;
}

/**
 * Before-meal and 2-hours-after readings, each with the time it was taken and how far from the
 * meal — so a doctor never has to guess what "post" means. `showAfter` is off for plain doses.
 */
function BeforeAfter({
  before,
  after,
  zones,
  showAfter = true,
}: {
  before: EventReading | null;
  after: EventReading | null;
  zones: DayReview["zones"];
  showAfter?: boolean;
}) {
  const delta = before && after ? after.value - before.value : null;
  return (
    <div className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="text-muted-foreground">Before</span>
      <span className="font-medium">
        <Glucose value={before?.value ?? null} zones={zones} />
      </span>
      <span className="text-[11px] text-muted-foreground">
        {before ? readingWhen(before) : `no reading in the ${BEFORE_WINDOW_MIN} min before`}
      </span>
      {showAfter && (
        <>
          <span className="text-muted-foreground whitespace-nowrap">2 h after</span>
          <span className="font-medium whitespace-nowrap">
            <Glucose value={after?.value ?? null} zones={zones} />
            {delta != null && (
              <span
                className={`ml-1 text-[10px] ${delta > 0 ? "text-warning" : delta < 0 ? "text-success" : "text-muted-foreground"}`}
              >
                {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                {Math.abs(delta)}
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {after ? readingWhen(after) : "no reading near the 2 h mark"}
          </span>
        </>
      )}
    </div>
  );
}

// ─── Meal card ───────────────────────────────────────────────────────────────

function MealCard({
  meal,
  review,
  onDetail,
}: {
  meal: DayMeal;
  review: DayReview;
  onDetail?: () => void;
}) {
  const meta = SLOT_META[meal.slot];
  const badge = meal.doseType ? DOSE_BADGE[meal.doseType] : null;
  return (
    <div className="relative pl-9">
      <span
        className={`absolute left-0 top-1 w-7 h-7 rounded-full border flex items-center justify-center ${meta.ring}`}
      >
        <meta.Icon className={`w-4 h-4 ${meta.color}`} />
      </span>
      <div className="bg-secondary/30 border border-border rounded-xl hover:border-primary/40 hover:bg-secondary/50 transition-colors">
      <button
        onClick={onDetail}
        title="View meal details, photo, and glucose response"
        className="w-full text-left p-3 pb-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${meta.color}`}>{SLOT_LABEL[meal.slot]}</span>
              <span className="text-xs text-muted-foreground">{clock(meal.timestamp)}</span>
              {meal.hasPhoto ? (
                <span title="Has a photo — open to view" className="inline-flex">
                  <Camera className="w-3.5 h-3.5 text-primary" />
                </span>
              ) : (
                meal.fromPhoto && <Camera className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </div>
            <p className="text-sm text-foreground mt-0.5 line-clamp-2">{meal.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{meal.carbs}g carbs</p>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center justify-end gap-1.5">
              {meal.units != null ? (
                <>
                  <span className="font-display font-bold text-primary">{meal.units}u</span>
                  {badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
                      {badge.label}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">No insulin</span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              CR {ratioText(review.ratios.carbRatio)} · CF {ratioText(review.ratios.correctionFactor)}
            </p>
            <p className="mt-1 flex justify-end">
              <DirectionIcon d={meal.direction} />
            </p>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-border/50">
          <BeforeAfter before={meal.before} after={meal.after} zones={review.zones} />
        </div>
      </button>
      {/* Outside the card button: the names open the caregiver-title picker. */}
      <WhoLogged mealBy={meal.mealBy} doseBy={meal.doseBy} className="px-3 pb-2.5" />
      </div>
    </div>
  );
}

// ─── Care Circle (who logged this day) ───────────────────────────────────────

/** Everyone who logged meals or insulin on the selected day, with what they logged. */
function CareCircleCard({ review }: { review: DayReview }) {
  const { people, unattributed } = useMemo(() => {
    const byKey = new Map<string, { name: string; meals: number; doses: number; units: number }>();
    const person = (name: string) => {
      const key = caregiverKey(name);
      let p = byKey.get(key);
      if (!p) {
        p = { name, meals: 0, doses: 0, units: 0 };
        byKey.set(key, p);
      }
      return p;
    };
    let unattributed = 0;
    for (const m of review.meals) {
      if (m.mealBy) person(m.mealBy).meals++;
      else unattributed++;
      if (m.units != null) {
        if (m.doseBy) {
          const p = person(m.doseBy);
          p.doses++;
          p.units += m.units;
        } else unattributed++;
      }
    }
    for (const e of review.events) {
      if (e.kind === "meal" || e.units == null) continue;
      if (!e.doseBy) {
        unattributed++;
        continue;
      }
      const p = person(e.doseBy);
      p.doses++;
      p.units += e.units;
    }
    const people = [...byKey.values()].sort((a, b) => b.meals + b.doses - (a.meals + a.doses));
    return { people, unattributed };
  }, [review]);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <RailCard title="Care Circle" icon={Users}>
      {people.length ? (
        <div className="space-y-2.5">
          {people.map((p) => (
            <div key={caregiverKey(p.name)} className="flex items-start justify-between gap-2 text-sm">
              <CaregiverName name={p.name} />
              <span className="text-xs text-muted-foreground text-right shrink-0">
                {[
                  p.meals ? plural(p.meals, "meal") : null,
                  p.doses ? `${plural(p.doses, "dose")} · ${Math.round(p.units * 10) / 10}u` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ))}
          {unattributed > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {unattributed === 1 ? "1 entry" : `${unattributed} entries`} without a name (logged
              before Care Circle).
            </p>
          )}
          <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-2">
            Who logged meals and insulin this day. Click a name to note who they are — only you
            see titles.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {review.meals.length || review.events.length
            ? "These entries don’t carry a caregiver name."
            : "Nothing logged this day."}
        </p>
      )}
    </RailCard>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function InsulinPanel({ data, accessCode }: { data: PatientSnapshot; accessCode: string }) {
  const [, setLocation] = useLocation();
  const bounds = useMemo(() => dayKeyBounds(data), [data]);
  const dataKeys = useMemo(() => dataDayKeySet(data), [data]);
  const todayKey = localDayKey(new Date());

  const [selectedKey, setSelectedKey] = useState(() => defaultDayKey(data));
  // The meal whose detail pop-out is open (from a meal card or an Event Log row).
  const [selectedMealId, setSelectedMealId] = useState<string | null>(null);
  useEffect(() => setSelectedMealId(null), [selectedKey]);
  const [winStart, setWinStart] = useState(() => {
    const sel = defaultDayKey(data);
    const end = maxKey(bounds.latest, todayKey, sel);
    return minKey(bounds.earliest, shiftDayKey(end, -13), sel);
  });
  const [winEnd, setWinEnd] = useState(() => maxKey(bounds.latest, todayKey, defaultDayKey(data)));
  const [windowHours, setWindowHours] = useState(24);
  const caregiverLabel = useCaregiverLabel();
  const [notesByDay, setNotesByDay] = useState<Record<string, string[]>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => startOfMonthDate(selectedKey));

  const stripRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  // Older history streams in after the first render — widen the strip back to the earliest day,
  // holding the visible chips in place (measured from the right) so the strip doesn't jump to the
  // oldest day and sweep back.
  const keepFromRight = useRef<number | null>(null);
  useEffect(() => {
    if (bounds.earliest >= winStart) return;
    const el = stripRef.current;
    keepFromRight.current = el ? el.scrollWidth - el.scrollLeft : null;
    setWinStart(bounds.earliest);
  }, [bounds.earliest, winStart]);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (el && keepFromRight.current != null) el.scrollLeft = el.scrollWidth - keepFromRight.current;
    keepFromRight.current = null;
  }, [winStart]);

  const chips = useMemo(() => buildDayChips(data, winStart, winEnd), [data, winStart, winEnd]);
  const review = useMemo(() => buildDayReview(data, selectedKey), [data, selectedKey]);
  const selectedMeal = selectedMealId
    ? review.meals.find((m) => m.id === selectedMealId)
    : undefined;
  const s = review.summary;
  const notes = notesByDay[selectedKey] ?? [];

  const ensureWindow = (key: string) => {
    setWinStart((cur) => (key < cur ? key : cur));
    setWinEnd((cur) => (key > cur ? key : cur));
  };
  const selectKey = (key: string) => {
    setSelectedKey(key);
    ensureWindow(key);
    setPickerOpen(false);
  };
  const stepDay = (delta: number) => selectKey(shiftDayKey(selectedKey, delta));

  // Keep the selected chip scrolled into view as the day changes.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-daykey="${selectedKey}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedKey, winStart, winEnd]);

  // Close the date picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = stripRef.current;
    if (!el) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active || !stripRef.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    stripRef.current.scrollLeft = drag.current.startScroll - dx;
  };
  const endDrag = () => {
    drag.current.active = false;
  };

  const dayLabel = review.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const shortLabel = review.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const weekdayLong = review.date.toLocaleDateString(undefined, { weekday: "long" });

  const domain = useMemo<[number, number]>(() => {
    if (windowHours >= 24) return [review.dayStartMs, review.dayEndMs];
    const lastTs = review.readings.length
      ? new Date(review.readings[review.readings.length - 1].timestamp).getTime()
      : review.dayEndMs;
    const win = windowHours * 3600_000;
    const end = Math.min(review.dayEndMs, Math.max(review.dayStartMs + win, lastTs));
    return [end - win, end];
  }, [windowHours, review]);

  const go = (tab: string) => setLocation(`/patient/${accessCode}/${tab}`);
  const openComposer = () => {
    setComposerOpen(true);
    setTimeout(() => document.getElementById("clinical-note-input")?.focus(), 0);
  };
  const openPicker = () => {
    setPickerMonth(startOfMonthDate(selectedKey));
    setPickerOpen((o) => !o);
  };
  const saveNote = () => {
    if (!draft.trim()) return;
    setNotesByDay((prev) => ({ ...prev, [selectedKey]: [...(prev[selectedKey] ?? []), draft.trim()] }));
    setDraft("");
    setComposerOpen(false);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
      {/* ── MAIN ────────────────────────────────────────────────── */}
      <div className="space-y-5 min-w-0">
        {/* Calendar strip */}
        <div data-tour="calendar" className="bg-card border border-border rounded-2xl p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative shrink-0" ref={dateRef}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => stepDay(-1)}
                  aria-label="Previous day"
                  className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={openPicker}
                  className="text-center min-w-[132px] rounded-lg px-2 py-1 hover:bg-secondary transition-colors"
                >
                  <p className="text-sm font-medium text-foreground flex items-center justify-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    {shortLabel}, {review.date.getFullYear()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{weekdayLong}</p>
                </button>
                <button
                  onClick={() => stepDay(1)}
                  aria-label="Next day"
                  className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              {pickerOpen && (
                <MiniCalendar
                  month={pickerMonth}
                  onMonth={setPickerMonth}
                  value={selectedKey}
                  dataKeys={dataKeys}
                  onPick={selectKey}
                />
              )}
            </div>

            <div
              ref={stripRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              className="flex items-center gap-2 flex-1 overflow-x-auto min-w-0 cursor-grab active:cursor-grabbing select-none"
            >
              {chips.map((c) => {
                const active = c.key === selectedKey;
                return (
                  <button
                    key={c.key}
                    data-daykey={c.key}
                    onClick={() => {
                      if (drag.current.moved) {
                        drag.current.moved = false;
                        return;
                      }
                      selectKey(c.key);
                    }}
                    className={`shrink-0 w-[88px] rounded-xl border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : c.hasData
                          ? "border-border hover:border-primary/40"
                          : "border-border/60 opacity-60 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">{c.weekday}</span>
                      <span className="flex items-center gap-1">
                        {c.meals > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success" />}
                        {c.insulin > 0 && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                        {c.hasHigh && <span className="w-1.5 h-1.5 rounded-full bg-destructive" />}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{c.label}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-0.5">
                        <Utensils className="w-3 h-3" />
                        {c.meals}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Syringe className="w-3 h-3" />
                        {c.insulin}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1 shrink-0 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> Meals
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Insulin
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> High
              </span>
            </div>

            <button
              onClick={() => exportDayCsv(review, data.profile.childName, caregiverLabel)}
              className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-secondary transition-colors"
            >
              <Download className="w-4 h-4" /> Export Day
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Total Carbs"
            icon={Utensils}
            value={`${s.totalCarbs}`}
            unit="g"
            sub={`${review.meals.length} meal${review.meals.length === 1 ? "" : "s"} logged`}
          />
          <StatCard
            label="Total Insulin"
            icon={Syringe}
            value={s.totalInsulin.toFixed(1)}
            unit="u"
            sub={`Bolus ${s.bolus.toFixed(1)} · Corr ${s.correction.toFixed(1)}`}
          />
          <StatCard label="Bolus Count" icon={Droplet} value={`${s.bolusCount}`} sub="Meals + snacks" />
          <StatCard
            label="Correction Count"
            icon={CircleDot}
            value={`${s.correctionCount}`}
            sub="Correction doses"
          />
          <StatCard
            label="Time in Range"
            icon={Target}
            value={s.tir != null ? `${s.tir}` : "—"}
            unit={s.tir != null ? "%" : undefined}
            sub="Target: >70%"
            accent={
              s.tir == null
                ? "text-muted-foreground"
                : s.tir >= 70
                  ? "text-success"
                  : s.tir >= 50
                    ? "text-warning"
                    : "text-destructive"
            }
          />
          <StatCard
            label="Average Glucose"
            icon={Gauge}
            value={s.avg != null ? `${s.avg}` : "—"}
            unit={s.avg != null ? "mg/dL" : undefined}
            sub={s.gmi ? `GMI: ${s.gmi}%` : "No readings"}
          />
          <StatCard
            label="Last Meal"
            icon={Clock}
            value={s.lastMeal ? clock(s.lastMeal.timestamp) : "—"}
            sub={s.lastMeal ? `${s.lastMeal.carbs}g carbs` : "No meals logged"}
          />
          <StatCard
            label="Data Completeness"
            icon={Gauge}
            value={`${s.completeness}`}
            unit="%"
            sub={`${s.readingCount} readings`}
            accent={s.completeness >= 70 ? "text-foreground" : "text-warning"}
          />
        </div>

        {/* Meal review | chart + event log */}
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
          {/* Daily Meal & Insulin Review */}
          <div data-tour="meals" className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60">
              <h3 className="font-medium text-foreground flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" /> Daily Meal &amp; Insulin Review
              </h3>
            </div>
            <div className="p-4">
              {review.meals.length ? (
                <div className="space-y-3">
                  {review.meals.map((m) => (
                    <MealCard
                      key={m.id}
                      meal={m}
                      review={review}
                      onDetail={() => setSelectedMealId(m.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-muted-foreground border-2 border-dashed border-border rounded-xl">
                  No meals logged for this day.
                </div>
              )}

              {/* Notes */}
              <div className="mt-4 pt-4 border-t border-border/60">
                {notes.length > 0 ? (
                  <div className="space-y-2 mb-3">
                    {notes.map((n, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <StickyNote className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                        <span>{n}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">No caregiver notes for this day.</p>
                )}
                {composerOpen ? (
                  <div className="space-y-2">
                    <textarea
                      id="clinical-note-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      placeholder="Add a clinical note for this day…"
                      className="w-full text-sm bg-secondary/50 border border-border rounded-lg p-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveNote}
                        disabled={!draft.trim()}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                      >
                        Save note
                      </button>
                      <button
                        onClick={() => {
                          setComposerOpen(false);
                          setDraft("");
                        }}
                        className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Saved to this review session. A shared notes endpoint is pending on the backend.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={openComposer}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Note for Today
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Chart + event log (clicking a meal opens its detail in a pop-out) */}
          <div className="space-y-5 min-w-0">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="font-medium text-foreground">Glucose &amp; Insulin Timeline</h3>
                <div className="flex items-center gap-1 bg-secondary/50 border border-border rounded-xl p-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setWindowHours(r.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        windowHours === r.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
                <Legend color="var(--color-primary)" label="CGM (mg/dL)" line />
                <Legend color={STATUS_META.target.hex} label={`Target ${review.zones.low}–${review.zones.high}`} />
                <Legend color="var(--color-primary)" label="Insulin" />
                <Legend color="#A855F7" label="Correction" />
                <Legend color={STATUS_META.target.hex} label="Meal" />
              </div>
              <DayTimelineChart
                readings={review.readings}
                markers={review.markers}
                zones={review.zones}
                domain={domain}
                height={320}
              />
            </div>

            {/* Event log */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border/60">
                <h3 className="font-medium text-foreground">Event Log — {dayLabel}</h3>
              </div>
              {review.events.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-secondary/40">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Time</th>
                        <th className="px-4 py-2.5 font-medium">Event</th>
                        <th className="px-4 py-2.5 font-medium">Carbs</th>
                        <th className="px-4 py-2.5 font-medium">Before / 2 h after</th>
                        <th className="px-4 py-2.5 font-medium">Insulin</th>
                        <th className="px-4 py-2.5 font-medium">CR | CF</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Logged by</th>
                        <th className="px-4 py-2.5 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.events.map((e) => (
                        <EventRow
                          key={e.id}
                          e={e}
                          review={review}
                          onOpen={e.kind === "meal" ? () => setSelectedMealId(e.id.slice("meal-".length)) : undefined}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-10 text-center">
                  No meals, insulin, or corrections logged for this day.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── RAIL ────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <RailCard title="Ratios Used Today" icon={SlidersHorizontal}>
          <div className="space-y-2.5 text-sm">
            <KeyVal
              label="Carb Ratio (CR)"
              value={review.ratios.carbRatio != null ? `1 unit : ${review.ratios.carbRatio}g` : "—"}
            />
            <KeyVal
              label="Correction Factor (CF)"
              value={
                review.ratios.correctionFactor != null
                  ? `1 unit : ${review.ratios.correctionFactor} mg/dL`
                  : "—"
              }
            />
            <KeyVal
              label="Target Glucose"
              value={
                review.ratios.targetGlucose != null
                  ? `${review.ratios.targetGlucose} mg/dL`
                  : `${review.ratios.targetLow}–${review.ratios.targetHigh} mg/dL`
              }
            />
            <KeyVal label="Active Insulin Time" value="—" />
          </div>
        </RailCard>

        <CareCircleCard review={review} />

        <RailCard
          title="Clinical Flags"
          icon={Bell}
          badge={
            review.flags.length > 0 ? (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30">
                {review.flags.length}
              </span>
            ) : undefined
          }
        >
          {review.flags.length ? (
            <div className="space-y-3">
              {review.flags.map((f) => {
                const tone =
                  f.severity === "high"
                    ? "text-destructive"
                    : f.severity === "warning"
                      ? "text-warning"
                      : "text-primary";
                return (
                  <div key={f.id} className="flex items-start gap-2.5">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${tone}`}>{f.title}</p>
                      <p className="text-xs text-muted-foreground">{f.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No clinical flags for this day.</p>
          )}
        </RailCard>

        <RailCard title="Daily Patterns" icon={Sparkles}>
          {review.patterns.length ? (
            <div className="space-y-3">
              {review.patterns.map((p) => {
                const tone =
                  p.tone === "good"
                    ? "text-success"
                    : p.tone === "warn"
                      ? "text-warning"
                      : "text-primary";
                return (
                  <div key={p.id} className="flex items-start gap-2.5">
                    <Sparkles className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${tone}`}>{p.title}</p>
                      <p className="text-xs text-muted-foreground">{p.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No notable patterns detected.</p>
          )}
        </RailCard>

        <div className="space-y-2" data-tour="actions">
          <button
            onClick={openComposer}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <StickyNote className="w-4 h-4" /> Add Clinical Note
          </button>
          <button
            onClick={() => go("messages")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <MessageSquare className="w-4 h-4" /> Message Caregiver
          </button>
          <button
            onClick={() => go("orders")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border text-sm text-foreground hover:bg-secondary transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" /> Propose Treatment Change
          </button>
        </div>
      </div>

      <MealDetailModal
        meal={selectedMeal ?? null}
        food={selectedMeal ? (data.foodLog ?? []).find((f) => f.id === selectedMeal.id) : undefined}
        snapshot={data}
        review={review}
        onClose={() => setSelectedMealId(null)}
      />
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="rounded-sm"
        style={{ backgroundColor: color, width: line ? 14 : 10, height: line ? 3 : 10 }}
      />
      {label}
    </span>
  );
}

function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

function EventRow({ e, review, onOpen }: { e: DayEvent; review: DayReview; onOpen?: () => void }) {
  const badge = e.doseType ? DOSE_BADGE[e.doseType] : null;
  const EventIcon = e.kind === "correction" ? Syringe : e.kind === "insulin" ? Syringe : Utensils;
  return (
    <tr
      onClick={onOpen}
      title={onOpen ? "View meal details" : undefined}
      className={`border-t border-border/50 hover:bg-secondary/20 transition-colors ${onOpen ? "cursor-pointer" : ""}`}
    >
      <td className="px-4 py-2.5 whitespace-nowrap text-foreground">{clock(e.timestamp)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="flex items-center gap-1.5 text-foreground">
          <EventIcon className="w-3.5 h-3.5 text-muted-foreground" />
          {e.label}
        </span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{e.carbs != null ? e.carbs : "–"}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-xs">
        <div>
          <Glucose value={e.before?.value ?? null} zones={review.zones} />
          {e.before && (
            <span className="text-[11px] text-muted-foreground ml-1.5">
              {clock(e.before.timestamp)}
            </span>
          )}
        </div>
        {e.kind !== "insulin" && (
          <div>
            <Glucose value={e.after?.value ?? null} zones={review.zones} />
            {e.after && (
              <span className="text-[11px] text-muted-foreground ml-1.5">
                {clock(e.after.timestamp)} ({formatSpan(e.after.offsetMin)} after)
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 text-foreground">
        {e.units != null ? (
          <div className="min-w-0">
            <span className="text-foreground">{e.units}u</span>
            {e.manualOverride && e.recommendedUnits != null && (
              <span
                className="ml-1.5 text-[10px] text-amber-600"
                title={`Recommended ${e.recommendedUnits}u — caregiver adjusted the dose`}
              >
                (rec {e.recommendedUnits}u)
              </span>
            )}
            {e.insulinType && (
              <span className="block text-[11px] text-muted-foreground truncate max-w-[130px]">
                {e.insulinType}
              </span>
            )}
          </div>
        ) : (
          "–"
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
        {e.kind === "meal" ? ratioText(review.ratios.carbRatio) : "–"} |{" "}
        {ratioText(review.ratios.correctionFactor)}
      </td>
      <td className="px-4 py-2.5">
        {badge ? (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
            {badge.label}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {e.mealBy || e.doseBy ? (
          <div className="space-y-0.5">
            {e.mealBy && <CaregiverName name={e.mealBy} />}
            {e.doseBy && (!e.mealBy || caregiverKey(e.doseBy) !== caregiverKey(e.mealBy)) && (
              <div className="flex items-center gap-1">
                {e.mealBy && <Syringe className="w-3 h-3 text-muted-foreground shrink-0" />}
                <CaregiverName name={e.doseBy} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{e.note || "–"}</td>
    </tr>
  );
}

function MiniCalendar({
  month,
  onMonth,
  value,
  dataKeys,
  onPick,
}: {
  month: Date;
  onMonth: (d: Date) => void;
  value: string;
  dataKeys: Set<string>;
  onPick: (key: string) => void;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="absolute top-full left-0 mt-2 z-30 w-64 bg-card border border-border rounded-xl shadow-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(new Date(y, m - 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-foreground">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(new Date(y, m + 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdays.map((d) => (
          <span key={d} className="text-[10px] text-center text-muted-foreground">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d == null) return <span key={i} />;
          const key = localDayKey(new Date(y, m, d));
          const selected = key === value;
          const hasData = dataKeys.has(key);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(key)}
              className={`relative h-8 rounded-lg text-sm flex items-center justify-center transition-colors ${
                selected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-foreground hover:bg-secondary"
              }`}
            >
              {d}
              {hasData && !selected && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
