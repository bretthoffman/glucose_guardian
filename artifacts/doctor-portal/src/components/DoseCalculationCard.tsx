import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, NotebookPen } from "lucide-react";
import { useSendDoctorMessage, type PatientSnapshot } from "@doctor-portal/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PatientDetail } from "@/data/contracts";
import { calculateDose, typicalCarbs, type DoseCalculation } from "@/lib/dose-calc";
import { RAPID_DIA_MIN, REGULAR_DIA_MIN, formatAgeShort } from "@/lib/app-dose/onBoard";
import { INSULIN_TYPE_LABEL } from "@/lib/app-dose/insulin";
import { formatTime } from "@/lib/utils";
import { STATUS_META, formatAge, glucoseStatus, zonesFromSnapshot } from "@/lib/glucose-metrics";

const r2 = (n: number) => Math.round(n * 100) / 100;
const u = (n: number) => `${r2(n)}u`;
const ago = (min: number | null) => (min != null && min >= 1 ? `${formatAgeShort(min)} ago` : "just now");

/** What each part contributes right now — these add up to the app's subtotal. */
function parts(c: DoseCalculation) {
  const d = c.breakdown;
  const held = d.correctionHeldUnits > 0.001;
  return {
    held,
    correction: held ? 0 : Math.max(0, d.correctionInsulin + d.resistanceBump + d.trendAdjustment),
    activeCarbs: d.uncoveredCarbInsulin,
    activeInsulin: held ? 0 : d.iobCredit,
  };
}

/** Doctor-facing wording of the app's own per-part explanations (utils/doseExplain in the app). */
function howItWorks(c: DoseCalculation, meal: DoseCalculation | null): { title: string; lines: string[] }[] {
  const d = c.breakdown;
  const cf = c.settings.correctionFactor;
  const cr = c.settings.carbRatio;
  const { held } = parts(c);

  const correction = d.correctionSuppressed
    ? [`The reading (${c.bg.value} mg/dL) is at or below the ${c.target} mg/dL target, so no correction is added.`]
    : [`(${c.bg.value} − ${c.target}) ÷ ${cf} = ${u(d.correctionInsulin)}.`];
  if (d.resistanceBump > 0.001)
    correction.push(`Above 300 mg/dL the app adds 10% (${u(d.resistanceBump)}) because corrections under-deliver that high.`);
  if (Math.abs(d.trendAdjustment) >= 0.005)
    correction.push(
      `Trend ${d.trendLabel} ${d.trendAdjustment > 0 ? "adds" : "trims"} ${u(Math.abs(d.trendAdjustment))} — the change expected over the next 30 min ÷ ${cf}, capped at ±2u.`,
    );
  else if (d.hyperTrendZeroed) correction.push(`Glucose is falling but still high, so the falling-trend reduction is skipped.`);
  if (held)
    correction.push(
      `A dose given ${ago(c.activeInsulin.lastDoseAgeMin)} is still taking effect, so this correction (${u(d.correctionHeldUnits)}) is on hold for ~${d.correctionHoldRemainingMin} more min to avoid stacking.`,
    );

  const carbs = [
    `Carbs eaten ÷ ${cr}: 1 unit for every ${cr} g, never reduced by insulin on board.`,
    ...(meal ? [`For this window's typical ${meal.carbs} g meal that's ${meal.carbs} ÷ ${cr} = ${u(meal.breakdown.carbInsulin)}.`] : []),
  ];

  const activeCarbs =
    c.activeCarbs.totalGrams > 0
      ? [
          `About ${c.activeCarbs.totalGrams} g from food logged ${ago(c.activeCarbs.lastEntryAgeMin)} are still absorbing — ${u(d.activeCarbInsulin)} at the carb ratio (fast meals 2 h, medium 3 h, slow 4 h).`,
          d.uncoveredCarbInsulin > 0.001
            ? `Insulin on board covers part of it; the uncovered ${u(d.uncoveredCarbInsulin)} is added.`
            : `Insulin already on board covers them, so nothing is added.`,
        ]
      : [`Nothing from recent meals is still absorbing.`];

  const activeInsulin =
    d.activeInsulinUnits > 0
      ? [
          `${u(d.activeInsulinUnits)} still active from ${c.activeInsulin.doseCount > 1 ? `${c.activeInsulin.doseCount} recent doses` : `a dose ${ago(c.activeInsulin.lastDoseAgeMin)}`} (mealtime insulin only — basal never counts).`,
          ...(d.activeCarbInsulin > 0.001
            ? [`It's netted against the ${u(d.activeCarbInsulin)} of absorbing carbs first; only the surplus is credited.`]
            : []),
          ...(d.iobDiscounted ? [`Glucose is high and not falling despite it, so only half of the older insulin is credited.`] : []),
          held
            ? `No credit is taken while the correction is on hold.`
            : d.iobCredit > 0.001
              ? `${u(d.iobCredit)} comes off the correction only — never off the carb dose.`
              : `There's no correction for it to reduce right now.`,
        ]
      : [`No mealtime insulin is still active.`];

  const suggestion = [`Now: ${u(d.subTotal)}${Math.abs(d.patternDelta) >= 0.005 ? ` × ${d.patternFactor} pattern` : ""} → ${u(d.totalDose)} (rounded to the nearest ½ unit).`];
  if (Math.abs(d.patternDelta) >= 0.005)
    suggestion.push(
      `The ×${d.patternFactor} pattern adjustment comes from ${c.tuning.sampleCount} ${c.settings.bucketLabel.toLowerCase()} doses over the last 2 weeks that ran ${d.patternFactor > 1 ? "above" : "below"} the app's suggestions. The saved settings are unchanged.`,
    );
  if (meal?.breakdown.cappedAtMax) suggestion.push(`With the typical meal it's capped at the ${u(meal.breakdown.maxDoseCap)} single-dose safety limit.`);

  return [
    { title: "Correct BG", lines: correction },
    { title: "Carb dose", lines: carbs },
    { title: "Active carbs", lines: activeCarbs },
    { title: "Active insulin", lines: activeInsulin },
    { title: "Suggestion", lines: suggestion },
  ];
}

