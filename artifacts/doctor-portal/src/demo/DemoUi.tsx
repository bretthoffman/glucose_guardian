import { FlaskConical } from "lucide-react";
import { useLocation } from "wouter";
import { useDoctorSession } from "@/auth/mock-session";

/** Shown over every page while in the demo: what this is, and the way out. */
export function DemoBanner() {
  const { demo, step, actions } = useDoctorSession();
  const [, navigate] = useLocation();
  if (!demo || step !== "ready") return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-2rem)] flex items-center gap-3 rounded-2xl border border-amber-400/40 bg-[#2b2210]/95 backdrop-blur px-4 py-2 text-sm text-amber-100 shadow-xl shadow-black/40"
    >
      <FlaskConical className="w-4 h-4 shrink-0 text-amber-300" />
      <span>
        <span className="font-semibold text-amber-300">Demo</span>
        <span className="sm:hidden"> · sample data only</span>
        <span className="hidden sm:inline">
          {" "}
          · sample patients with made-up data. Nothing here is real or sent anywhere.
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          actions.signOut();
          navigate("/", { replace: true });
        }}
        className="shrink-0 rounded-full bg-amber-400/20 px-3 py-1 text-xs font-medium text-amber-100 hover:bg-amber-400/30"
      >
        Exit demo
      </button>
    </div>
  );
}
