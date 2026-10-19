import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Light / dark theme.
 *
 * A module-level store (no provider needed): `useTheme()` works anywhere, including the
 * auth screens. The choice ("light" | "dark" | "system") persists in localStorage under
 * `gg_theme`; "system" (the default) follows `prefers-color-scheme` live. The resolved
 * theme is applied as the `dark` class on <html>. public/theme-init.js applies the same
 * logic before first paint so there's no flash — keep the two in sync.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "gg_theme";
const MEDIA = "(prefers-color-scheme: dark)";

function readStored(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function writeStored(t: ThemeChoice) {
  try {
    if (t === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* storage unavailable */
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(MEDIA).matches;
  } catch {
    return false;
  }
}

type Snapshot = { theme: ThemeChoice; resolved: ResolvedTheme };

const isBrowser = typeof window !== "undefined";
let choice: ThemeChoice = isBrowser ? readStored() : "system";
let snapshot: Snapshot = compute();
const listeners = new Set<() => void>();

function compute(): Snapshot {
  const resolved: ResolvedTheme =
    choice === "system" ? (isBrowser && systemPrefersDark() ? "dark" : "light") : choice;
  return { theme: choice, resolved };
}

function apply() {
  if (!isBrowser) return;
  document.documentElement.classList.toggle("dark", snapshot.resolved === "dark");
}

function update() {
  const next = compute();
  if (next.theme !== snapshot.theme || next.resolved !== snapshot.resolved) {
    snapshot = next;
    apply();
    listeners.forEach((l) => l());
  }
}

if (isBrowser) {
  apply();
  try {
    window.matchMedia(MEDIA).addEventListener("change", () => {
      if (choice === "system") update();
    });
  } catch {
    /* matchMedia unavailable */
  }
  // Keep multiple tabs in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      choice = readStored();
      update();
    }
  });
}

export function setTheme(t: ThemeChoice) {
  choice = t;
  writeStored(t);
  update();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => snapshot;

export function useTheme(): Snapshot & { setTheme: (t: ThemeChoice) => void } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, setTheme };
}

/** Compact icon button that flips between light and dark (an explicit choice). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const next: ResolvedTheme = resolved === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {resolved === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
