/**
 * DashboardSectionModal — a centered, scrollable popup that hosts an existing Dashboard section's
 * exact content (rendered by the caller). VISUAL/structural only; it does not own any section logic.
 *
 * Design language matches the Settings popup: centered card, dimmed backdrop, small X close (top-right),
 * tap-outside / X to close, tap-inside does not dismiss, no bottom-sheet / swipe-down. Theme-aware.
 * The body scrolls within the safe area and clears the floating tab bar; keyboard insets are adjusted
 * so editable forms stay reachable. Expo Go compatible (built-in RN <Modal>).
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
  const bottomInset = insets.bottom + 96; // keep clear of the floating bottom tab bar
  const maxBodyH = Math.max(240, height - topInset - bottomInset - 52); // 52 ≈ the X row above the card

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[
          styles.backdrop,
          {
            backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,25,45,0.38)",
            paddingTop: topInset,
            paddingBottom: bottomInset,
          },
        ]}
        onPress={onClose}
        accessibilityLabel={accessibilityLabel ? `Close ${accessibilityLabel}` : "Close"}
      >
        <View style={styles.centerCol} pointerEvents="box-none">
          <View style={styles.closeRow} pointerEvents="box-none">
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={[styles.closeBtn, { backgroundColor: withAlpha(c.textMuted, 0.2) }]}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel ? `Close ${accessibilityLabel}` : "Close"}
            >
              <Feather name="x" size={18} color={c.textSecondary} />
            </Pressable>
          </View>
          {/* Plain responder-absorbing View (not a Pressable): a tap on empty popup space is claimed
              here so it never reaches the backdrop (popup stays open), but the View yields the drag
              gesture to the inner ScrollView so taller sections (e.g. Insulin Settings) scroll. */}
          <View style={styles.cardHost} onStartShouldSetResponder={() => true}>
            <ScrollView
              style={{ maxHeight: maxBodyH }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  centerCol: { width: "100%", maxWidth: 540, alignSelf: "center" },
  closeRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  // Soft elevation consistent with the Settings popup. The hosted section provides the opaque rounded
  // surface; the shadow is cast from it (radius matched so it tracks the card's corners).
  cardHost: {
    width: "100%",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  // The hosted section already provides its own card surface (border/fill/radius/padding); the body
  // adds only a little bottom room so the last control isn't flush against the scroll edge.
  body: { paddingBottom: 4 },
});
