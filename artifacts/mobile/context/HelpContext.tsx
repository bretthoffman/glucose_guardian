/**
 * Help Mode — the guided walkthrough engine.
 *
 * Entered from the Dashboard's Help button. While on, opening any tab page starts that page's
 * scripted tour (utils/helpScripts): one element at a time is spotlit by the overlay
 * (components/HelpOverlay, mounted over the tabs but under the tab bar) while everything else dims.
 * Tapping anywhere advances; the tab bar stays live so pages can be switched mid-tour; the ✕ pill
 * exits back to the normal app.
 *
 * SAFETY: the overlay intercepts every touch on page content, so nothing in Help Mode can reach a
 * real control — no logs, no saves, no account changes. The only page state a tour may move is
 * declared view-only `effects` (e.g. showing the Insulin page's Log tab), which pages apply while
 * the step is active and drop the moment the tour moves on or Help Mode ends.
 *
 * Anchors: pages attach `useHelpAnchor("home.gauge")` refs to the views the script names. A step
 * whose anchor isn't currently rendered (conditional UI) is skipped. Off-screen anchors are scrolled
 * into view first when the page registered its ScrollView via `useHelpScroll`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions } from "react-native";
import type { ScrollView, View } from "react-native";
import { usePathname } from "expo-router";
import * as Haptics from "expo-haptics";
import { HELP_PAGE_FOR_PATH, HELP_SCRIPTS, type HelpPageId, type HelpStep } from "@/utils/helpScripts";

export type SpotlightRect = { x: number; y: number; width: number; height: number };

type Tour = { page: HelpPageId; index: number };

interface HelpContextValue {
  helpMode: boolean;
  enterHelp: () => void;
  exitHelp: () => void;
  /** The running tour (null = help mode idle, e.g. on the Dashboard). */
  tour: Tour | null;
  step: HelpStep | null;
  stepCount: number;
  /** Window coordinates of the spotlit element; null while measuring. */
  rect: SpotlightRect | null;
  advance: () => void;
  /** Effects of the ACTIVE step — pages render view-only state from these. */
  activeEffects: readonly string[];
  /** True while a tour runs on the given page — pages use it to gate their effect handling. */
  isTouring: (page: HelpPageId) => boolean;
  /** Internal wiring for useHelpAnchor / useHelpScroll / route tracking. */
  _registerAnchor: (id: string, node: View | null) => void;
  _registerScroll: (page: HelpPageId, handle: ScrollHandle) => void;
  /** Removes only if this exact handle is still the page's current one (see useHelpScroll). */
  _unregisterScroll: (page: HelpPageId, handle: ScrollHandle) => void;
  _reportPath: (path: string) => void;
}

type ScrollHandle = { ref: React.RefObject<ScrollView | null>; getOffset: () => number };

const HelpContext = createContext<HelpContextValue | null>(null);

