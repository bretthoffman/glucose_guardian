import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useLocation } from "wouter";
import { useDoctorSession } from "@/auth/mock-session";

/** Where "Get a license key" goes: the doctors section of the sales site. */
export const LICENSE_URL = "https://www.glucoseguardian.io/main.html#doctors";

function timeLeft(ms: number): string {
  if (ms <= 0) return "ending now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} m left` : `${m} min left`;
}

/** Shown over every page while viewing with a Doctor Portal pass: what this is, time left, and the way on. */
export function PassBanner() {
  const { pass, step, actions } = useDoctorSession();
  const [, navigate] = useLocation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pass) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [pass]);
  if (!pass || step !== "ready") return null;
  const first = pass.patientName.split(/\s+/)[0] || pass.patientName;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur px-4 py-2.5 text-sm text-slate-200 shadow-xl shadow-black/40"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-bold text-white">
        <Clock className="w-3.5 h-3.5" /> Pass · {timeLeft(pass.expiresAt - now)}
      </span>
      <span className="hidden md:inline">
        Viewing {first}'s data with a one-time code from the family. View only.
      </span>
      <a
        href={LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-900 hover:bg-slate-100"
      >
        Get a license key
      </a>
      <button
        type="button"
        onClick={() => {
          actions.signOut();
          navigate("/", { replace: true });
        }}
        className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100 hover:bg-white/20"
      >
        Exit
      </button>
    </div>
  );
}
