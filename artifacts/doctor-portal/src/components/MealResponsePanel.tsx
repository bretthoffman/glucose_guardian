import { useMemo } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Camera, Minus, Utensils } from "lucide-react";
import type { FoodLogEntry, PatientSnapshot } from "@doctor-portal/api-client-react";
import { SLOT_LABEL, type DayMeal, type DayReview } from "@/lib/day-review";
import { glucoseStatus, STATUS_META } from "@/lib/glucose-metrics";
import { useGlucoseHistory, useMealPhoto } from "@/data/doctor-data";
import { syncedPhotoThumb } from "@/lib/meal-photo";
import { DayTimelineChart } from "@/components/DayTimelineChart";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AFTER_MARK_MIN,
  AFTER_TOLERANCE_MIN,
  BEFORE_WINDOW_MIN,
  describeOffset,
  readingAfter,
  readingBefore,
  readingNearMark,
  type EventReading,
} from "@/lib/meal-glucose";
import { WhoLogged } from "@/components/CaregiverName";

const MIN = 60_000;
const ms = (t: string) => new Date(t).getTime();

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-lg font-display font-bold text-foreground leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 break-words">{sub}</div>}
    </div>
  );
}

function AfterCell({
  label,
  reading,
  delta,
  zones,
}: {
  label: string;
  reading: EventReading | null;
  delta: number | null;
  zones: DayReview["zones"];
}) {
  const value = reading?.value ?? null;
  const meta = value != null ? STATUS_META[glucoseStatus(value, zones)] : null;
  const Arrow = delta == null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="px-3 py-1 text-center border-l border-border/60 first:border-l-0 min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-display font-bold leading-tight ${meta?.text ?? "text-muted-foreground"}`}>
        {value != null ? value : "—"}
        {value != null && <span className="text-[10px] font-normal text-muted-foreground ml-0.5">mg/dL</span>}
      </p>
      {value != null && delta != null ? (
        <p
          className={`text-[11px] flex items-center justify-center gap-0.5 ${
            delta > 0 ? "text-warning" : delta < 0 ? "text-success" : "text-muted-foreground"
          }`}
        >
          <Arrow className="w-3 h-3" />
          {delta === 0 ? "+0" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">—</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {reading ? `at ${formatTime(reading.timestamp)}` : "no reading"}
      </p>
    </div>
  );
}

/**
 * The body of the meal pop-out: full meal info, before/2 h after, the glucose response at
 * 15/30/60 min, and the timeline zoomed to the window around the meal. Readings come from the
 * full-history store so the response works for any meal, not just those in the ~1-day snapshot.
 */
function MealDetailBody({
  meal,
  food,
  snapshot,
  review,
}: {
  meal: DayMeal;
  food?: FoodLogEntry;
  snapshot: PatientSnapshot;
  review: DayReview;
}) {
  const t = ms(meal.timestamp);
  const afterWindowEnd = t + (AFTER_MARK_MIN + AFTER_TOLERANCE_MIN) * MIN;
  const hist = useGlucoseHistory(snapshot.accessCode, t - 60 * MIN, afterWindowEnd);

  const readings = useMemo(() => {
    if (hist.readings?.length) return hist.readings;
    return (review.readings ?? []).filter((r) => {
      const rt = ms(r.timestamp);
      return rt >= t - 60 * MIN && rt <= afterWindowEnd;
    });
  }, [hist.readings, review.readings, t, afterWindowEnd]);

  const pre = readingBefore(readings, t);
  const at15 = readingNearMark(readings, t, 15, 12);
  const at30 = readingNearMark(readings, t, 30, 12);
  const at60 = readingNearMark(readings, t, 60, 12);
  const after2h = readingAfter(readings, t);
  const d = (r: EventReading | null) => (r && pre ? r.value - pre.value : null);

  const after = [at15, at30, at60].filter((r): r is EventReading => r != null).map((r) => r.value);
  const peak = after.length ? Math.max(...after) : null;
  const change = pre && peak != null ? peak - pre.value : null;

  // Correction dose given around this meal (15 min before → 60 min after).
  const correction = useMemo(() => {
    const logs = snapshot.insulinLog ?? [];
    const sum = logs
      .filter((l) => l.type === "correction")
      .filter((l) => {
        const lt = ms(l.timestamp);
        return lt >= t - 15 * MIN && lt <= t + 60 * MIN;
      })
      .reduce((a, l) => a + l.units, 0);
    return sum > 0 ? Math.round(sum * 10) / 10 : null;
  }, [snapshot.insulinLog, t]);

  // Time in range across the hour after the meal.
  const tir = useMemo(() => {
    const inWin = readings.filter((r) => {
      const rt = ms(r.timestamp);
      return rt >= t && rt <= t + 60 * MIN;
    });
    if (!inWin.length) return null;
    const z = review.zones;
    const inR = inWin.filter((r) => r.value >= z.low && r.value <= z.high).length;
    const above = inWin.filter((r) => r.value > z.high).length;
    const below = inWin.filter((r) => r.value < z.low).length;
    return {
      pct: Math.round((inR / inWin.length) * 100),
      above: Math.round((above / inWin.length) * 100),
      below: Math.round((below / inWin.length) * 100),
    };
  }, [readings, t, review.zones]);

  const domain: [number, number] = [t - 45 * MIN, t + (AFTER_MARK_MIN + 15) * MIN];
  const markers = useMemo(
    () => (review.markers ?? []).filter((m) => m.ts >= domain[0] && m.ts <= domain[1]),
    [review.markers, domain[0], domain[1]],
  );
  // The full-size upload when the app sent one; the synced thumbnail meanwhile (or instead).
  const uploaded = useMealPhoto(snapshot.accessCode, food);
  const photo = uploaded.url ?? syncedPhotoThumb(food);

  const when = new Date(meal.timestamp).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="min-w-0">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap mb-3 pr-8">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Utensils className="w-4 h-4 text-primary" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="font-medium text-foreground text-base">
              <span className="text-primary">{SLOT_LABEL[meal.slot]}</span>
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {when} · {formatTime(meal.timestamp)}
              </span>
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground mt-0.5 break-words">
              {meal.name}
              {meal.fromPhoto && !photo && (
                <Camera className="w-3.5 h-3.5 text-muted-foreground inline ml-1.5 -mt-0.5" />
              )}
            </DialogDescription>
          </div>
        </div>
      </div>

      {photo ? (
        <img
          src={photo}
          alt={meal.name}
          className="w-full max-h-80 object-contain rounded-xl border border-border bg-black/20 mb-3"
        />
      ) : uploaded.loading ? (
        <div
          role="status"
          className="mb-3 h-56 rounded-xl border border-border bg-secondary/40 animate-pulse flex items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <Camera className="w-4 h-4" /> Loading photo…
        </div>
      ) : uploaded.failed ? (
        <p className="mb-3 rounded-xl border border-dashed border-border bg-secondary/30 px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
          <Camera className="w-4 h-4 shrink-0" />
          This meal's photo couldn't be loaded right now — try opening it again in a moment.
        </p>
      ) : meal.fromPhoto ? (
        <p className="mb-3 rounded-xl border border-dashed border-border bg-secondary/30 px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
          <Camera className="w-4 h-4 shrink-0" />
          This meal was logged with a photo in the app. Photos show here once the app uploads them.
        </p>
      ) : null}

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Carbs"
          value={
            <>
              {meal.carbs}
              <span className="text-xs font-normal text-muted-foreground ml-0.5">g</span>
            </>
          }
          sub={food?.confidence ? `${food.confidence} confidence` : undefined}
        />
        <Stat
          label="Insulin given"
          value={
            meal.units != null ? (
              <>
                {meal.units}
                <span className="text-xs font-normal text-muted-foreground ml-0.5">u</span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">none</span>
            )
          }
          sub={
            meal.manualOverride && meal.recommendedUnits != null
              ? `rec ${meal.recommendedUnits}u · adjusted`
              : (meal.insulinType ?? meal.doseType ?? undefined)
          }
        />
        <Stat
          label="Before meal"
          value={
            pre ? (
              <>
                {pre.value}
                <span className="text-xs font-normal text-muted-foreground ml-0.5">mg/dL</span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )
          }
          sub={
            pre
              ? `${formatTime(pre.timestamp)} · ${describeOffset(pre.offsetMin)}`
              : `no reading in the ${BEFORE_WINDOW_MIN} min before`
          }
        />
        <Stat
          label="2 h after"
          value={
            after2h ? (
              <>
                {after2h.value}
                <span className="text-xs font-normal text-muted-foreground ml-0.5">mg/dL</span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )
          }
          sub={
            after2h
              ? `${formatTime(after2h.timestamp)} · ${describeOffset(after2h.offsetMin)}`
              : "no reading near the 2 h mark"
          }
        />
      </div>

      {/* Context chips — macros, absorption, insulin brand, override, who logged (when present) */}
      {(() => {
        const chips: string[] = [];
        if (meal.insulinType) chips.push(meal.insulinType);
        if (meal.manualOverride && meal.recommendedUnits != null)
          chips.push(`Dose adjusted from recommended ${meal.recommendedUnits}u`);
        if (meal.fatGrams != null || meal.proteinGrams != null) {
          const macros = [
            meal.fatGrams != null ? `${meal.fatGrams}g fat` : null,
            meal.proteinGrams != null ? `${meal.proteinGrams}g protein` : null,
          ].filter(Boolean);
          if (macros.length) chips.push(macros.join(" · "));
        }
        if (meal.absorption) chips.push(`${meal.absorption} absorption`);
        if (!chips.length) return null;
        return (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {chips.map((c, i) => (
              <span
                key={i}
                className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-secondary/40 text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        );
      })()}

      <WhoLogged mealBy={meal.mealBy} doseBy={meal.doseBy} className="mt-3 text-xs" />

      {/* Response + correction */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-3">
        <div className="rounded-xl border border-border bg-secondary/30 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground text-center mb-1">
            Glucose after meal
          </p>
          <div className="grid grid-cols-3">
            <AfterCell label="15m" reading={at15} delta={d(at15)} zones={review.zones} />
            <AfterCell label="30m" reading={at30} delta={d(at30)} zones={review.zones} />
            <AfterCell label="1h" reading={at60} delta={d(at60)} zones={review.zones} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-secondary/30 p-3 text-center sm:w-32">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Correction</p>
          <p className="text-lg font-display font-bold text-foreground mt-1">
            {correction != null ? `${correction}u` : "—"}
          </p>
        </div>
      </div>

      {/* Zoomed timeline around the meal */}
      <div className="mt-4">
        <DayTimelineChart
          readings={readings}
          markers={markers}
          zones={review.zones}
          domain={domain}
          height={260}
        />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 mt-3 border-t border-border/60 pt-3">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Glucose change</p>
          <p
            className={`text-lg font-display font-bold ${
              change == null
                ? "text-muted-foreground"
                : change > 0
                  ? "text-warning"
                  : change < 0
                    ? "text-success"
                    : "text-foreground"
            }`}
          >
            {change != null ? `${change > 0 ? "+" : ""}${change} mg/dL` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">Before meal to peak (1h)</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Time in range (1h)
          </p>
          <p className="text-lg font-display font-bold text-foreground">
            {tir ? `${tir.pct}%` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {tir ? `Above: ${tir.above}% · Below: ${tir.below}%` : "no readings in the hour after"}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-3 mt-3 flex items-start gap-1.5">
        <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Before meal is the last CGM reading before the meal was logged (within 30 min). 15m,
          30m and 1h are the readings closest to those marks (±12 min), each with the time it was
          taken and the change from before meal. 2 h after is the reading closest to two hours
          after the meal (±30 min) — the same value the meal card shows. Peak is the highest of
          15m/30m/1h; "—" means no CGM reading near that mark.
        </span>
      </p>

      <div className="flex justify-end mt-4">
        <DialogClose asChild>
          <Button variant="outline" size="sm">
            Close
          </Button>
        </DialogClose>
      </div>
    </div>
  );
}

/**
 * Meal detail pop-out, opened by clicking a meal anywhere (Daily Review meal cards and Event Log,
 * Overview Food Log). Close with the X, the Close button, Esc, or by clicking outside.
 */
export function MealDetailModal({
  meal,
  food,
  snapshot,
  review,
  onClose,
}: {
  meal: DayMeal | null;
  food?: FoodLogEntry;
  snapshot: PatientSnapshot;
  review: DayReview | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!meal && !!review} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-card">
        {meal && review && <MealDetailBody meal={meal} food={food} snapshot={snapshot} review={review} />}
      </DialogContent>
    </Dialog>
  );
}

