/**
 * Help Mode — the guided walkthrough engine.
 *
 * Entered from the Dashboard's Help button. While on, opening any tab page starts that page's
 * scripted tour (utils/helpScripts): one element at a time is spotlit by the overlay
 * (components/HelpOverlay) while everything else dims — including the screen around and below the
 * tab bar, whose exact frame the bar reports here (_reportTabBar) so only the pill itself stays
 * lit and live for switching pages mid-tour. Tapping anywhere advances; the ✕ pill exits back to
 * the normal app.
 *
 * First entry: the first time a device ever reaches the app THROUGH the sign-in/sign-up screens
 * (new account, access code, caregiver and doctor sessions alike), Help Mode opens itself on a
 * welcome card (`intro`) — once per device, tracked in AsyncStorage. A device that cold-starts
 * already signed in predates the feature (or has toured) and is seeded as seen silently instead.
 * app/_layout.tsx drives both calls off the route segments.
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import * as Haptics from "expo-haptics";
import { HELP_INTRO_SEEN_STORAGE_KEY } from "@/constants/storage-keys";
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
  /** True while the automatic first-entry welcome card shows (helpMode on, no tour started yet). */
  intro: boolean;
  /** Leaves the welcome card and starts the tour of the page currently on screen. */
  beginFromIntro: () => void;
  /** The floating tab bar's window frame (reported by the bar); null while the bar is hidden. */
  tabBarRect: SpotlightRect | null;
  /** First entry THROUGH sign-in/sign-up: open Help Mode automatically, once ever per device. */
  autoStartFirstEntry: () => void;
  /** App started already signed in: mark the device toured without showing anything. */
  markFirstEntrySeen: () => void;
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
  _reportTabBar: (rect: SpotlightRect | null) => void;
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
  const [intro, setIntro] = useState(false);
  const [tabBarRect, setTabBarRect] = useState<SpotlightRect | null>(null);
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
  const _reportTabBar = useCallback((r: SpotlightRect | null) => {
    setTabBarRect((prev) => {
      // The bar re-measures freely (layout, settle timer); identical frames keep the same object so
      // nothing re-renders.
      if (
        prev && r &&
        Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 &&
        Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
      ) {
        return prev;
      }
      return r;
    });
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
      setIntro(false); // any tour replaces the first-entry welcome card
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

  // The page the user is on (reported by useHelpPage), so Help can start that page's tour.
  const lastPath = useRef<string | null>(null);

  const enterHelp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setHelpMode(true);
    setIntro(false); // manual entry goes straight to the current page's tour
    clearTour();
    // The Help button lives on the Dashboard, so turning Help on starts the page you're on (the
    // Dashboard tour); its last step points to the tabs below.
    const page = lastPath.current ? HELP_PAGE_FOR_PATH[lastPath.current] : undefined;
    if (page) startTour(page);
  }, [clearTour, startTour]);

  const exitHelp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setHelpMode(false);
    setIntro(false);
    clearTour();
  }, [clearTour]);

  /** The first-entry welcome card's "tap anywhere": tour the page already on screen. */
  const beginFromIntro = useCallback(() => {
    const page = lastPath.current ? HELP_PAGE_FOR_PATH[lastPath.current] : undefined;
    if (page) startTour(page); // startTour clears the intro card
    else setIntro(false); // not on a scripted page somehow: fall back to the standard idle card
  }, [startTour]);

  /**
   * One automatic Help Mode per device, EVER (see the header). The in-memory guard makes the two
   * entry points below safe to call in any order and any number of times per app session; the
   * AsyncStorage flag makes that stick across launches.
   */
  const introHandled = useRef(false);

  const markFirstEntrySeen = useCallback(() => {
    if (introHandled.current) return;
    introHandled.current = true;
    AsyncStorage.setItem(HELP_INTRO_SEEN_STORAGE_KEY, "1").catch(() => {});
  }, []);

  const autoStartFirstEntry = useCallback(() => {
    if (introHandled.current) return;
    introHandled.current = true;
    void (async () => {
      try {
        if (await AsyncStorage.getItem(HELP_INTRO_SEEN_STORAGE_KEY)) return;
        await AsyncStorage.setItem(HELP_INTRO_SEEN_STORAGE_KEY, "1");
      } catch {
        return; // storage unreadable: skip, rather than risk auto-opening on every launch
      }
      // Let the tab pages mount and report their path and the first screen settle, then open on
      // the welcome card. No haptic: nothing the user did triggered this.
      setTimeout(() => {
        setHelpMode(true);
        clearTour();
        setIntro(true);
      }, 1100);
    })();
  }, [clearTour]);

  // Route changes drive tours: landing on a scripted page starts (or restarts) its tour from the
  // top; landing anywhere else (Dashboard) drops back to the idle card. Pages report their path
  // through useHelpPage so this works without a navigation-container dependency.
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
      intro,
      beginFromIntro,
      tabBarRect,
      autoStartFirstEntry,
      markFirstEntrySeen,
      activeEffects: step?.effects ?? [],
      isTouring,
      _registerAnchor,
      _registerScroll,
      _unregisterScroll,
      _reportPath,
      _reportTabBar,
    }),
    [helpMode, enterHelp, exitHelp, tour, step, script, rect, advance, intro, beginFromIntro, tabBarRect, autoStartFirstEntry, markFirstEntrySeen, isTouring, _registerAnchor, _registerScroll, _unregisterScroll, _reportPath, _reportTabBar],
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
