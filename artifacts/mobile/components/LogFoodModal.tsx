/**
 * LogFoodModal — the Logs tab's "Log Food" popup. A lean, text-only slice of the Food page:
 * search + Estimate Carbs + the shared Quick Lookup chips, then the same analysis card (editable
 * carbs, confidence, tips). No photo options, no insulin guidance, no insulin button. The entry
 * logs to the day being viewed (locked Date row) at an editable time, so meals can be backlogged.
 */
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { QUICK_FOODS_STORAGE_KEY } from "@/constants/storage-keys";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { apiUrl } from "@/utils/api-base-url";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import { DEFAULT_QUICK_FOODS, parseStoredQuickFoods } from "@/utils/quickFoods";

interface FoodLookupResult {
  foodName: string;
  estimatedCarbs: number;
  portion?: string;
  confidence: "high" | "medium" | "low";
  tips?: string;
}

const CONFIDENCE_COLOR = {
  high: COLORS.success,
  medium: COLORS.warning,
  low: COLORS.danger,
} as const;

export default function LogFoodModal({
  visible,
  onClose,
  /** The day being viewed on the Logs tab — the entry logs to this calendar day. */
  selectedDay,
  /** Called after the meal is logged — parent closes the popup and turns its button green. */
  onLogged,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  selectedDay: Date;
  onLogged: () => void;
  colors: (typeof Colors)["light"];
}) {
  const { addFoodLogEntry } = useAuth();
  const { carbRatio } = useGlucose();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FoodLookupResult | null>(null);
  const [editedCarbs, setEditedCarbs] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeText, setTimeText] = useState("");
  const [quickFoods, setQuickFoods] = useState<string[]>(DEFAULT_QUICK_FOODS);

  // Fresh popup per open: clear lookup state, prefill the time with the device clock, and pull
  // the user's current Quick Lookup list (shared with the Food page).
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setResult(null);
    setEditedCarbs("");
    setError("");
    setIsLoading(false);
    setTimeText(formatTimeInputText(new Date()));
    AsyncStorage.getItem(QUICK_FOODS_STORAGE_KEY)
      .then((raw) => {
        const stored = parseStoredQuickFoods(raw);
        if (stored) setQuickFoods(stored);
      })
      .catch(() => {});
  }, [visible]);

  async function search(food: string) {
    const q = food.trim();
    if (!q || isLoading) return;
    setQuery(q);
    setError("");
    setIsLoading(true);
    setResult(null);
    try {
      const res = await fetch(apiUrl("/api/food/estimate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: q }),
      });
      const data: FoodLookupResult = await res.json();
      setResult(data);
      setEditedCarbs(String(data.estimatedCarbs ?? 0));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setError("Could not estimate. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const parsedTime = parseTimeInputText(timeText);
  const carbs = result ? parseFloat(editedCarbs) || result.estimatedCarbs : 0;
  const canLog = result != null && carbs > 0 && parsedTime != null;

  const logDateLabel = selectedDay.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  function handleLog() {
    if (!result || !canLog || parsedTime == null) return;
    addFoodLogEntry({
      timestamp: combineDayAndTime(selectedDay, parsedTime.hours, parsedTime.minutes).toISOString(),
      foodName: result.foodName,
      estimatedCarbs: carbs,
      insulinUnits: carbRatio > 0 ? Math.round((carbs / carbRatio) * 10) / 10 : 0,
      confidence: result.confidence ?? "medium",
      fromPhoto: false,
    });
    onLogged();
  }

  return (
    <DashboardSectionModal visible={visible} onClose={onClose} accessibilityLabel="Log food">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Log Food</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Look up a meal and log it to the day shown below.
        </Text>

        <View style={[styles.searchBar, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. apple, pizza, rice..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => search(query)}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.estimateBtn,
            { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={() => search(query)}
          disabled={isLoading || !query.trim()}
        >
          {isLoading ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : (
            <Feather name="zap" size={14} color={COLORS.primary} />
          )}
          <Text style={[styles.estimateBtnText, { color: COLORS.primary }]}>
            {isLoading ? "Estimating..." : "Estimate Carbs"}
          </Text>
        </Pressable>

        <View style={styles.quickGrid}>
          {quickFoods.map((food) => {
            const active = result?.foodName?.toLowerCase() === food.toLowerCase();
            return (
              <Pressable
                key={food}
                style={({ pressed }) => [
                  styles.quickChip,
                  {
                    backgroundColor: active ? COLORS.primary : colors.backgroundTertiary,
                    borderColor: active ? COLORS.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                onPress={() => search(food)}
              >
                <Text style={[styles.quickChipText, { color: active ? "#fff" : colors.text }]}>{food}</Text>
              </Pressable>
            );
          })}
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: COLORS.dangerLight }]}>
            <Feather name="alert-circle" size={14} color={COLORS.danger} />
            <Text style={[styles.errorText, { color: COLORS.danger }]}>{error}</Text>
          </View>
        )}

        {result && (
          <View style={[styles.resultBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.foodName, { color: colors.text }]} numberOfLines={2}>
                {result.foodName}
              </Text>
              {result.portion && (
                <Text style={[styles.portionText, { color: colors.textMuted }]} numberOfLines={1}>
                  {result.portion}
                </Text>
              )}
              <View style={[styles.confidenceBadge, { backgroundColor: CONFIDENCE_COLOR[result.confidence] + "20" }]}>
                <View style={[styles.confidenceDot, { backgroundColor: CONFIDENCE_COLOR[result.confidence] }]} />
                <Text style={[styles.confidenceText, { color: CONFIDENCE_COLOR[result.confidence] }]}>
                  {result.confidence} confidence
                </Text>
              </View>
            </View>
            <View style={[styles.carbBubble, { borderColor: COLORS.primary + "30" }]}>
              <TextInput
                style={[styles.carbValue, { color: COLORS.primary }]}
                value={editedCarbs}
                onChangeText={(v) => setEditedCarbs(v.replace(/[^0-9.]/g, ""))}
                keyboardType="numeric"
                returnKeyType="done"
                selectTextOnFocus
                accessibilityLabel="Estimated carbs in grams"
              />
              <Text style={[styles.carbLabel, { color: COLORS.primary }]}>g carbs</Text>
              <Text style={{ fontSize: 9, color: COLORS.primary + "80" }}>tap to edit</Text>
            </View>
          </View>
        )}

        {result?.tips ? (
          <View style={[styles.tipsBox, { backgroundColor: colors.backgroundTertiary }]}>
            <Feather name="info" size={13} color={colors.textSecondary} />
            <Text style={[styles.tipsText, { color: colors.textSecondary }]}>{result.tips}</Text>
          </View>
        ) : null}

        <View style={[styles.whenSection, { borderTopColor: colors.border }]}>
          <View style={styles.whenRow}>
            <Text style={[styles.whenLabel, { color: colors.textSecondary }]}>Date</Text>
            <View style={styles.dateValueWrap}>
              <Feather name="calendar" size={13} color={colors.textMuted} />
              <Text style={[styles.dateValue, { color: colors.text }]}>{logDateLabel}</Text>
            </View>
          </View>
          <View style={styles.whenRow}>
            <Text style={[styles.whenLabel, { color: colors.textSecondary }]}>Time</Text>
            <TextInput
              value={timeText}
              onChangeText={setTimeText}
              style={[
                styles.timeInput,
                {
                  backgroundColor: colors.backgroundTertiary,
                  color: colors.text,
                  borderColor: parsedTime ? colors.border : COLORS.danger,
                },
              ]}
              placeholder="5:38 PM"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Time the meal was eaten"
            />
          </View>
          {!parsedTime && (
            <Text style={[styles.timeError, { color: COLORS.danger }]}>Enter a time like 5:38 PM or 17:38</Text>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={!canLog}
            style={({ pressed }) => [
              styles.logBtn,
              { backgroundColor: canLog ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleLog}
          >
            <Feather name="plus-circle" size={14} color={canLog ? "#fff" : colors.textMuted} />
            <Text style={[styles.logBtnText, { color: canLog ? "#fff" : colors.textMuted }]}>Log This Food</Text>
          </Pressable>
        </View>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -6 },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "400", padding: 0 },
  estimateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 10,
  },
  estimateBtnText: { fontSize: 13, fontWeight: "700" },

  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  quickChipText: { fontSize: 12, fontWeight: "600" },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errorText: { flex: 1, fontSize: 12, fontWeight: "500" },

  resultBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  foodName: { fontSize: 16, fontWeight: "700", textTransform: "capitalize" },
  portionText: { fontSize: 12, fontWeight: "400", marginTop: 2 },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 6,
  },
  confidenceDot: { width: 6, height: 6, borderRadius: 3 },
  confidenceText: { fontSize: 11, fontWeight: "600" },
  carbBubble: { alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  carbValue: { fontSize: 24, fontWeight: "700", textAlign: "center", minWidth: 42, padding: 0 },
  carbLabel: { fontSize: 11, fontWeight: "500" },

  tipsBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10 },
  tipsText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },

  whenSection: { borderTopWidth: 1, paddingTop: 12, marginTop: 2, gap: 10 },
  whenRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  whenLabel: { fontSize: 13, fontWeight: "600" },
  dateValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  dateValue: { fontSize: 14, fontWeight: "600" },
  timeInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "600",
    minWidth: 110,
    textAlign: "center",
  },
  timeError: { fontSize: 11, fontWeight: "500", textAlign: "right" },

  footer: { flexDirection: "row", justifyContent: "flex-end" },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  logBtnText: { fontSize: 14, fontWeight: "700" },
});