const MEASURE_TRIES = 6;
const MEASURE_DELAY_MS = 90;
/** Keep the spotlight below the exit pill and above the tour card + tab bar. */
const VIEW_TOP = 96;
const VIEW_BOTTOM_RESERVE = 260;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [helpMode, setHelpMode] = useState(false);
  const [tour, setTour] = useState<Tour | null>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const anchors = useRef(new Map<string, View>());
  const scrolls = useRef(new Map<HelpPageId, ScrollHandle>());
  const runToken = useRef(0);

  const script = tour ? HELP_SCRIPTS[tour.page] : null;
  const step = tour && script ? (script[tour.index] ?? null) : null;

  const _registerAnchor = useCallback((id: string, node: View | null) => {
    if (node) anchors.current.set(id, node);
    else anchors.current.delete(id);
  }, []);
  const _registerScroll = useCallback((page: HelpPageId, handle: ScrollHandle) => {
    scrolls.current.set(page, handle);
  }, []);
  const _unregisterScroll = useCallback((page: HelpPageId, handle: ScrollHandle) => {
    if (scrolls.current.get(page) === handle) scrolls.current.delete(page);
  }, []);

  const measure = useCallback(async (id: string, token: number): Promise<SpotlightRect | null> => {
    for (let i = 0; i < MEASURE_TRIES; i++) {
      if (runToken.current !== token) return null;
      const node = anchors.current.get(id);
      if (node) {
        const r = await new Promise<SpotlightRect | null>((resolve) => {
          node.measureInWindow((x, y, width, height) =>
            resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
          );
        });
        if (r) return r;
      }
      await delay(MEASURE_DELAY_MS);
    }
    return null;
  }, []);

  /** Activate a step: skip missing anchors, scroll into view if needed, publish the rect. */
  const activate = useCallback(
    async (page: HelpPageId, index: number) => {
      const token = ++runToken.current;
      const steps = HELP_SCRIPTS[page];
      let i = index;
      setRect(null);
      while (i < steps.length) {
        // A brief settle so conditional anchors (a tab the step's effect just opened) can mount.
        const r = await measure(steps[i]!.anchor, token);
        if (runToken.current !== token) return;
        if (!r) {
          i += 1;
          setTour({ page, index: i });
          continue;
        }
        let final = r;
        const scroll = scrolls.current.get(page);
        const winH = Dimensions.get("window").height;
        if (scroll?.ref.current && (r.y < VIEW_TOP || r.y + r.height > winH - VIEW_BOTTOM_RESERVE)) {
          const target = Math.max(0, scroll.getOffset() + r.y - VIEW_TOP - 24);
          scroll.ref.current.scrollTo({ y: target, animated: true });
          await delay(420);
          if (runToken.current !== token) return;
          final = (await measure(steps[i]!.anchor, token)) ?? r;
          if (runToken.current !== token) return;
        }
        setRect(final);
        return;
      }
      // Walked off the end — the page's tour is done; stay in help mode, back to the idle card.
      if (runToken.current === token) {
        setTour(null);
        setRect(null);
      }
    },
    [measure],
  );

  const startTour = useCallback(
    (page: HelpPageId) => {
      Haptics.selectionAsync().catch(() => {});
      setTour({ page, index: 0 });
      void activate(page, 0);
    },
    [activate],
  );

  const clearTour = useCallback(() => {
    runToken.current += 1;
    setTour(null);
    setRect(null);
  }, []);

  const advance = useCallback(() => {
    if (!tour) return;
    Haptics.selectionAsync().catch(() => {});
    const next = tour.index + 1;
    const steps = HELP_SCRIPTS[tour.page];
    if (next >= steps.length) {
      clearTour();
      return;
    }
    setTour({ page: tour.page, index: next });
    void activate(tour.page, next);
  }, [tour, activate, clearTour]);

  const enterHelp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setHelpMode(true);
    clearTour();
  }, [clearTour]);

  const exitHelp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setHelpMode(false);
    clearTour();
  }, [clearTour]);

  // Route changes drive tours: landing on a scripted page starts (or restarts) its tour from the
  // top; landing anywhere else (Dashboard) drops back to the idle card. Pages report their path
  // through useHelpPage so this works without a navigation-container dependency.
  const lastPath = useRef<string | null>(null);
  const _reportPath = useCallback(
    (path: string) => {
      if (lastPath.current === path) return;
      lastPath.current = path;
      if (!helpMode) return;
      const page = HELP_PAGE_FOR_PATH[path];
      if (page) startTour(page);
      else clearTour();
    },
    [helpMode, startTour, clearTour],
  );
  // Entering help mode while already sitting on a scripted page (deep link edge) does nothing —
  // the Help button lives on the Dashboard, and the first tab press from there starts the tour.

  const isTouring = useCallback((page: HelpPageId) => helpMode && tour?.page === page, [helpMode, tour?.page]);

  const value = useMemo<HelpContextValue>(
    () => ({
      helpMode,
      enterHelp,
      exitHelp,
      tour,
      step,
      stepCount: script?.length ?? 0,
      rect,
      advance,
      activeEffects: step?.effects ?? [],
      isTouring,
      _registerAnchor,
      _registerScroll,
      _unregisterScroll,
      _reportPath,
    }),
    [helpMode, enterHelp, exitHelp, tour, step, script, rect, advance, isTouring, _registerAnchor, _registerScroll, _unregisterScroll, _reportPath],
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}

/** Attach to the View the script names: `<View ref={useHelpAnchor("home.gauge")} collapsable={false}>`. */
export function useHelpAnchor(id: string) {
  const { _registerAnchor } = useHelp();
  return useCallback((node: View | null) => _registerAnchor(id, node), [_registerAnchor, id]);
}

/**
 * Report this page's ScrollView so off-screen anchors can be scrolled into view.
 * - Default: spread the returned `onScroll`/`scrollEventThrottle` onto the ScrollView.
 * - A page that already tracks its offset passes `getOffset` and ignores the returned handler.
 * - `enabled: false` (the Insulin page's Dose scroll while the Log tab shows) leaves the registry
 *   alone rather than deleting — unregistration is identity-checked so a parent toggling off can
 *   never remove the child registration that just replaced it.
 */
export function useHelpScroll(
  page: HelpPageId,
  ref: React.RefObject<ScrollView | null>,
  opts: { getOffset?: () => number; enabled?: boolean } = {},
) {
  const { _registerScroll, _unregisterScroll } = useHelp();
  const offset = useRef(0);
  const getOffsetRef = useRef(opts.getOffset);
  getOffsetRef.current = opts.getOffset;
  const handleRef = useRef<ScrollHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = { ref, getOffset: () => (getOffsetRef.current ? getOffsetRef.current() : offset.current) };
  }
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    const handle = handleRef.current!;
    if (!enabled) return;
    _registerScroll(page, handle);
    return () => _unregisterScroll(page, handle);
  }, [_registerScroll, _unregisterScroll, page, enabled]);
  return {
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 33,
  } as const;
}

/**
 * Call once per tab page (dashboard included) with the page's pathname. Keeps the engine informed of
 * where the user is so tours start/stop on tab switches. Returns helpers pages need for effects.
 */
export function useHelpPage() {
  // usePathname is global (every subscriber sees the focused route), so all mounted tab pages
  // report the same value and _reportPath dedupes — one startTour per actual tab change.
  const pathname = usePathname();
  const { _reportPath, helpMode, activeEffects, isTouring } = useHelp();
  useEffect(() => {
    _reportPath(pathname);
  }, [pathname, _reportPath]);
  return { helpMode, activeEffects, isTouring };
}
