/**
 * The Day Recap (convex/schoolRecap):
 * - DayRecapPanel: the caregiver's screen (the school nurse). A preview of the day built from this
 *   phone's readings and logs, an optional note, and Send now or Send when the school hours end.
 * - DayRecapPrompt: the parent's sheet. Pops up once when a recap arrives (the push brings them here),
 *   built from the parent's own readings and logs for the same hours, with the nurse's note.
 */
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { fmtClock, useHandoffLogs, useHandoffViewer } from "@/components/HandoffSheet";
import { AccentShade, CardShade } from "@/components/Shade";
import { useWhatsNewBusy } from "@/components/WhatsNew";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useTheme } from "@/context/ThemeContext";
import { useCareCode, useCarePlanArgs } from "@/hooks/useCareCode";
import { api } from "@/utils/convex-auth-client";
import { dayRecapItems, dayRecapStats, type DayRecapItem, type DayRecapStats } from "@/utils/dayRecap";
import { firstName } from "@/utils/handoff";
import { holdSheet, sheetHeldByOther, useSheetHolder } from "@/utils/sheetLock";
import { RECAP_NOTE_MAX } from "../../../convex/carePlanLogic";

type Palette = (typeof Colors)["light"];
const tzOffset = () => -new Date().getTimezoneOffset();

function useRecapData(startMs: number, endMs: number) {
  const viewer = useHandoffViewer();
  const logs = useHandoffLogs(viewer);
  const { history } = useGlucose();
  return useMemo(() => {
    const readings = history.map((h) => ({ glucose: h.glucose, timestamp: h.timestamp }));
    return { stats: dayRecapStats(readings, startMs, endMs), items: dayRecapItems(logs, startMs, endMs, fmtClock) };
  }, [history, logs, startMs, endMs]);
}

