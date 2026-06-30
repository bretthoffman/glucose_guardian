import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { T } from "@/constants/theme";
import { CGMChart } from "@/components/CGMChart";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import { useDayGlucoseReadings } from "@/hooks/useDayGlucoseReadings";
import { filterFoodLogsForDay, filterInsulinLogsForDay } from "@/utils/logDayEntries";
import { startOfLocalDay } from "@/utils/localDayBoundaries";

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateFull(d: Date) {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Dose Log — daily historical glucose graph and day-scoped food/insulin lists. */
export default function LogHistory({
  colors,
  restrictToDay: _restrictToDay = false,
}: {
  colors: (typeof Colors)["light"];
  /** @deprecated Daily-only Log mode; prop retained for caregiver call sites. */
  restrictToDay?: boolean;
}) {
  const [dayOffset, setDayOffset] = useState(0);

  const { targetGlucose } = useGlucose();
  const { foodLog, insulinLog, alertPrefs } = useAuth();

  const today = useMemo(() => startOfLocalDay(new Date()), []);

  const selectedDay = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    return d;
  }, [today, dayOffset]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <DayView
          day={selectedDay}
          dayOffset={dayOffset}
          onPrev={() => setDayOffset((p) => p + 1)}
          onNext={() => setDayOffset((p) => Math.max(0, p - 1))}
          colors={colors}
          targetGlucose={targetGlucose}
          alertPrefs={alertPrefs}
          foodLog={foodLog}
          insulinLog={insulinLog}
        />
      </ScrollView>
    </View>
  );
}

function DayView({
  day,
  dayOffset,
  onPrev,
  onNext,
  colors,
  targetGlucose,
  alertPrefs,
  foodLog,
  insulinLog,
}: {
  day: Date;
  dayOffset: number;
  onPrev: () => void;
  onNext: () => void;
  colors: (typeof Colors)["light"];
  targetGlucose: number;
  alertPrefs: {
    urgentLowThreshold: number;
    lowThreshold: number;
    highThreshold: number;
    urgentHighThreshold: number;
  };
  foodLog: FoodLogEntry[];
  insulinLog: InsulinLogEntry[];
}) {
  const isToday = dayOffset === 0;
  const label = isToday ? "Today" : dayOffset === 1 ? "Yesterday" : fmtDateFull(day);

  const { readings, status, bounds, retry } = useDayGlucoseReadings({
    enabled: true,
    dayOffset,
    selectedDay: day,
  });

  const dayFood = useMemo(
    () => filterFoodLogsForDay(foodLog, bounds.startMs, bounds.endMs),
    [foodLog, bounds.startMs, bounds.endMs],
  );

  const dayInsulin = useMemo(
    () => filterInsulinLogsForDay(insulinLog, bounds.startMs, bounds.endMs),
    [insulinLog, bounds.startMs, bounds.endMs],
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.dayNav}>
        <Pressable style={styles.navBtn} onPress={onPrev}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={[styles.dayLabel, { color: colors.text }]}>{label}</Text>
        <Pressable style={[styles.navBtn, { opacity: isToday ? 0.3 : 1 }]} onPress={onNext} disabled={isToday}>
          <Feather name="chevron-right" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.graphSection}>
        {status === "loading" ? (
          <View style={[styles.graphLoading, { borderColor: colors.border }]}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : status === "error" ? (
          <View style={[styles.graphLoading, { borderColor: colors.border }]}>
            <Text style={[styles.emptySub, { color: colors.textSecondary, marginBottom: 8 }]}>
              Could not load glucose for this day.
            </Text>
            <Pressable onPress={retry} style={[styles.retryBtn, { borderColor: COLORS.primary }]}>
              <Text style={{ color: COLORS.primary, fontWeight: "600" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <CGMChart
            readings={readings}
            targetGlucose={targetGlucose}
            chartHeight={240}
            paddingHorizontal={20}
            urgentLowThreshold={alertPrefs.urgentLowThreshold}
            lowThreshold={alertPrefs.lowThreshold}
            highThreshold={alertPrefs.highThreshold}
            urgentHighThreshold={alertPrefs.urgentHighThreshold}
            calendarDayWindow={{ startMs: bounds.startMs, endMs: bounds.endMs }}
            showRangeSelector={false}
          />
        )}
      </View>

      <Text style={[styles.logSectionTitle, { color: colors.text }]}>Food Log</Text>
      {dayFood.length === 0 ? (
        <Text style={[styles.logEmptyText, { color: colors.textMuted }]}>No food logged for this day.</Text>
      ) : (
        dayFood.map((food) => (
          <FoodLogRow key={food.id} food={food} colors={colors} />
        ))
      )}

      {dayInsulin.length > 0 && (
        <>
          <Text style={[styles.logSectionTitle, { color: colors.text, marginTop: T.space.sm }]}>Insulin Log</Text>
          {dayInsulin.map((insulin) => (
            <InsulinLogRow key={insulin.id} insulin={insulin} colors={colors} />
          ))}
        </>
      )}
    </View>
  );
}

function FoodLogRow({ food, colors }: { food: FoodLogEntry; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.accent + "40" }]}>
      <View style={[styles.entryIcon, { backgroundColor: COLORS.accent + "18" }]}>
        <Text style={{ fontSize: 16 }}>🍽️</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: colors.text }]} numberOfLines={1}>
          {food.foodName}
        </Text>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]}>
          {food.estimatedCarbs}g carbs · {food.insulinUnits}u · {fmtTime(food.timestamp)}
        </Text>
      </View>
    </View>
  );
}

function InsulinLogRow({ insulin, colors }: { insulin: InsulinLogEntry; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.primary + "40" }]}>
      <View style={[styles.entryIcon, { backgroundColor: COLORS.primary + "18" }]}>
        <Text style={{ fontSize: 16 }}>💉</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: colors.text }]}>
          {insulin.units}u {insulin.type}
        </Text>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]} numberOfLines={1}>
          {insulin.note ? `${insulin.note} · ` : ""}{fmtTime(insulin.timestamp)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },

  dayNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { padding: 8 },
  dayLabel: { fontSize: 18, fontWeight: "700" },

  graphSection: { marginTop: 4 },
  graphLoading: {
    height: 240,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  logSectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: T.space.md,
    marginBottom: T.space.sm,
  },
  logEmptyText: {
    fontSize: 14,
    fontWeight: "400",
    marginBottom: T.space.sm,
  },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  entryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  entryTitle: { fontSize: 14, fontWeight: "600" },
  entrySub: { fontSize: 12, fontWeight: "400", marginTop: 1 },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },
});
