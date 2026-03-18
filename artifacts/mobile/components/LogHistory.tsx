import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";

const LOW = 70;
const HIGH = 180;

type TimeView = "day" | "week" | "month" | "year";

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDateFull(d: Date) {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function fmtMonth(d: Date) {
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}
function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function glucoseColor(g: number): string {
  if (g < LOW) return COLORS.danger;
  if (g > HIGH) return COLORS.warning;
  return COLORS.success;
}

interface DayEntry {
  ts: string;
  type: "glucose" | "food" | "insulin";
  glucose?: number;
  food?: FoodLogEntry;
  insulin?: InsulinLogEntry;
}

function buildDayEntries(
  glucose: GlucoseEntry[],
  food: FoodLogEntry[],
  insulin: InsulinLogEntry[],
  dayStart: Date,
): DayEntry[] {
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const inDay = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= dayStart.getTime() && t < dayEnd.getTime();
  };

  const entries: DayEntry[] = [
    ...glucose.filter((r) => inDay(r.timestamp)).map((r) => ({
      ts: r.timestamp,
      type: "glucose" as const,
      glucose: r.glucose,
    })),
    ...food.filter((f) => inDay(f.timestamp)).map((f) => ({
      ts: f.timestamp,
      type: "food" as const,
      food: f,
    })),
    ...insulin.filter((i) => inDay(i.timestamp)).map((i) => ({
      ts: i.timestamp,
      type: "insulin" as const,
      insulin: i,
    })),
  ];
  return entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

interface DaySummary {
  date: Date;
  avgBg: number | null;
  totalCarbs: number;
  totalInsulin: number;
  highs: number;
  lows: number;
  entries: DayEntry[];
}

function buildDaySummary(
  glucose: GlucoseEntry[],
  food: FoodLogEntry[],
  insulin: InsulinLogEntry[],
  date: Date,
): DaySummary {
  const dayStart = startOfDay(date);
  const entries = buildDayEntries(glucose, food, insulin, dayStart);
  const bgEntries = entries.filter((e) => e.type === "glucose" && e.glucose != null);
  const avgBg =
    bgEntries.length > 0
      ? Math.round(bgEntries.reduce((s, e) => s + (e.glucose ?? 0), 0) / bgEntries.length)
      : null;
  const totalCarbs = food
    .filter((f) => {
      const t = new Date(f.timestamp).getTime();
      return t >= dayStart.getTime() && t < dayStart.getTime() + 86400000;
    })
    .reduce((s, f) => s + f.estimatedCarbs, 0);
  const totalInsulin = insulin
    .filter((i) => {
      const t = new Date(i.timestamp).getTime();
      return t >= dayStart.getTime() && t < dayStart.getTime() + 86400000;
    })
    .reduce((s, i) => s + i.units, 0);
  const highs = bgEntries.filter((e) => (e.glucose ?? 0) > HIGH).length;
  const lows = bgEntries.filter((e) => (e.glucose ?? 0) < LOW).length;
  return { date, avgBg, totalCarbs, totalInsulin, highs, lows, entries };
}

export default function LogHistory({ colors, restrictToDay = false }: { colors: (typeof Colors)["light"]; restrictToDay?: boolean }) {
  const [view, setView] = useState<TimeView>("day");

  useEffect(() => {
    if (restrictToDay) setView("day");
  }, [restrictToDay]);

  const [dayOffset, setDayOffset] = useState(0);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { history: glucoseHistory } = useGlucose();
  const { foodLog, insulinLog } = useAuth();

  const today = useMemo(() => startOfDay(new Date()), []);

  const selectedDay = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    return d;
  }, [today, dayOffset]);

  const dayEntries = useMemo(
    () => buildDayEntries(glucoseHistory, foodLog, insulinLog, selectedDay),
    [glucoseHistory, foodLog, insulinLog, selectedDay],
  );

  const weekSummaries = useMemo<DaySummary[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return buildDaySummary(glucoseHistory, foodLog, insulinLog, d);
    });
  }, [glucoseHistory, foodLog, insulinLog, today]);

  const monthSummaries = useMemo<DaySummary[]>(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return buildDaySummary(glucoseHistory, foodLog, insulinLog, d);
    });
  }, [glucoseHistory, foodLog, insulinLog, today]);

  const yearSummaries = useMemo(() => {
    const months: { label: string; avgBg: number | null; avgCarbs: number; avgInsulin: number; days: number }[] = [];
    for (let m = 0; m < 12; m++) {
      const ref = new Date(today);
      ref.setDate(1);
      ref.setMonth(ref.getMonth() - m);
      const monthStart = startOfDay(ref);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const bgInMonth = glucoseHistory.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= monthStart.getTime() && t < monthEnd.getTime();
      });
      const foodInMonth = foodLog.filter((f) => {
        const t = new Date(f.timestamp).getTime();
        return t >= monthStart.getTime() && t < monthEnd.getTime();
      });
      const insulinInMonth = insulinLog.filter((i) => {
        const t = new Date(i.timestamp).getTime();
        return t >= monthStart.getTime() && t < monthEnd.getTime();
      });

      const daysInMonth = monthEnd.getDate() === 1
        ? (monthEnd.getTime() - monthStart.getTime()) / 86400000
        : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();

      const avgBg = bgInMonth.length > 0
        ? Math.round(bgInMonth.reduce((s, r) => s + r.glucose, 0) / bgInMonth.length)
        : null;
      const totalCarbs = foodInMonth.reduce((s, f) => s + f.estimatedCarbs, 0);
      const totalInsulin = insulinInMonth.reduce((s, i) => s + i.units, 0);

      months.push({
        label: monthStart.toLocaleDateString([], { month: "long", year: "numeric" }),
        avgBg,
        avgCarbs: daysInMonth > 0 ? Math.round(totalCarbs / daysInMonth) : 0,
        avgInsulin: daysInMonth > 0 ? Math.round((totalInsulin / daysInMonth) * 10) / 10 : 0,
        days: daysInMonth,
      });
    }
    return months;
  }, [glucoseHistory, foodLog, insulinLog, today]);

  const VIEW_TABS: { key: TimeView; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
  ];

  return (
    <View style={{ flex: 1 }}>
      {!restrictToDay && (
      <View style={[styles.viewTabs, { borderBottomColor: colors.border }]}>
        {VIEW_TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.viewTab, view === t.key && { borderBottomColor: COLORS.primary, borderBottomWidth: 2 }]}
            onPress={() => setView(t.key)}
          >
            <Text style={[styles.viewTabText, { color: view === t.key ? COLORS.primary : colors.textSecondary }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {view === "day" && (
          <DayView
            entries={dayEntries}
            day={selectedDay}
            dayOffset={dayOffset}
            onPrev={() => setDayOffset((p) => p + 1)}
            onNext={() => setDayOffset((p) => Math.max(0, p - 1))}
            colors={colors}
          />
        )}
        {view === "week" && (
          <WeekView
            summaries={weekSummaries}
            expandedDay={expandedDay}
            onToggle={(key) => setExpandedDay((p) => (p === key ? null : key))}
            colors={colors}
          />
        )}
        {view === "month" && (
          <MonthView summaries={monthSummaries} colors={colors} />
        )}
        {view === "year" && (
          <YearView months={yearSummaries} colors={colors} />
        )}
      </ScrollView>
    </View>
  );
}

function sectionSummary(entries: DayEntry[]): string {
  const bgs = entries.filter((e) => e.type === "glucose" && e.glucose != null).map((e) => e.glucose as number);
  const meals = entries.filter((e) => e.type === "food").length;
  const insulin = entries.filter((e) => e.type === "insulin").length;
  const avgBg = bgs.length > 0 ? Math.round(bgs.reduce((s, v) => s + v, 0) / bgs.length) : null;
  const parts: string[] = [];
  if (bgs.length > 0) parts.push(`${bgs.length} readings${avgBg != null ? ` · avg ${avgBg}` : ""}`);
  if (meals > 0) parts.push(`${meals} meal${meals !== 1 ? "s" : ""}`);
  if (insulin > 0) parts.push(`${insulin} dose${insulin !== 1 ? "s" : ""}`);
  return parts.join(" · ") || `${entries.length} entries`;
}

function DayView({
  entries,
  day,
  dayOffset,
  onPrev,
  onNext,
  colors,
}: {
  entries: DayEntry[];
  day: Date;
  dayOffset: number;
  onPrev: () => void;
  onNext: () => void;
  colors: (typeof Colors)["light"];
}) {
  const isToday = dayOffset === 0;
  const label = isToday ? "Today" : dayOffset === 1 ? "Yesterday" : fmtDateFull(day);

  const groupedByHour = useMemo(() => {
    const groups: Record<string, DayEntry[]> = {};
    for (const e of entries) {
      const h = new Date(e.ts).getHours();
      const bucket = h < 6 ? "Night (12–6am)" : h < 12 ? "Morning (6am–12pm)" : h < 17 ? "Afternoon (12–5pm)" : h < 21 ? "Evening (5–9pm)" : "Night (9pm+)";
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(e);
    }
    const order = ["Evening (5–9pm)", "Night (9pm+)", "Afternoon (12–5pm)", "Morning (6am–12pm)", "Night (12–6am)"];
    return order.filter((k) => groups[k]).map((k) => ({ label: k, entries: groups[k] }));
  }, [entries]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    if (groupedByHour.length === 0) return new Set();
    return new Set([groupedByHour[0].label]);
  });

  function toggleSection(label: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) { next.delete(label); } else { next.add(label); }
      return next;
    });
  }

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

      {entries.length === 0 ? (
        <View style={[styles.emptyCard, { borderColor: colors.border }]}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No entries yet</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            Log meals and insulin or sync your CGM to see entries here.
          </Text>
        </View>
      ) : (
        groupedByHour.map((group) => {
          const isExpanded = expandedSections.has(group.label);
          return (
            <View key={group.label} style={{ gap: 8 }}>
              <Pressable
                onPress={() => toggleSection(group.label)}
                style={[styles.sectionToggleRow, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
              >
                <Text style={[styles.groupLabel, { color: colors.textSecondary, marginTop: 0, flex: 1 }]}>{group.label}</Text>
                {!isExpanded && (
                  <Text style={[styles.sectionSummary, { color: colors.textMuted }]}>
                    {sectionSummary(group.entries)}
                  </Text>
                )}
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>
              {isExpanded && group.entries.map((entry) => (
                <EntryRow key={`${entry.type}-${entry.ts}`} entry={entry} colors={colors} />
              ))}
            </View>
          );
        })
      )}
    </View>
  );
}

