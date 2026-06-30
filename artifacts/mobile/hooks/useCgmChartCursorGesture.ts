import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, PanResponder, type GestureResponderEvent } from "react-native";
import {
  CGM_CHART_LONG_PRESS_MS,
  nearestReadingIndex,
  shouldCancelLongPressForScroll,
  isQuickTapGesture,
  type ChartPlotPoint,
} from "@/utils/cgmChartCursor";

interface Options {
  points: ChartPlotPoint[];
  onQuickTap: () => void;
  resetKey: string | number;
}

export function useCgmChartCursorGesture({ points, onQuickTap, resetKey }: Options) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const cursorActiveRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const suppressTapRef = useRef(false);
  const lastIndexRef = useRef<number | null>(null);
  const sortedXs = useMemo(() => points.map((p) => p.x), [points]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const dismissCursor = useCallback(() => {
    cursorActiveRef.current = false;
    lastIndexRef.current = null;
    setSelectedIndex(null);
  }, []);

  useEffect(() => {
    clearLongPressTimer();
    dismissCursor();
  }, [resetKey, clearLongPressTimer, dismissCursor]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        clearLongPressTimer();
        dismissCursor();
      }
    });
    return () => sub.remove();
  }, [clearLongPressTimer, dismissCursor]);

  const selectAtX = useCallback(
    (locationX: number, hapticOnChange: boolean) => {
      if (points.length === 0) return;
      const idx = nearestReadingIndex(sortedXs, locationX);
      if (idx < 0) return;
      setSelectedIndex((prev) => {
        if (prev !== idx && hapticOnChange) {
          Haptics.selectionAsync().catch(() => {});
        }
        lastIndexRef.current = idx;
        return idx;
      });
    },
    [points.length, sortedXs],
  );

  const activateCursorAt = useCallback(
    (locationX: number) => {
      if (points.length === 0) return;
      cursorActiveRef.current = true;
      selectAtX(locationX, false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [points.length, selectAtX],
  );

  const scheduleLongPress = useCallback(
    (locationX: number, locationY: number) => {
      clearLongPressTimer();
      touchStartRef.current = { x: locationX, y: locationY, time: Date.now() };
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        activateCursorAt(locationX);
      }, CGM_CHART_LONG_PRESS_MS);
    },
    [activateCursorAt, clearLongPressTimer],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => cursorActiveRef.current,
        onPanResponderTerminationRequest: () => !cursorActiveRef.current,
        onPanResponderMove: (evt: GestureResponderEvent) => {
          if (!cursorActiveRef.current) return;
          selectAtX(evt.nativeEvent.locationX, true);
        },
        onPanResponderRelease: () => {
          if (cursorActiveRef.current) {
            dismissCursor();
            suppressTapRef.current = true;
            setTimeout(() => {
              suppressTapRef.current = false;
            }, 120);
          }
        },
        onPanResponderTerminate: () => {
          clearLongPressTimer();
          dismissCursor();
        },
      }),
    [clearLongPressTimer, dismissCursor, selectAtX],
  );

  const touchHandlers = useMemo(
    () => ({
      onTouchStart: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        scheduleLongPress(locationX, locationY);
      },
      onTouchMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        if (cursorActiveRef.current) {
          selectAtX(locationX, true);
          return;
        }
        const dy = locationY - touchStartRef.current.y;
        if (shouldCancelLongPressForScroll(dy)) {
          clearLongPressTimer();
        }
      },
      onTouchEnd: (evt: GestureResponderEvent) => {
        clearLongPressTimer();
        if (cursorActiveRef.current) {
          dismissCursor();
          suppressTapRef.current = true;
          setTimeout(() => {
            suppressTapRef.current = false;
          }, 120);
          return;
        }
        const duration = Date.now() - touchStartRef.current.time;
        const dx = evt.nativeEvent.locationX - touchStartRef.current.x;
        const dy = evt.nativeEvent.locationY - touchStartRef.current.y;
        if (!suppressTapRef.current && isQuickTapGesture(duration, dx, dy)) {
          onQuickTap();
        }
      },
      onTouchCancel: () => {
        clearLongPressTimer();
        dismissCursor();
      },
    }),
    [clearLongPressTimer, dismissCursor, onQuickTap, scheduleLongPress, selectAtX],
  );

  const selectedPoint = selectedIndex != null ? points[selectedIndex] ?? null : null;

  return {
    selectedPoint,
    cursorActive: selectedPoint != null,
    panHandlers: panResponder.panHandlers,
    touchHandlers,
  };
}
