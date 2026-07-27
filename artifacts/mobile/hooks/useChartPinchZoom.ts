import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View, type GestureResponderEvent } from "react-native";
import {
  pinchZoomWindow,
  zoomFactor,
  type ZoomWindow,
} from "@/utils/chartPinchZoom";

/**
 * Two-finger pinch zoom for the Log page's calendar-day chart. Lives on a wrapper AROUND the
 * plot view (the plot's own PanResponder drives the reading cursor) and claims the gesture in
 * the CAPTURE phase the moment a second finger lands, refusing termination so the host
 * ScrollView cannot steal the pinch mid-gesture. Single-finger behaviors (tap to toggle
 * line/dots, long-press cursor, page scroll) pass through untouched.
 */
export function useChartPinchZoom(params: {
  enabled: boolean;
  /** Full-day bounds — the maximum zoom-out. */
  day: ZoomWindow | null;
  plotW: number;
}) {
  const { enabled, day, plotW } = params;
  const [window, setWindow] = useState<ZoomWindow | null>(null);
  const [pinchActive, setPinchActive] = useState(false);

  const wrapperRef = useRef<View | null>(null);
  const wrapperPageXRef = useRef(0);
  /** Gesture-start snapshot; null between pinches (or while only one finger remains down). */
  const baselineRef = useRef<{ dist0: number; focalX0: number; window0: ZoomWindow } | null>(null);
  const windowRef = useRef<ZoomWindow | null>(null);
  windowRef.current = window;
  const dayRef = useRef<ZoomWindow | null>(day);
  dayRef.current = day;
  const plotWRef = useRef(plotW);
  plotWRef.current = plotW;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Flipping to another day always starts back at the full 24-hour view.
  const dayKey = day ? `${day.startMs}-${day.endMs}` : "none";
  useEffect(() => {
    setWindow(null);
    baselineRef.current = null;
  }, [dayKey]);

  const measureWrapper = () => {
    wrapperRef.current?.measureInWindow((x) => {
      if (Number.isFinite(x)) wrapperPageXRef.current = x;
    });
  };

  const panHandlers = useMemo(() => {
    const isPinchTouch = (evt: GestureResponderEvent) =>
      enabledRef.current && dayRef.current != null && evt.nativeEvent.touches.length >= 2;

    const applyPinch = (evt: GestureResponderEvent) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length < 2) {
        // A finger lifted mid-gesture — freeze here; a returning finger starts a fresh baseline.
        baselineRef.current = null;
        return;
      }
      const [a, b] = touches;
      const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      const focalX = Math.max(
        0,
        Math.min(plotWRef.current, (a.pageX + b.pageX) / 2 - wrapperPageXRef.current),
      );
      const day = dayRef.current;
      if (!day || dist <= 0) return;
      if (!baselineRef.current) {
        baselineRef.current = { dist0: dist, focalX0: focalX, window0: windowRef.current ?? day };
        return;
      }
      const { dist0, focalX0, window0 } = baselineRef.current;
      const next = pinchZoomWindow({
        day,
        startWindow: window0,
        plotW: plotWRef.current,
        focalX0,
        focalX,
        dist0,
        dist,
      });
      setWindow((prev) => {
        if (prev === next) return prev;
        if (prev && next && prev.startMs === next.startMs && prev.endMs === next.endMs) return prev;
        return next;
      });
    };

    const endPinch = () => {
      baselineRef.current = null;
      setPinchActive(false);
    };

    return PanResponder.create({
      onStartShouldSetPanResponderCapture: isPinchTouch,
      onMoveShouldSetPanResponderCapture: isPinchTouch,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        measureWrapper();
        setPinchActive(true);
        applyPinch(evt);
      },
      onPanResponderMove: applyPinch,
      onPanResponderRelease: endPinch,
      onPanResponderTerminate: endPinch,
    }).panHandlers;
  }, []);

  const zoom = day ? zoomFactor(day, window) : 1;

  /** Spread onto a View wrapping the plot exactly (same width/height). */
  const wrapperProps = enabled
    ? {
        ref: wrapperRef,
        onLayout: measureWrapper,
        collapsable: false as const,
        ...panHandlers,
      }
    : {};

  return { zoomWindow: enabled ? window : null, zoom: enabled ? zoom : 1, pinchActive, wrapperProps };
}