function EntryRow({ entry, colors }: { entry: DayEntry; colors: (typeof Colors)["light"] }) {
  if (entry.type === "glucose" && entry.glucose != null) {
    const col = glucoseColor(entry.glucose);
    return (
      <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: col + "40" }]}>
        <View style={[styles.entryIcon, { backgroundColor: col + "18" }]}>
          <Text style={{ fontSize: 16 }}>🩸</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.entryTitle, { color: colors.text }]}>
            {entry.glucose} mg/dL
          </Text>
          <Text style={[styles.entrySub, { color: colors.textSecondary }]}>
            Blood Glucose · {fmtTime(entry.ts)}
          </Text>
        </View>
        <View style={[styles.bgPill, { backgroundColor: col }]}>
          <Text style={styles.bgPillText}>
            {entry.glucose < LOW ? "LOW" : entry.glucose > HIGH ? "HIGH" : "OK"}
          </Text>
        </View>
      </View>
    );
  }
  if (entry.type === "food" && entry.food) {
    return (
      <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.accent + "40" }]}>
        <View style={[styles.entryIcon, { backgroundColor: COLORS.accent + "18" }]}>
          <Text style={{ fontSize: 16 }}>🍽️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.entryTitle, { color: colors.text }]} numberOfLines={1}>
            {entry.food.foodName}
          </Text>
          <Text style={[styles.entrySub, { color: colors.textSecondary }]}>
            {entry.food.estimatedCarbs}g carbs · {entry.food.insulinUnits}u · {fmtTime(entry.ts)}
          </Text>
        </View>
      </View>
    );
  }
  if (entry.type === "insulin" && entry.insulin) {
    return (
      <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.primary + "40" }]}>
        <View style={[styles.entryIcon, { backgroundColor: COLORS.primary + "18" }]}>
          <Text style={{ fontSize: 16 }}>💉</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.entryTitle, { color: colors.text }]}>
            {entry.insulin.units}u {entry.insulin.type}
          </Text>
          <Text style={[styles.entrySub, { color: colors.textSecondary }]} numberOfLines={1}>
            {entry.insulin.note ? `${entry.insulin.note} · ` : ""}{fmtTime(entry.ts)}
          </Text>
        </View>
      </View>
    );
  }
  return null;
}

