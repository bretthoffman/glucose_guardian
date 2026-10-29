/**
 * Time picking like the iOS alarm screen: an hour, minute and AM/PM wheel you spin, instead of
 * typing a time. Pure React Native (no native picker module), so it ships over the air.
 *
 * Two parts so any layout can use them:
 *  - `TimeButton`: the tappable time ("5:38 PM") that sits where the text box used to be.
 *  - `TimeWheel`: the three spinning columns, shown inline under the row while open.
 * Both read and write the same "5:38 PM" text the screens already parse (`parseTimeInputText`),
 * so how an entry is saved does not change.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import {
  WHEEL_HOURS,
  WHEEL_MINUTES,
  WHEEL_PERIODS,
  timeButtonLabel,
  wheelFromText,
  wheelIndexAt,
  wheelText,
  type WheelTime,
} from "@/utils/timeWheel";

type Palette = (typeof Colors)["light"];

const ROW = 40;
const VISIBLE = 5;
const PAD = ROW * Math.floor(VISIBLE / 2);

function WheelColumn({
  items,
  index,
  onChange,
  width,
  align,
  label,
  colors,
}: {
  items: readonly string[];
  index: number;
  onChange: (i: number) => void;
  width: number;
  align: "left" | "right" | "center";
  label: string;
  colors: Palette;
}) {
  const ref = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(index * ROW)).current;
  const shown = useRef(index); // row currently centered (drives the haptic tick)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);

  // Follow outside changes (e.g. a row tapped, or the value reset) when the user isn't spinning.
  useEffect(() => {
    if (dragging.current) return;
    ref.current?.scrollTo?.({ y: index * ROW, animated: true });
    shown.current = index;
  }, [index]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const settle = (y: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    dragging.current = false;
    const i = wheelIndexAt(y, ROW, items.length);
    if (Math.abs(y - i * ROW) > 0.5) ref.current?.scrollTo?.({ y: i * ROW, animated: true });
    if (i !== index) onChange(i);
  };

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: Platform.OS !== "web",
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const y = e.nativeEvent.contentOffset.y;
          const i = wheelIndexAt(y, ROW, items.length);
          if (i !== shown.current) {
            shown.current = i;
            void Haptics.selectionAsync().catch(() => {});
          }
          // Fallback settle for platforms without momentum events (and slow drags).
          if (settleTimer.current) clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => settle(y), 160);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, index],
  );

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index + delta));
    if (next !== index) onChange(next);
  };

  return (
    <View
      style={{ width, height: ROW * VISIBLE }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[index] }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
    >
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: index * ROW }}
        contentContainerStyle={{ paddingVertical: PAD }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      >
        {items.map((label, i) => {
          const inputRange = [(i - 2) * ROW, (i - 1) * ROW, i * ROW, (i + 1) * ROW, (i + 2) * ROW];
          const opacity = scrollY.interpolate({ inputRange, outputRange: [0.25, 0.5, 1, 0.5, 0.25], extrapolate: "clamp" });
          const scale = scrollY.interpolate({ inputRange, outputRange: [0.86, 0.93, 1, 0.93, 0.86], extrapolate: "clamp" });
          return (
            <Pressable key={label} onPress={() => onChange(i)} style={{ height: ROW, justifyContent: "center" }} importantForAccessibility="no">
              <Animated.Text
                allowFontScaling={false}
                style={[styles.wheelText, { color: colors.text, textAlign: align, opacity, transform: [{ scale }] }]}
              >
                {label}
              </Animated.Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const HOUR_LABELS = WHEEL_HOURS.map(String);
const MINUTE_LABELS = WHEEL_MINUTES.map((m) => String(m).padStart(2, "0"));

/** The three spinning columns. `value` / `onChange` use the screens' time text ("5:38 PM"). */
export function TimeWheel({
  value,
  onChange,
  onDone,
  colors,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Shows a Done button that closes the wheel. */
  onDone?: () => void;
  colors: Palette;
}) {
  const t = wheelFromText(value);
  const set = (patch: Partial<WheelTime>) => onChange(wheelText({ ...t, ...patch }));

  return (
    <View style={[styles.wheelWrap, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
      <View style={styles.wheelRow}>
        <View pointerEvents="none" style={[styles.band, { backgroundColor: colors.border }]} />
        <WheelColumn
          items={HOUR_LABELS}
          index={WHEEL_HOURS.indexOf(t.hour)}
          onChange={(i) => set({ hour: WHEEL_HOURS[i] })}
          width={64}
          align="right"
          label="Hour"
          colors={colors}
        />
        <WheelColumn
          items={MINUTE_LABELS}
          index={t.minute}
          onChange={(i) => set({ minute: WHEEL_MINUTES[i] })}
          width={70}
          align="center"
          label="Minute"
          colors={colors}
        />
        <WheelColumn
          items={WHEEL_PERIODS}
          index={WHEEL_PERIODS.indexOf(t.period)}
          onChange={(i) => set({ period: WHEEL_PERIODS[i] })}
          width={64}
          align="left"
          label="AM or PM"
          colors={colors}
        />
      </View>
      {onDone && (
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done choosing the time"
          style={({ pressed }) => [styles.doneBtn, { opacity: pressed ? 0.7 : 1 }]}
          hitSlop={8}
        >
          <Text style={[styles.doneText, { color: COLORS.primary }]}>Done</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The tappable time that replaces the old text box. Highlighted while its wheel is open. */
export function TimeButton({
  value,
  open,
  onPress,
  accessibilityLabel,
  colors,
}: {
  value: string;
  open: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  colors: Palette;
}) {
  const label = timeButtonLabel(value);
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}: ${label}`}
      accessibilityHint={open ? "Closes the time wheel" : "Opens a wheel to choose the time"}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [
        styles.timeBtn,
        {
          backgroundColor: colors.backgroundTertiary,
          borderColor: open ? COLORS.primary : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Feather name="clock" size={13} color={open ? COLORS.primary : colors.textMuted} />
      <Text style={[styles.timeBtnText, { color: open ? COLORS.primary : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wheelWrap: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    marginTop: 8,
    alignItems: "center",
  },
  wheelRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  band: { position: "absolute", left: 10, right: 10, top: PAD, height: ROW, borderRadius: 10 },
  wheelText: { fontSize: 23, fontWeight: "500", fontVariant: ["tabular-nums"], paddingHorizontal: 6 },
  doneBtn: { alignSelf: "flex-end", paddingHorizontal: 14, paddingVertical: 6 },
  doneText: { fontSize: 16, fontWeight: "700" },
  timeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  timeBtnText: { fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
