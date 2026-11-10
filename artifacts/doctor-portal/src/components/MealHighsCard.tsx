/**
 * "Meals that stay high": meals that kept the patient high even after extra insulin, the same list
 * the app's calculator warns from (convex/mealHighLogic via /meal-highs). Read-only; hidden when the
 * list can't be loaded (a Doctor Portal pass, or before the backend is deployed).
 */
import { useEffect, useState } from "react";
import { customFetch } from "@doctor-portal/api-client-react";

interface MealEvent {
  at: number;
  carbs: number;
  mealUnits: number;
  extra: { at: number; units: number }[];
  laterBg: number;
  outcome: "stayedHigh" | "wentLow" | "fine";
}
interface MealPattern {
  foodName: string;
  events: MealEvent[];
  stayedHigh: number;
  avgLater: number;
  avgCarbs: number;
  avgMealUnits: number;
  avgExtraUnits: number;
  lastAt: number;
}
interface MealHighs {
  enabled: boolean;
  high: number;
  lookbackDays: number;
  patterns: MealPattern[];
}

function timeOfDay(ms: number): string {
  const h = new Date(ms).getHours();
  if (h >= 5 && h < 10) return "Breakfast";
  if (h >= 10 && h < 15) return "Lunch";
  if (h >= 15 && h < 21) return "Dinner";
  return "Overnight";
}
const u = (n: number) => `${Math.round(n * 100) / 100}u`;

export function useMealHighs(accessCode: string): MealHighs | null | undefined {
  const [data, setData] = useState<MealHighs | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    customFetch<MealHighs>(`/api/doctor/patient/${encodeURIComponent(accessCode)}/meal-highs`, { method: "GET" })
      .then((r) => !cancelled && setData(r && Array.isArray(r.patterns) ? r : null))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [accessCode]);
  return data;
}

export function MealHighsList({ data }: { data: MealHighs }) {
  if (data.patterns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No meals stayed over {data.high} after extra insulin in the last {data.lookbackDays} days.
      </p>
    );
  }
  const parts = data.patterns.map((p) => timeOfDay(p.lastAt));
  const common = parts.find((t) => parts.filter((x) => x === t).length >= 2);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Last {data.lookbackDays} days. Meal dose given, over {data.high} by 2 hours, more insulin given, still over {data.high} at 3 to 4 hours.
        {!data.enabled && " The family has the app's heads-up turned off."}
      </p>
      <ul className="divide-y divide-border/60">
        {data.patterns.map((p) => (
          <li key={p.foodName + p.lastAt} className="py-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-medium text-foreground min-w-[9rem] flex-1">{p.foodName}</span>
            <span className="text-sm text-foreground">
              <b className="text-orange-600 dark:text-orange-400">{p.stayedHigh}</b> of {p.events.length} times
            </span>
            <span className="text-sm text-muted-foreground">{p.avgCarbs}g</span>
            <span className="text-sm text-muted-foreground">
              {u(p.avgMealUnits)} + {u(p.avgExtraUnits)} more
            </span>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">{p.avgLater} at 4h</span>
            <span className="text-sm text-muted-foreground">{timeOfDay(p.lastAt)}</span>
          </li>
        ))}
      </ul>
      {common && (
        <p className="text-sm text-blue-900 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl px-3 py-2">
          {parts.filter((x) => x === common).length} of these are {common.toLowerCase()}. If the pattern holds, a stronger {common.toLowerCase()} carb
          ratio may cover them. Any change still goes to the family to approve.
        </p>
      )}
    </div>
  );
}