/**
 * One part of the formula: the live quantity itself (the reading, grams, units) big, where it came
 * from, and — under the rule — what it does to the dose. The effect lines add up to the suggestion.
 * `changeKey` changes whenever the underlying value does, replaying a fade so updates are noticed.
 */
function Term({
  title,
  value,
  unit,
  valueClass = "text-foreground",
  detail,
  effect,
  changeKey,
}: {
  title: string;
  value: ReactNode;
  unit?: string;
  valueClass?: string;
  detail?: ReactNode;
  effect: ReactNode;
  changeKey: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 min-w-0 flex flex-col">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <p key={changeKey} className="mt-1 flex items-baseline gap-1 animate-fade-in">
        <span className={`text-2xl font-display font-bold leading-tight ${valueClass}`}>{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </p>
      {detail && <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>}
      <p className="text-[11px] text-foreground/85 mt-auto pt-2">
        <span className="block border-t border-border/60 pt-1.5">{effect}</span>
      </p>
    </div>
  );
}

function Op({ children }: { children: ReactNode }) {
  return (
    <span className="self-center justify-self-center text-lg font-semibold text-muted-foreground px-0.5" aria-hidden>
      {children}
    </span>
  );
}

/** A note to the parents about the calculation (settings changes are proposed in Treatment Settings). */
function NoteToParents({ detail, calc, onDone }: { detail: PatientDetail; calc: DoseCalculation; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const send = useSendDoctorMessage();
  const s = calc.settings;

  const submit = () => {
    setError(null);
    const context = `About the dose calculator (${s.bucketLabel.toLowerCase()} settings: carb ratio 1:${s.carbRatio}, correction factor 1:${s.correctionFactor}, target ${calc.target} mg/dL):`;
    send.mutate(
      { accessCode: detail.accessCode, data: { text: `${context}\n${note.trim()}`, sender: "doctor" } },
      { onSuccess: onDone, onError: () => setError("Could not send the note. Try again.") },
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="What should change, and why?"
        className="text-sm"
        aria-label="Note"
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" disabled={!note.trim() || send.isPending} onClick={submit}>
          Send note to parents
        </Button>
        <button
          onClick={() => setLocation(`/patient/${detail.accessCode}/orders`)}
          className="text-xs text-primary hover:underline"
        >
          Propose new settings instead
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">Arrives in the parents' Doctor thread in the app.</p>
    </div>
  );
}

/**
 * "Dose Calculation" for the Overview, read-only: the app's own calculator run on this patient's
 * data right now, shown as its formula — Correct BG + Carb dose + Active carbs − Active insulin —
 * with the current numbers under each part and what it's suggesting.
 */
export function DoseCalculationCard({ snapshot, detail }: { snapshot: PatientSnapshot; detail?: PatientDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const typical = useMemo(() => typicalCarbs(snapshot, now), [snapshot, now]);
  const calc = useMemo(() => calculateDose(snapshot, 0, now), [snapshot, now]);
  const meal = useMemo(() => (typical > 0 ? calculateDose(snapshot, typical, now) : null), [snapshot, typical, now]);
  const [showMath, setShowMath] = useState(false);
  const [noting, setNoting] = useState(false);
  const [sent, setSent] = useState(false);

  if (!calc) {
    return <p className="text-sm text-muted-foreground">No recent CGM reading, so the app's calculator has nothing to start from.</p>;
  }
  const d = calc.breakdown;
  const s = calc.settings;
  const p = parts(calc);
  const warning = d.warnings[0];
  const dia = calc.insulin?.type === "regular" || calc.insulin?.type === "premixed" ? REGULAR_DIA_MIN : RAPID_DIA_MIN;
  const signed = (n: number, sign: "+" | "−") => `${sign}${u(n)}`;
  const zones = zonesFromSnapshot(snapshot);
  const bgMeta = STATUS_META[glucoseStatus(calc.bg.value, zones)];
  const bgAgeMin = Math.max(0, Math.round((now - new Date(calc.bg.timestamp).getTime()) / 60_000));
  const RECENT_MS = 6 * 3_600_000;
  const newest = <T extends { timestamp: string }>(list: T[]) =>
    list
      .filter((x) => {
        const t = new Date(x.timestamp).getTime();
        return t <= now && now - t <= RECENT_MS;
      })
      .reduce<T | null>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), null);
  const lastDose = newest((snapshot.insulinLog ?? []).filter((l) => l.units > 0 && l.type !== "basal"));
  const since = (ts: string) => formatAge(Math.max(0, Math.round((now - new Date(ts).getTime()) / 60_000)));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Current formula · {s.bucketLabel} settings ({s.bucketHours})
        </p>
        <p className="text-[11px] text-muted-foreground">
          {formatTime(calc.bg.timestamp)} reading: {calc.bg.value} mg/dL, {calc.bg.trend.label.toLowerCase()} {calc.bg.trend.arrow}
        </p>
      </div>
      <p className="text-sm font-medium text-foreground mt-1.5">
        Dose = (BG − Target) ÷ Correction factor + Carbs ÷ Carb ratio + Active carbs − Active insulin
      </p>

      {d.basalSuppressed ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The only insulin set up in the app is basal, which isn't dosed from carbs or corrections — the calculator suggests nothing.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1.15fr]">
          <Term
            title="Current BG"
            value={
              <>
                {calc.bg.value} <span className="text-lg">{calc.bg.trend.arrow}</span>
              </>
            }
            unit="mg/dL"
            valueClass={bgMeta.text}
            detail={`${formatTime(calc.bg.timestamp)} · ${formatAge(bgAgeMin)} · ${calc.bg.trend.label.toLowerCase()}`}
            effect={
              d.correctionSuppressed
                ? `+0u — at or below the ${calc.target} target`
                : p.held
                  ? `+0u now — ${u(d.correctionHeldUnits)} correction on hold (recent dose)`
                  : `${signed(p.correction, "+")} = (${calc.bg.value} − ${calc.target}) ÷ ${s.correctionFactor}${Math.abs(d.trendAdjustment) >= 0.005 ? ` ${d.trendAdjustment > 0 ? "+" : "−"} ${r2(Math.abs(d.trendAdjustment))} trend` : ""}`
            }
            changeKey={calc.bg.timestamp}
          />
          <Op>+</Op>
          <Term
            title="Carb dose"
            value={`1u / ${s.carbRatio}`}
            unit="g"
            detail="For food being eaten"
            effect={`+0u now — carbs ÷ ${s.carbRatio} once food is entered`}
            changeKey={`${s.carbRatio}`}
          />
          <Op>+</Op>
          <Term
            title="Active carbs"
            value={calc.activeCarbs.totalGrams}
            unit="g still absorbing"
            detail={
              calc.activeCarbs.totalGrams > 0
                ? `${u(d.activeCarbInsulin)} worth at 1:${s.carbRatio}`
                : "Nothing absorbing"
            }
            effect={
              p.activeCarbs > 0.001
                ? `${signed(p.activeCarbs, "+")} — more than the insulin on board covers`
                : calc.activeCarbs.totalGrams > 0
                  ? "+0u — covered by insulin on board"
                  : "+0u"
            }
            changeKey={`${calc.activeCarbs.totalGrams}`}
          />
          <Op>−</Op>
          <Term
            title="Active insulin"
            value={r2(d.activeInsulinUnits)}
            unit="u still active"
            detail={
              lastDose
                ? `Last dose ${lastDose.units}u · ${formatTime(lastDose.timestamp)} (${since(lastDose.timestamp)})`
                : "No mealtime dose in the last 6 h"
            }
            effect={
              p.held
                ? "−0u — not credited while the correction is on hold"
                : p.activeInsulin > 0.001
                  ? `${signed(p.activeInsulin, "−")} off the correction${d.iobDiscounted ? " (half credited — glucose not falling)" : ""}`
                  : d.activeInsulinUnits > 0
                    ? "−0u — used up covering active carbs"
                    : "−0u"
            }
            changeKey={lastDose?.id ?? "none"}
          />
          <Op>=</Op>
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-primary">Suggesting</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-display font-bold text-primary leading-tight">{u(d.totalDose)}</span>
              <span className="text-xs text-muted-foreground">right now, before food</span>
            </p>
            {meal && (
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-display font-bold text-primary leading-tight">{u(meal.breakdown.totalDose)}</span>
                <span className="text-xs text-muted-foreground">
                  with a typical {meal.carbs} g {s.bucketLabel.toLowerCase()}
                </span>
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {[
                Math.abs(d.patternDelta) >= 0.005 || (meal && Math.abs(meal.breakdown.patternDelta) >= 0.005)
                  ? `×${calc.tuning.factor} pattern`
                  : null,
                meal?.breakdown.cappedAtMax ? `capped at ${u(meal.breakdown.maxDoseCap)}` : null,
                "rounded to ½u",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {warning && (
        <p
          className={`mt-2.5 text-[11px] flex items-start gap-1.5 ${warning.level === "info" ? "text-muted-foreground" : "text-amber-600"}`}
        >
          {warning.level === "info" ? <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />}
          <span>{warning.message}</span>
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="space-y-1 text-[11px] text-muted-foreground min-w-0 flex-1">
          <p>
            <span className="text-foreground font-medium">Settings used:</span> carb ratio 1:{s.carbRatio}
            {s.carbRatio !== calc.base.carbRatio && ` (${s.bucketLabel.toLowerCase()} only; all-day 1:${calc.base.carbRatio})`} · correction factor 1:
            {s.correctionFactor}
            {s.correctionFactor !== calc.base.correctionFactor && ` (${s.bucketLabel.toLowerCase()} only; all-day 1:${calc.base.correctionFactor})`} · target{" "}
            {calc.target} mg/dL ·{" "}
            {calc.insulin
              ? `${calc.insulin.name} (${INSULIN_TYPE_LABEL[calc.insulin.type].toLowerCase()}, ${dia / 60} h action)`
              : "insulin type not set (counted as rapid-acting, 4 h action)"}{" "}
            · safety cap {u(d.maxDoseCap)}
            {d.maxDoseCap !== 10 ? " by weight" : ""}
          </p>
          {calc.defaulted.length > 0 && (
            <p className="text-amber-600">Not saved for this patient, so the app's default is used: {calc.defaulted.join(", ")}.</p>
          )}
          <p>Same math as the app's dose calculator.</p>
        </div>
        <button
          onClick={() => setShowMath((v) => !v)}
          className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
        >
          {showMath ? "Hide the math" : "Show the math"}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMath ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showMath && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {howItWorks(calc, meal).map((part) => (
            <div key={part.title}>
              <p className="text-xs font-medium text-foreground">{part.title}</p>
              <ul className="mt-1 space-y-1">
                {part.lines.map((line) => (
                  <li key={line} className="text-[11px] text-muted-foreground leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {detail &&
        (sent ? (
          <p className="mt-3 text-sm text-success flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Note sent to the parents.
          </p>
        ) : noting ? (
          <NoteToParents detail={detail} calc={calc} onDone={() => setSent(true)} />
        ) : (
          <button
            onClick={() => setNoting(true)}
            className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <NotebookPen className="w-4 h-4" /> Add a note about a change
          </button>
        ))}
    </div>
  );
}
