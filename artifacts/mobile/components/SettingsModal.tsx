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
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  const { profile, ageYears, updateProfile } = useAuth();
  const [schemeExpanded, setSchemeExpanded] = useState(false);

  // Inline account editor (name + weight). Same edit gate as the profile photo.
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  const openAccountEditor = () => {
    if (!accountExpanded) {
      setNameInput(profile?.childName ?? "");
      setWeightInput(profile?.weightLbs != null ? String(profile.weightLbs) : "");
    }
    setSchemeExpanded(false);
    setAccountExpanded((v) => !v);
  };

  const saveAccount = async () => {
    const name = nameInput.trim();
    if (!name || savingAccount) return;
    setSavingAccount(true);
    try {
      const w = parseFloat(weightInput);
      await updateProfile({ childName: name, weightLbs: !isNaN(w) && w > 0 ? w : undefined });
      setAccountExpanded(false);
    } finally {
      setSavingAccount(false);
    }
  };

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
        {/* Lift the card above the keyboard while the account fields are being edited. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
          pointerEvents="box-none"
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

          {/* Edit Profile — name + weight (same edit gate as the profile photo) */}
          {canEditPhoto ? (
            <Pressable
              style={[styles.row, { borderTopColor: c.border }]}
              onPress={openAccountEditor}
              accessibilityRole="button"
              accessibilityState={{ expanded: accountExpanded }}
              accessibilityLabel="Edit profile name and weight"
            >
              <View style={[styles.rowIcon, { backgroundColor: withAlpha(T.color.violet, 0.14) }]}>
                <Feather name="user" size={16} color={T.color.violetActive} />
              </View>
              <Text style={[styles.rowLabel, { color: c.textPrimary }]}>Edit Profile</Text>
              <Feather name={accountExpanded ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
            </Pressable>
          ) : null}

          {canEditPhoto && accountExpanded ? (
            <View style={[styles.editor, { borderTopColor: c.border }]}>
              <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Name</Text>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Name"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                autoCapitalize="words"
                returnKeyType="next"
              />
              <Text style={[styles.fieldLabel, { color: c.textMuted, marginTop: 12 }]}>Weight (lbs)</Text>
              <TextInput
                value={weightInput}
                onChangeText={(v) => setWeightInput(v.replace(/[^0-9.]/g, "").slice(0, 6))}
                placeholder="Optional"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
                style={[styles.input, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                returnKeyType="done"
                onSubmitEditing={saveAccount}
              />
              <View style={styles.editorBtns}>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setAccountExpanded(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.cancelBtnText, { color: c.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { backgroundColor: nameInput.trim() ? T.color.violetActive : withAlpha(c.textMuted, 0.2), opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={saveAccount}
                  disabled={!nameInput.trim() || savingAccount}
                  accessibilityRole="button"
                  accessibilityLabel="Save profile"
                >
                  {savingAccount ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
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
        </KeyboardAvoidingView>
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
  kav: { width: "100%", maxWidth: 400, alignItems: "center" },
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

  editor: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingBottom: 6 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "500",
  },
  editorBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: { fontSize: 15, fontWeight: "600" },
  saveBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },

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
