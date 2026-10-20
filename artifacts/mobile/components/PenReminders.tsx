/**
 * Keeps this device's pen reminders in step with the open pens (3 days before, the day before, and
 * the change-by day, 9 AM local). Renders nothing; mounted once in the tabs layout. Reschedules only
 * when the reminder list actually changes, and again on each new day.
 */
import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { syncPenReminders } from "@/services/notifications";
import { penReminders, REMINDER_HOUR, toLocalDate } from "@/utils/pens";

export default function PenReminders() {
  const { penLog, isLoading, doctorSession } = useAuth();
  const today = toLocalDate(new Date());
  const hour = new Date().getHours();
  const reminders = useMemo(
    () => (doctorSession ? [] : penLog.flatMap((p) => penReminders(p, today, hour))),
    // `hour` only matters around 9 AM; recomputing per render is cheap.
    [penLog, today, hour, doctorSession],
  );
  const signature = reminders.map((r) => `${r.key}@${r.date}|${r.title}`).join(",");
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || last.current === signature) return;
    last.current = signature;
    void syncPenReminders(reminders, REMINDER_HOUR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, isLoading]);
  return null;
}
