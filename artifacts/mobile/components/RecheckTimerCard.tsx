/**
 * The recheck countdown on the Glucose screen after a treated low ("Recheck Jake in 11:24"), then
 * "Time to recheck" with the latest number. Recheck now opens the Finger Stick pop-up. Shows nothing
 * when no timer is running on this phone.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useTheme } from "@/context/ThemeContext";
import { useHelpAnchor } from "@/context/HelpContext";
import { cancelScheduledNotification } from "@/services/notifications";
import { setRecheckTimer, timeLeftLabel, timerIsLive, timerProgress, useRecheckTimer } from "@/utils/recheckTimer";

const R = 30;
const CIRC = 2 * Math.PI * R;

export default function RecheckTimerCard({ padH, onRecheck }: { padH: number; onRecheck: () => void }) {
  const helpAnchor = useHelpAnchor("home.recheck");
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const timer = useRecheckTimer();
  const { latestReading } = useGlucose();
  const [now, setNow] = useState(() => Date.now());
  const live = timerIsLive(timer, now);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Clear a timer that has run its course.
  useEffect(() => {
    if (timer && !live) void setRecheckTimer(null);
  }, [timer, live]);

  if (!live || !timer) return null;
  const left = timeLeftLabel(timer, now);
  const done = left == null;
  const progress = timerProgress(timer, now);
  const reading = latestReading && new Date(latestReading.timestamp).getTime() > timer.startedAt ? Math.round(latestReading.glucose) : null;
  const clear = async () => {
    await cancelScheduledNotification(timer.notificationId);
    await setRecheckTimer(null);
  };

  return (
    <View ref={helpAnchor} collapsable={false} style={{ paddingHorizontal: padH, paddingBottom: 12 }}>
      <View
        style={[styles.card, { backgroundColor: colors.card, borderColor: done ? COLORS.danger + "88" : COLORS.primary + "55" }]}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.top}>
          <Svg width={72} height={72} viewBox="0 0 72 72" accessibilityLabel={done ? "Time to recheck" : `${left} left`}>
            <Circle cx={36} cy={36} r={R} stroke={(done ? COLORS.danger : COLORS.primary) + "30"} strokeWidth={7} fill="none" />
            <Circle
              cx={36}
              cy={36}
              r={R}
              stroke={done ? COLORS.danger : COLORS.primary}
              strokeWidth={7}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${CIRC * progress} ${CIRC}`}
              transform="rotate(-90 36 36)"
            />
          </Svg>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>
              {done ? "TIME TO RECHECK" : `RECHECK ${timer.childName.toUpperCase()} IN`}
            </Text>
            <Text style={[styles.big, { color: colors.text }]}>{done ? timer.childName : left}</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={2}>
              {done && reading != null
                ? `Now ${reading} mg/dL · treated with ${timer.treatment}`
                : `Treated ${new Date(timer.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${timer.treatment}`}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void clear();
              onRecheck();
            }}
            style={({ pressed }) => [styles.btn, { backgroundColor: done ? COLORS.danger : colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <MaterialCommunityIcons name="water-plus-outline" size={16} color={done ? "#fff" : colors.text} />
            <Text style={[styles.btnText, { color: done ? "#fff" : colors.text }]}>{done ? "Log finger stick" : "Recheck now"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void clear()}
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>{done ? "Done" : "Cancel timer"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  kicker: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8 },
  big: { fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sub: { fontSize: 12.5 },
  buttons: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  btnText: { fontSize: 14.5, fontWeight: "700" },
});
