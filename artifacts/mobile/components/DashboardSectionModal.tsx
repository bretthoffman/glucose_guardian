/**
 * DashboardSectionModal — a centered, scrollable popup that hosts an existing Dashboard section's
 * exact content (rendered by the caller). VISUAL/structural only; it does not own any section logic.
 *
 * Design language matches the Settings popup: centered card, dimmed backdrop, small X close (top-right),
 * tap-outside / X to close, tap-inside does not dismiss, no bottom-sheet / swipe-down. Theme-aware.
 * The body scrolls within the safe area and clears the floating tab bar; keyboard insets are adjusted
 * so editable forms stay reachable. Expo Go compatible (built-in RN <Modal>).
 *
 * Gesture ownership: the dimmed backdrop is a separate absolute-fill Pressable behind the card so
 * vertical pans reach the inner ScrollView on the first attempt. Do not wrap the card in a parent
 * Pressable or claim the touch responder on the card host — that intercepts scroll gestures.
 */
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withAlpha } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { dashboardModalMaxBodyHeight } from "@/utils/dashboardSectionModalLayout";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** e.g. "Notifications settings" → used for the backdrop + close accessibility labels. */
  accessibilityLabel?: string;
  children: React.ReactNode;
}

export function DashboardSectionModal({ visible, onClose, accessibilityLabel, children }: Props) {
  const { colors: c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const topInset = insets.top + 12;
  const bottomInset = insets.bottom + 96;
  const maxBodyH = dashboardModalMaxBodyHeight(height, insets.top, insets.bottom);

  if (!visible) return null;

  const closeA11y = accessibilityLabel ? `Close ${accessibilityLabel}` : "Close";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[
          styles.backdrop,
          {
            backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,25,45,0.38)",
            paddingTop: topInset,
            paddingBottom: bottomInset,
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeA11y}
        />
        <View style={styles.centerCol} pointerEvents="box-none">
          <View style={styles.closeRow} pointerEvents="box-none">
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={[styles.closeBtn, { backgroundColor: withAlpha(c.textMuted, 0.2) }]}
              accessibilityRole="button"
              accessibilityLabel={closeA11y}
            >
              <Feather name="x" size={18} color={c.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.cardHost}>
            <ScrollView
              style={{ maxHeight: maxBodyH }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  centerCol: { width: "100%", maxWidth: 540, alignSelf: "center" },
  closeRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardHost: {
    width: "100%",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  body: { paddingBottom: 20 },
});
