import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Bell, CheckCircle2, Clock, MessageSquare, XCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDoctorAlerts } from "@/data/doctor-data";
import { formatDate, formatTime } from "@/lib/utils";

const KIND_META: Record<string, { icon: typeof Bell; cls: string }> = {
  urgent_low: { icon: AlertTriangle, cls: "text-destructive" },
  urgent_high: { icon: AlertTriangle, cls: "text-destructive" },
  stale_data: { icon: Clock, cls: "text-amber-600" },
  decision_approved: { icon: CheckCircle2, cls: "text-success" },
  decision_declined: { icon: XCircle, cls: "text-amber-600" },
  nurse_message: { icon: MessageSquare, cls: "text-primary" },
};

/**
 * Cross-patient alert bell: urgent glucose events, stale data, and caregiver decisions from the
 * server-side alert engine. Opening the popover marks everything read. Hidden entirely until the
 * backend alerts module is deployed (the feed returns null).
 */
export function DoctorAlertsBell() {
  const { alerts, unreadCount, markAllRead } = useDoctorAlerts();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  if (alerts === null) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && unreadCount > 0) markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Alerts"
          aria-label={`Alerts${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Alerts</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No alerts yet. Urgent glucose events, stale data, and caregiver decisions show up
              here.
            </p>
          ) : (
            alerts.map((a) => {
              const meta = KIND_META[a.kind] ?? { icon: Bell, cls: "text-muted-foreground" };
              const Icon = meta.icon;
              const iso = new Date(a.createdAt).toISOString();
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setOpen(false);
                    setLocation(
                      `/patient/${a.accessCode}/${a.kind === "nurse_message" ? "messages" : "overview"}`,
                    );
                  }}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-secondary/60 border-b border-border/60 last:border-b-0 ${
                    a.readAt ? "" : "bg-primary/5"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.cls}`} />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{a.message}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {formatDate(iso)} · {formatTime(iso)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
