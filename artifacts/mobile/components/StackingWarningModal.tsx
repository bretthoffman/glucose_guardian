/**
 * "Beware of insulin stacking" — the window shown before a fast-acting dose is logged within 2 hours
 * of another one (rules: utils/insulinStacking). Short on purpose: the last dose, how much is still
 * working, one sentence, and the choice. Cancel is the main button; Log insulin is right under it —
 * it's the family's decision.
 *
 * Use through `useStackingGuard()` (bottom of this file): it owns the open/closed state and renders
 * the window. Render its `stackingModal` INSIDE any popup the log button lives in, so the window
 * appears on top of that popup.
 */
import React, { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { useTheme } from "@/context/ThemeContext";
import type { InsulinLogEntry } from "@/context/AuthContext";
import { computeActiveInsulin } from "@/utils/onBoard";
import { stackingWarning, type RecentDose, type StackingWarningCopy } from "@/utils/insulinStacking";

const AMBER = COLORS.warning;

function StackingWarningModal({
  copy,
  onCancel,
  onLog,
}: {
  copy: StackingWarningCopy;
  onCancel: () => void;
  onLog: () => void;
}) {
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: isDark ? "rgba(0,0,0,0.66)" : "rgba(15,25,45,0.45)" }]}>
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: AMBER + "73" }]}
        >
          <View style={styles.header}>
            <View style={[styles.iconTile, { backgroundColor: AMBER + "29" }]}>
              <Feather name="clock" size={21} color={AMBER} />
            </View>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {copy.title}
            </Text>
          </View>

          <View style={[styles.factBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
            <Text style={[styles.doseLine, { color: colors.text }]}>
              {copy.doseLine}
              {copy.byLine ? <Text style={[styles.byLine, { color: colors.textSecondary }]}> · {copy.byLine}</Text> : null}
            </Text>
            {copy.activeLine ? <Text style={[styles.activeLine, { color: AMBER }]}>{copy.activeLine}</Text> : null}
          </View>

          <Text style={[styles.message, { color: colors.textSecondary }]}>{copy.message}</Text>
          <Text style={[styles.footnote, { color: colors.textMuted }]}>{copy.footnote}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.cancelText}>Cancel insulin log</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onLog}
            style={({ pressed }) => [styles.logBtn, { borderColor: COLORS.primaryLight + "99", opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.logText, { color: isDark ? "#C9C0FF" : COLORS.primary }]}>Log insulin</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * `askStacking(recent, insulinLog, proceed)`: when `recent` is a dose inside the window, open the
 * warning; "Log insulin" then runs `proceed`. With no recent dose it runs `proceed` right away.
 */
export function useStackingGuard() {
  const [pending, setPending] = useState<{ copy: StackingWarningCopy; proceed: () => void } | null>(null);

  const askStacking = useCallback(
    (recent: RecentDose | null, insulinLog: InsulinLogEntry[], proceed: () => void) => {
      if (!recent) {
        proceed();
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const active = computeActiveInsulin(insulinLog, Date.now()).totalUnits;
      setPending({ copy: stackingWarning(recent, active), proceed });
    },
    [],
  );

  const stackingModal = pending ? (
    <StackingWarningModal
      copy={pending.copy}
      onCancel={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPending(null);
      }}
      onLog={() => {
        const run = pending.proceed;
        setPending(null);
        // Let this window finish closing first — a caregiver's own confirm (useCareLogConfirm) is
        // an alert, and iOS drops an alert raised while a modal is still dismissing.
        setTimeout(run, 350);
      }}
    />
  ) : null;

  return { askStacking, stackingModal };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 16 },
  card: { width: "100%", maxWidth: 440, alignSelf: "center", borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconTile: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", lineHeight: 25 },
  factBox: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  doseLine: { fontSize: 16, fontWeight: "700" },
  byLine: { fontSize: 15, fontWeight: "500" },
  activeLine: { fontSize: 14, fontWeight: "700" },
  message: { fontSize: 14.5, lineHeight: 21 },
  footnote: { fontSize: 12.5, lineHeight: 18 },
  cancelBtn: { marginTop: 4, height: 50, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#fff", fontSize: 16.5, fontWeight: "700" },
  logBtn: { height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  logText: { fontSize: 16.5, fontWeight: "700" },
});
