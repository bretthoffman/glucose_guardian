/**
 * Insights & Recommendations list — the suggestion cards that used to live at the bottom of the
 * Insulin screen's Dose tab, now hosted in the Home screen's trend-pill popup. Behavior is
 * unchanged: colored cards per detected pattern with an "Ask AI about this" action.
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/context/ThemeContext";
import type { Suggestion } from "@/utils/insights";

export default function InsightsRecommendations({
  suggestions,
  onChat,
}: {
  suggestions: Suggestion[];
  onChat: (prompt: string) => void;
}) {
  const c = useThemeColors();

  if (suggestions.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: c.textMuted }]}>
        No insights yet for the last 24 hours — sync readings and log meals or doses to see
        patterns here.
      </Text>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {suggestions.map((s, i) => (
        <View key={i} style={[styles.suggCard, { backgroundColor: s.color + "0E", borderColor: s.color + "30" }]}>
          {s.tag && (
            <View style={[styles.suggTag, { backgroundColor: s.color + "22" }]}>
              <Text style={[styles.suggTagText, { color: s.color }]}>{s.tag}</Text>
            </View>
          )}
          <View style={styles.suggTop}>
            <View style={[styles.suggIconBg, { backgroundColor: s.color + "20" }]}>
              <Text style={styles.suggIcon}>{s.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.suggTitle, { color: s.color }]}>{s.title}</Text>
              <Text style={[styles.suggBody, { color: c.textPrimary }]}>{s.body}</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.chatBtn, { backgroundColor: s.color + "18", opacity: pressed ? 0.7 : 1 }]}
            onPress={() => onChat(s.chatPrompt)}
          >
            <Feather name="message-circle" size={13} color={s.color} />
            <Text style={[styles.chatBtnText, { color: s.color }]}>Ask AI about this</Text>
            <Feather name="chevron-right" size={13} color={s.color} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  suggCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  suggTag: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, marginTop: 10, marginLeft: 12, borderRadius: 6 },
  suggTagText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  suggTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  suggIconBg: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  suggIcon: { fontSize: 22 },
  suggTitle: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  suggBody: { fontSize: 13, fontWeight: "400", lineHeight: 19 },
  chatBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  chatBtnText: { flex: 1, fontSize: 13, fontWeight: "600" },
  emptyText: { fontSize: 13, fontWeight: "400", lineHeight: 20, textAlign: "center", paddingVertical: 12 },
});
