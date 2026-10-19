import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface TourStep {
  selector: string;
  title: string;
  body: string;
  /** Tab/route this step lives on; the tour navigates there before highlighting. */
  tab?: string;
}

const SEEN_KEY = "gg_tour_seen";
/** Set at account creation — the tour only auto-runs for brand-new accounts, never on sign-in. */
const PENDING_KEY = "gg_tour_pending";
/** Fire `window.dispatchEvent(new Event(TOUR_EVENT))` to (re)launch the tour. */
export const TOUR_EVENT = "gg:start-tour";

/**
 * Lightweight, dependency-free product tour. Dims the screen and spotlights one element at a time
 * with a Back / Next / Skip tooltip. Steps can live on different tabs — the tour calls `onNavigate`
 * and then waits for the target element to mount before positioning. Runs once on first visit
 * (unless `enabled` is false) and can be replayed via TOUR_EVENT.
 */
export function ProductTour({
  steps,
  enabled = true,
  onNavigate,
}: {
  steps: TourStep[];
  enabled?: boolean;
  onNavigate?: (tab: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const started = useRef(false);

  // Auto-start only for brand-new accounts (flag set at registration), and only once.
  useEffect(() => {
    if (!enabled || started.current) return;
    let pending = false;
    let seen = false;
    try {
      pending = !!sessionStorage.getItem(PENDING_KEY);
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {
      /* ignore */
    }
    if (pending && !seen) {
      started.current = true;
      setI(0);
      setActive(true);
    }
  }, [enabled]);

  // Replay on demand.
  useEffect(() => {
    const onStart = () => {
      started.current = true;
      setI(0);
      setActive(true);
    };
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  const step = active ? steps[i] : undefined;

  useLayoutEffect(() => {
    if (!step) return;
    if (step.tab) onNavigate?.(step.tab);

    let raf = 0;
    let tries = 0;
    let cancelled = false;
    const place = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector);
      if (!el) {
        // Target may belong to a tab that just started mounting — poll briefly.
        if (tries++ < 40) raf = requestAnimationFrame(place);
        else setRect(null);
        return;
      }
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      setRect(el.getBoundingClientRect());
    };
    place();

    const onChange = () => {
      const el = document.querySelector(step.selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [step, onNavigate]);

  if (!step) return null;

  const finish = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    setActive(false);
  };
  const next = () => (i < steps.length - 1 ? setI(i + 1) : finish());
  const back = () => setI((n) => Math.max(0, n - 1));

  const pad = 8;
  const spot = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const TW = 320;
  let tipStyle: React.CSSProperties;
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(rect.left, 16), vw - TW - 16);
    const below = rect.bottom + 14 + 184 < vh;
    tipStyle = below
      ? { top: rect.bottom + 14, left }
      : { top: Math.max(16, rect.top - 14 - 188), left };
  } else {
    tipStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {/* click-catcher so the page behind isn't interactive during the tour */}
      <div className="absolute inset-0" />
      {spot ? (
        <div
          className="absolute rounded-xl transition-all duration-200 pointer-events-none"
          style={{
            ...spot,
            boxShadow: "0 0 0 2px var(--color-primary), 0 0 0 9999px rgba(2,6,23,0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(2,6,23,0.72)]" />
      )}

      <div
        className="absolute w-[320px] bg-card border border-border rounded-2xl shadow-2xl p-4"
        style={tipStyle}
      >
        <button
          onClick={finish}
          aria-label="Close tour"
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
        <p className="text-sm font-semibold text-foreground pr-6">{step.title}</p>
        <p className="text-sm text-muted-foreground mt-1.5 leading-snug">{step.body}</p>
        <div className="flex items-center justify-between mt-4">
          <span className="text-[11px] text-muted-foreground">
            {i + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground">
              Skip
            </button>
            {i > 0 && (
              <button
                onClick={back}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-secondary transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              {i < steps.length - 1 ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
