import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { ReadingCard } from "@/components/ReadingCard";
import { Surface } from "@/components/Surface";
import { COLORS } from "@/constants/colors";
import { HOME_RECENT_READINGS_EXPANDED_STORAGE_KEY } from "@/constants/storage-keys";
import { T, type ThemeColors } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";
import {
  parseHomeRecentReadingsExpanded,
  serializeHomeRecentReadingsExpanded,
} from "@/utils/homeRecentReadingsExpanded";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  entries: GlucoseEntry[];
  isConnected: boolean;
}

export function RecentReadingsSection({ entries, isConnected }: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [expanded, setExpanded] = useState(false);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HOME_RECENT_READINGS_EXPANDED_STORAGE_KEY);
        if (!cancelled) setExpanded(parseHomeRecentReadingsExpanded(raw));
      } catch {
        // Default collapsed when storage is unavailable.
      } finally {
        if (!cancelled) setPreferenceLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      AsyncStorage.setItem(
        HOME_RECENT_READINGS_EXPANDED_STORAGE_KEY,
        serializeHomeRecentReadingsExpanded(next),
      ).catch(() => {});
      return next;
    });
  }, []);

  return (
    <View style={styles.section} collapsable={false}>
      <Pressable
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Recent Readings"
        accessibilityHint={expanded ? "Collapse recent readings list" : "Expand recent readings list"}
        style={({ pressed }) => [
          styles.headerCard,
          { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: COLORS.primary + "16" }]}>
          <Feather name="list" size={16} color={COLORS.primary} />
        </View>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
          Recent Readings
        </Text>
        <Feather
          name={expanded ? "chevron-down" : "chevron-right"}
          size={18}
          color={c.textMuted}
        />
      </Pressable>

      {preferenceLoaded && expanded && (
        entries.length === 0 ? (
          <Surface style={styles.listSurface}>
            <View style={styles.emptyList}>
              <Feather name="clipboard" size={22} color={c.textMuted} />
              <Text style={[styles.emptyListText, { color: c.textMuted }]}>
                {isConnected ? "Pull down to sync readings from your CGM" : "No readings yet. Connect a CGM to begin."}
              </Text>
            </View>
          </Surface>
        ) : (
          <Surface padding={T.space.lg} style={styles.listSurface}>
            {entries.map((entry, i) => (
              <ReadingCard key={i} entry={entry} last={i === entries.length - 1} />
            ))}
          </Surface>
        )
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  section: { marginBottom: T.space.lg },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: T.font.bold,
    letterSpacing: -0.1,
  },
  listSurface: { marginTop: T.space.sm },
  emptyList: { padding: 12, alignItems: "center", gap: 10 },
  emptyListText: { fontSize: 14, fontWeight: T.font.regular, textAlign: "center", lineHeight: 20 },
});