function WeekView({
  summaries,
  expandedDay,
  onToggle,
  colors,
}: {
  summaries: DaySummary[];
  expandedDay: string | null;
  onToggle: (key: string) => void;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionHeader, { color: colors.text }]}>Last 7 Days</Text>
      {summaries.map((s) => {
        const key = s.date.toDateString();
        const isExpanded = expandedDay === key;
        const isToday = key === new Date().toDateString();
        return (
          <View key={key} style={[styles.weekCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable style={styles.weekCardHeader} onPress={() => onToggle(key)}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.weekDayName, { color: colors.text }]}>
                  {isToday ? "Today" : fmtDateFull(s.date)}
                </Text>
                <View style={styles.weekStats}>
                  {s.avgBg != null && (
                    <View style={[styles.weekStatPill, { backgroundColor: glucoseColor(s.avgBg) + "20" }]}>
                      <Text style={[styles.weekStatText, { color: glucoseColor(s.avgBg) }]}>
                        🩸 {s.avgBg}
                      </Text>
                    </View>
                  )}
                  {s.totalCarbs > 0 && (
                    <View style={[styles.weekStatPill, { backgroundColor: COLORS.accent + "18" }]}>
                      <Text style={[styles.weekStatText, { color: COLORS.accent }]}>
                        🍽️ {s.totalCarbs}g
                      </Text>
                    </View>
                  )}
                  {s.totalInsulin > 0 && (
                    <View style={[styles.weekStatPill, { backgroundColor: COLORS.primary + "18" }]}>
                      <Text style={[styles.weekStatText, { color: COLORS.primary }]}>
                        💉 {s.totalInsulin}u
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.weekBadges}>
                {s.highs > 0 && (
                  <View style={[styles.eventBadge, { backgroundColor: COLORS.warning + "25" }]}>
                    <Text style={[styles.eventBadgeText, { color: COLORS.warning }]}>↑{s.highs}</Text>
                  </View>
                )}
                {s.lows > 0 && (
                  <View style={[styles.eventBadge, { backgroundColor: COLORS.danger + "25" }]}>
                    <Text style={[styles.eventBadgeText, { color: COLORS.danger }]}>↓{s.lows}</Text>
                  </View>
                )}
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textSecondary}
                />
              </View>
            </Pressable>

            {isExpanded && s.entries.length > 0 && (
              <View style={[styles.expandedEntries, { borderTopColor: colors.border }]}>
                {s.entries.map((e) => (
                  <EntryRow key={`${e.type}-${e.ts}`} entry={e} colors={colors} />
                ))}
              </View>
            )}
            {isExpanded && s.entries.length === 0 && (
              <View style={[styles.expandedEntries, { borderTopColor: colors.border }]}>
                <Text style={[styles.entrySub, { color: colors.textSecondary, textAlign: "center", paddingVertical: 8 }]}>
                  No entries for this day.
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function MonthView({ summaries, colors }: { summaries: DaySummary[]; colors: (typeof Colors)["light"] }) {
  const weeks = useMemo(() => {
    const rows: DaySummary[][] = [];
    for (let i = 0; i < summaries.length; i += 7) {
      rows.push(summaries.slice(i, i + 7).reverse());
    }
    return rows;
  }, [summaries]);

  return (
    <View style={{ gap: 16 }}>
      <Text style={[styles.sectionHeader, { color: colors.text }]}>Last 30 Days</Text>
      <View style={[styles.legendRow]}>
        {[{ col: COLORS.success, label: "In Range" }, { col: COLORS.warning, label: "High" }, { col: COLORS.danger, label: "Low" }, { col: colors.backgroundTertiary, label: "No Data" }].map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.col }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>{l.label}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calWeek}>
          {week.map((s) => {
            const dotColor = s.avgBg == null
              ? colors.backgroundTertiary
              : s.avgBg < LOW
              ? COLORS.danger
              : s.avgBg > HIGH
              ? COLORS.warning
              : COLORS.success;
            const isToday = s.date.toDateString() === new Date().toDateString();
            return (
              <View key={s.date.toDateString()} style={styles.calCell}>
                <View style={[styles.calDot, { backgroundColor: dotColor, borderWidth: isToday ? 2 : 0, borderColor: COLORS.primary }]} />
                <Text style={[styles.calDate, { color: colors.textSecondary }]}>
                  {s.date.getDate()}
                </Text>
                {s.totalCarbs > 0 && (
                  <Text style={[styles.calMini, { color: colors.textMuted }]}>{s.totalCarbs}g</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function YearView({
  months,
  colors,
}: {
  months: { label: string; avgBg: number | null; avgCarbs: number; avgInsulin: number; days: number }[];
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionHeader, { color: colors.text }]}>Last 12 Months</Text>
      {months.map((m) => (
        <View key={m.label} style={[styles.yearCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.yearMonth, { color: colors.text }]}>{m.label}</Text>
          <View style={styles.yearStats}>
            <YearStat
              icon="🩸"
              label="Avg BG"
              value={m.avgBg != null ? `${m.avgBg}` : "—"}
              unit="mg/dL"
              color={m.avgBg != null ? glucoseColor(m.avgBg) : colors.textSecondary}
            />
            <View style={[styles.yearDivider, { backgroundColor: colors.border }]} />
            <YearStat icon="🍽️" label="Avg Carbs" value={`${m.avgCarbs}`} unit="g/day" color={COLORS.accent} />
            <View style={[styles.yearDivider, { backgroundColor: colors.border }]} />
            <YearStat icon="💉" label="Avg Insulin" value={`${m.avgInsulin}`} unit="u/day" color={COLORS.primary} />
          </View>
        </View>
      ))}
    </View>
  );
}

function YearStat({ icon, label, value, unit, color }: { icon: string; label: string; value: string; unit: string; color: string }) {
  return (
    <View style={styles.yearStatBox}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={[styles.yearStatValue, { color }]}>{value}</Text>
      <Text style={styles.yearStatUnit}>{unit}</Text>
      <Text style={styles.yearStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  viewTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  viewTabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  scroll: { padding: 16, paddingBottom: 40 },

  dayNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { padding: 8 },
  dayLabel: { fontSize: 18, fontFamily: "Inter_700Bold" },

  groupLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  sectionToggleRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  sectionSummary: { fontSize: 11, fontFamily: "Inter_400Regular", flexShrink: 1 },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  entryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  entryTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  entrySub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  bgPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  bgPillText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  sectionHeader: { fontSize: 18, fontFamily: "Inter_700Bold" },

  weekCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  weekCardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  weekDayName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  weekStats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  weekStatPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  weekStatText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  weekBadges: { flexDirection: "row", alignItems: "center", gap: 6 },
  eventBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  eventBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  expandedEntries: { borderTopWidth: 1, padding: 12, gap: 8 },

  legendRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },

  calWeek: { flexDirection: "row", gap: 6 },
  calCell: { flex: 1, alignItems: "center", gap: 3 },
  calDot: { width: 22, height: 22, borderRadius: 11 },
  calDate: { fontSize: 10, fontFamily: "Inter_500Medium" },
  calMini: { fontSize: 9, fontFamily: "Inter_400Regular" },

  yearCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  yearMonth: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 12 },
  yearStats: { flexDirection: "row", alignItems: "center" },
  yearStatBox: { flex: 1, alignItems: "center", gap: 2 },
  yearStatValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  yearStatUnit: { fontSize: 9, fontFamily: "Inter_400Regular", color: "#888" },
  yearStatLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#888" },
  yearDivider: { width: 1, height: 40, marginHorizontal: 4 },
});
