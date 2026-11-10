/**
 * Which launch sheet is up (Handoff or the Day Recap), so two never stack: iOS can't present a second
 * pop-up over the first. What's new has its own flag (useWhatsNewBusy).
 */
import { useSyncExternalStore } from "react";

type SheetName = "handoff" | "dayRecap" | "sensor";
let holder: SheetName | null = null;
const listeners = new Set<() => void>();

export function sheetHeldByOther(name: SheetName): boolean {
  return holder != null && holder !== name;
}

export function holdSheet(name: SheetName, held: boolean): void {
  const next = held ? name : holder === name ? null : holder;
  if (next === holder) return;
  holder = next;
  listeners.forEach((l) => l());
}

export function useSheetHolder(): SheetName | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => holder,
    () => holder,
  );
}