function Stats({ stats, colors }: { stats: DayRecapStats; colors: Palette }) {
  const tile = (label: string, value: string, color: string) => (
    <View style={[styles.tile, { backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.tileLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
    </View>
  );
  return (
    <View style={styles.tiles}>
      {tile("IN RANGE", stats.inRangePct == null ? "--" : `${stats.inRangePct}%`, COLORS.success)}
      {tile("LOWS", String(stats.lows), stats.lows > 0 ? COLORS.danger : colors.text)}
      {tile("HIGHEST", stats.highest == null ? "--" : String(stats.highest), colors.text)}
    </View>
  );
}

const ICON: Record<DayRecapItem["icon"], { name: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; color: string }> = {
  insulin: { name: "needle", color: "#A99BFF" },
  meal: { name: "silverware-fork-knife", color: "#FF9F1C" },
  stick: { name: "water-plus-outline", color: "#5CB8FF" },
  low: { name: "arrow-down", color: "#FF6B66" },
};

function Items({ items, colors }: { items: DayRecapItem[]; colors: Palette }) {
  if (items.length === 0) return <Text style={[styles.sub, { color: colors.textSecondary }]}>Nothing logged during these hours.</Text>;
  return (
    <View>
      {items.map((it, i) => (
        <View key={`${it.atMs}${i}`} style={[styles.itemRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={[styles.itemIcon, { backgroundColor: ICON[it.icon].color + "2E" }]}>
            <MaterialCommunityIcons name={ICON[it.icon].name} size={16} color={ICON[it.icon].color} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
              {it.title}
            </Text>
            <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {it.sub}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const hoursLabel = (startMs: number, endMs: number) => `${fmtClock(startMs)} to ${fmtClock(endMs)}`;

// ── Caregiver ────────────────────────────────────────────────────────────────────────────────────

export function DayRecapPanel({ colors }: { colors: Palette }) {
  const code = useCareCode();
  const [tz] = useState(tzOffset);
  const data = useQuery(api.schoolRecap.forCaregiver, code ? { code, tzOffsetMinutes: tz } : "skip");
  const send = useMutation(api.schoolRecap.send);
  const cancel = useMutation(api.schoolRecap.cancel);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const startMs = data?.window.startMs ?? nowMs;
  const endMs = data?.window.endMs ?? nowMs;
  const { stats, items } = useRecapData(startMs, Math.min(endMs, nowMs));

  if (!code) return null;
  if (data === undefined) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 30 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Day Recap</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>You can send a recap during the hours your code works.</Text>
      </View>
    );
  }

  const latest = data.latest;
  const waiting = latest && latest.sentAt == null;
  const endsLater = endMs > nowMs;
  const doSend = async (sendNow: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await send({ code, tzOffsetMinutes: tz, note, sendNow });
      setNote("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={{ gap: 3 }}>
        <Text style={[styles.title, { color: colors.text }]}>{data.childName}'s Day Recap</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {hoursLabel(startMs, endMs)}. Goes to {data.childName}'s parents.
        </Text>
      </View>

      {latest && (
        <View style={[styles.status, { backgroundColor: (waiting ? COLORS.primary : COLORS.success) + "1F", borderColor: (waiting ? COLORS.primary : COLORS.success) + "55" }]}>
          <Feather name={waiting ? "clock" : "check-circle"} size={16} color={waiting ? COLORS.primary : COLORS.success} />
          <Text style={[styles.statusText, { color: colors.text }]}>
            {waiting
              ? `Goes out at ${fmtClock(latest.sendAt)}.`
              : `Sent at ${fmtClock(latest.sentAt!)}.${latest.seen.length ? ` ${latest.seen.map((s) => `${firstName(s.name)} saw it at ${fmtClock(s.at)}`).join(". ")}.` : " Not seen yet."}`}
          </Text>
          {waiting && (
            <Pressable accessibilityRole="button" onPress={() => void cancel({ code, id: latest.id })} hitSlop={8}>
              <Text style={[styles.link, { color: COLORS.primary }]}>Take it back</Text>
            </Pressable>
          )}
        </View>
      )}

      <Stats stats={stats} colors={colors} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>WHAT HAPPENED</Text>
      <Items items={items} colors={colors} />

      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>ADD A NOTE (OPTIONAL)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything the parents should know"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={RECAP_NOTE_MAX}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
          accessibilityLabel="Note for the parents"
        />
      </View>

      <View style={styles.buttons}>
        {endsLater && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void doSend(false)}
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.backgroundTertiary, opacity: pressed || busy ? 0.8 : 1 }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Send at {fmtClock(endMs)}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void doSend(true)}
          style={({ pressed }) => [styles.btn, { backgroundColor: COLORS.primary, overflow: "hidden", opacity: pressed || busy ? 0.8 : 1 }]}
        >
          <AccentShade radius={13} />
          <Text style={[styles.btnText, { color: "#fff" }]}>{busy ? "Sending..." : "Send now"}</Text>
        </Pressable>
      </View>
      {!!error && <Text style={[styles.sub, { color: COLORS.danger, textAlign: "center" }]}>{error}</Text>}
    </View>
  );
}

// ── Parent ───────────────────────────────────────────────────────────────────────────────────────

export function DayRecapPrompt() {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { isLoading, profile, accessLock } = useAuth();
  const args = useCarePlanArgs();
  const family = !!args && !args.code;
  const recap = useQuery(api.schoolRecap.forFamily, family ? {} : "skip");
  const markSeen = useMutation(api.schoolRecap.markSeen);
  const whatsNewBusy = useWhatsNewBusy();
  const holder = useSheetHolder();
  const [closedId, setClosedId] = useState<string | null>(null);

  const ready = !isLoading && !accessLock && !!profile && !whatsNewBusy && holder !== "handoff";
  const open = !!recap && !recap.seenByMe && closedId !== recap.id && ready && !sheetHeldByOther("dayRecap");
  useEffect(() => {
    holdSheet("dayRecap", open);
    return () => holdSheet("dayRecap", false);
  }, [open]);

  const startMs = recap?.windowStartMs ?? 0;
  const endMs = recap ? Math.min(recap.windowEndMs, recap.sentAt) : 0;
  const { stats, items } = useRecapData(startMs, endMs);
  if (!recap) return null;

  const childName = profile?.childName?.trim() || "your child";
  const close = (then?: () => void) => {
    setClosedId(recap.id);
    markSeen({ id: recap.id }).catch(() => {});
    then?.();
  };

  return (
    <DashboardSectionModal visible={open} onClose={() => close()} accessibilityLabel="Day recap">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <View style={{ gap: 4 }}>
          <Text style={[styles.kicker, { color: colors.textMuted }]}>
            FROM {firstName(recap.fromName).toUpperCase()} · {hoursLabel(startMs, recap.windowEndMs).toUpperCase()}
          </Text>
          <Text style={[styles.heading, { color: colors.text }]}>Here's {childName}'s day.</Text>
        </View>
        <Stats stats={stats} colors={colors} />
        <Items items={items} colors={colors} />
        {!!recap.note && (
          <View style={[styles.noteBox, { backgroundColor: COLORS.primary + "1A", borderColor: COLORS.primary + "4D" }]}>
            <Text style={[styles.label, { color: COLORS.primaryLight }]}>FROM {firstName(recap.fromName).toUpperCase()}</Text>
            <Text style={[styles.noteText, { color: colors.text }]}>{recap.note}</Text>
          </View>
        )}
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => close(() => router.push({ pathname: "/(tabs)/chat", params: { openMessages: String(Date.now()) } }))}
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>Reply to {firstName(recap.fromName)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => close()}
            style={({ pressed }) => [styles.btn, { backgroundColor: COLORS.primary, overflow: "hidden", opacity: pressed ? 0.8 : 1 }]}
          >
            <AccentShade radius={13} />
            <Text style={[styles.btnText, { color: "#fff" }]}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  title: { fontSize: 19, fontWeight: "800" },
  heading: { fontSize: 23, fontWeight: "800" },
  kicker: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8 },
  sub: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  link: { fontSize: 13.5, fontWeight: "700" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, borderRadius: 12, padding: 10, gap: 2 },
  tileLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  tileValue: { fontSize: 20, fontWeight: "800" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  itemIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 15, fontWeight: "700" },
  itemSub: { fontSize: 12.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, lineHeight: 21, minHeight: 60, textAlignVertical: "top" },
  status: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  statusText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  noteBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  noteText: { fontSize: 15, lineHeight: 21 },
  buttons: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, alignItems: "center", justifyContent: "center", height: 48, borderRadius: 13 },
  btnText: { fontSize: 15, fontWeight: "700" },
});
