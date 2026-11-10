/**
 * Meal high heads-up data (convex/mealHigh): whether it's on, what counts as high, whether this
 * person may change that, and the meals that kept them high even after extra insulin.
 */
import { useQuery } from "convex/react";
import { useSensorArgs } from "@/hooks/useSensor";
import { api } from "@/utils/convex-auth-client";

export function useMealHigh() {
  const args = useSensorArgs();
  const data = useQuery(api.mealHigh.forViewer, args ?? "skip");
  return { args, data: data ?? null, loading: args != null && data === undefined };
}
