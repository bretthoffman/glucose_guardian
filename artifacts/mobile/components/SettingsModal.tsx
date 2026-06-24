/**
 * Settings popup — centered modal opened from the Dashboard profile/avatar control.
 *
 * - Centered card (NOT a bottom sheet), dimmed backdrop, no swipe-down dismissal.
 * - Closes on the X button or a tap on the backdrop; taps inside the card do not dismiss.
 * - Actions: "Update Profile Image" (reuses the shared photo-picker) and an inline "Color Scheme"
 *   expander (Automatic / Light / Dark) that applies immediately, marks the selection, and collapses.
 * - Fully theme-aware: the popup itself re-renders live when the appearance changes.
 *
 * Expo Go compatible: uses the built-in React Native <Modal> (no native modal dependency).
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { T, withAlpha, type ThemePreference } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Invokes the shared profile-photo picker (only shown when editing is allowed). */
  onUpdatePhoto: () => void;
  uploading: boolean;
  canEditPhoto: boolean;
}

const SCHEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Automatic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function prefLabel(p: ThemePreference): string {
  return p === "system" ? "Automatic" : p === "light" ? "Light" : "Dark";
}

function diabetesLabel(type?: string): string {
  if (type === "type1") return "Type 1";
  if (type === "type2") return "Type 2";
  if (type === "other") return "Diabetes";
  return "";
}

function ageLabel(ageYears: number | null): string {
  if (ageYears === null) return "";
  if (ageYears < 1) return "< 1 yr";
  if (ageYears === 1) return "1 yr";
  return `${ageYears} yrs`;
}

export function SettingsModal({ visible, onClose, onUpdatePhoto, uploading, canEditPhoto }: Props) {
  const { colors: c, scheme, preference, setPreference } = useTheme();
  const { profile, ageYears } = useAuth();
  const [schemeExpanded, setSchemeExpanded] = useState(false);

  const firstName = (profile?.childName ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const ageStr = ageLabel(ageYears);
  const typeStr = diabetesLabel(profile?.diabetesType);
  const subParts = [ageStr, typeStr].filter(Boolean).join(" · ");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[styles.backdrop, { backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,25,45,0.38)" }]}
        onPress={onClose}
        accessibilityLabel="Close settings"
      >
        {/* Inner Pressable captures touches so taps inside the card do not dismiss. */}
        <Pressable
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => {}}
          accessibilityViewIsModal
        >
          {/* Header: quiet "Settings" label (left) + identity + close (right) */}
          <View style={styles.header}>
            <Text style={[styles.settingsLabel, { color: c.textMuted }]}>Settings</Text>
            <View style={styles.headerRight}>
              {(firstName || subParts) ? (
                <View style={styles.identity}>
                  {firstName ? (
                    <Text style={[styles.identityName, { color: c.textPrimary }]} numberOfLines={1}>
                      {firstName}
                    </Text>
                  ) : null}
                  {subParts ? (
                    <Text style={[styles.identitySub, { color: c.textSecondary }]} numberOfLines={1}>
                      {subParts}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={[styles.closeBtn, { backgroundColor: withAlpha(c.textMuted, 0.14) }]}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <Feather name="x" size={18} color={c.textSecondary} />
              </Pressable>
            </View>
          </View>

          {/* Update Profile Image */}
          {canEditPhoto ? (
            <Pressable
              style={[styles.row, { borderTopColor: c.border }]}
              onPress={onUpdatePhoto}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Update profile image"
            >
              <View style={[styles.rowIcon, { backgroundColor: withAlpha(T.color.violet, 0.14) }]}>
                {uploading ? (
                  <ActivityIndicator size="small" color={T.color.violetActive} />
                ) : (
                  <Feather name="camera" size={16} color={T.color.violetActive} />
                )}
              </View>
              <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
                {uploading ? "Updating…" : "Update Profile Image"}
              </Text>
              <Feather name="chevron-right" size={18} color={c.textMuted} />
            </Pressable>
          ) : null}

          {/* Color Scheme */}
          <Pressable
            style={[styles.row, { borderTopColor: c.border }]}
            onPress={() => setSchemeExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: schemeExpanded }}
            accessibilityLabel={`Color scheme, currently ${prefLabel(preference)}`}
          >
            <View style={[styles.rowIcon, { backgroundColor: withAlpha(T.color.violet, 0.14) }]}>
              <MaterialCommunityIcons name="theme-light-dark" size={17} color={T.color.violetActive} />
            </View>
            <Text style={[styles.rowLabel, { color: c.textPrimary }]}>Color Scheme</Text>
            {!schemeExpanded ? (
              <Text style={[styles.rowValue, { color: c.textSecondary }]}>{prefLabel(preference)}</Text>
            ) : null}
            <Feather name={schemeExpanded ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
          </Pressable>

          {schemeExpanded ? (
            <View style={[styles.options, { borderTopColor: c.border }]}>
              {SCHEME_OPTIONS.map((o) => {
                const selected = preference === o.value;
                return (
                  <Pressable
                    key={o.value}
                    style={styles.optionRow}
                    onPress={() => {
                      setPreference(o.value); // saves + applies immediately
                      setSchemeExpanded(false); // collapse, keep popup open
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={o.label}
                  >
                    <Text
                      style={[styles.optionLabel, { color: selected ? c.textPrimary : c.textSecondary, fontWeight: selected ? "700" : "500" }]}
                    >
                      {o.label}
                    </Text>
                    {selected ? (
                      <Feather name="check" size={18} color={T.color.violetActive} />
                    ) : (
                      <View style={[styles.optionDot, { borderColor: c.borderStrong }]} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 14,
    gap: 12,
  },
  settingsLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  identity: { alignItems: "flex-end", flexShrink: 1 },
  identityName: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  identitySub: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  rowValue: { fontSize: 14, fontWeight: "500" },

  options: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingLeft: 48,
    paddingRight: 4,
  },
  optionLabel: { fontSize: 15 },
  optionDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5 },
});
