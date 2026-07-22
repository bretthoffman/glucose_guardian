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
import { router } from "expo-router";
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

/** Same calendar check the onboarding birthday step uses (rejects 02/31 and out-of-range years). */
function isValidDate(month: string, day: string, year: string): boolean {
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const y = parseInt(year, 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > new Date().getFullYear()) return false;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d;
}

/** Split a stored `YYYY-MM-DD` profile birthday into the three editor fields. */
function splitDateOfBirth(iso?: string): { month: string; day: string; year: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!match) return { month: "", day: "", year: "" };
  return { year: match[1], month: match[2], day: match[3] };
}

export function SettingsModal({ visible, onClose, onUpdatePhoto, uploading, canEditPhoto }: Props) {
  const { colors: c, scheme, preference, setPreference } = useTheme();
  const { profile, ageYears, updateProfile, isCircleMember, circleOwnerName, signOut } = useAuth();
  const [schemeExpanded, setSchemeExpanded] = useState(false);

  // Inline account editor (your name + child name + birthday + weight). Same edit gate as the photo.
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [yourNameInput, setYourNameInput] = useState("");
  const [yourLastNameInput, setYourLastNameInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [organizationInput, setOrganizationInput] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  // A Caregiver (school-nurse) account has no child — just their own name + organization.
  const isCaregiverAccount = profile?.accountRole === "caregiver";
  // A "parent/guardian" account has a separate guardian name (`parentName`) distinct from the child
  // name; an "adult (myself)" account's own name IS the child-name field, so no extra field there.
  const isParentAccount = profile?.accountRole !== "adult" && !isCaregiverAccount;

  // Birthday and weight belong to the care circle's owner: a linked co-guardian inherits both and
  // views them read-only, then regains editing if they ever leave the circle. "Your name" is always
  // personal — a co-guardian keeps and edits their own name so log bylines credit the right person.
  const canEditSharedFields = !isCircleMember;

  const openAccountEditor = () => {
    if (!accountExpanded) {
      setYourNameInput(profile?.parentName ?? "");
      setYourLastNameInput(profile?.parentLastName ?? "");
      setNameInput(profile?.childName ?? "");
      setLastNameInput(profile?.childLastName ?? "");
      setWeightInput(profile?.weightLbs != null ? String(profile.weightLbs) : "");
      setOrganizationInput(profile?.organization ?? "");
      const dob = splitDateOfBirth(profile?.dateOfBirth);
      setBirthMonth(dob.month);
      setBirthDay(dob.day);
      setBirthYear(dob.year);
    }
    setSchemeExpanded(false);
    setAccountExpanded((v) => !v);
  };

  const birthdayEntered = !!(birthMonth.trim() || birthDay.trim() || birthYear.trim());
  const birthdayValid = isValidDate(birthMonth, birthDay, birthYear);
  // Block the save on a half-typed / impossible date rather than silently discarding it.
  const birthdayInvalid = !isCaregiverAccount && canEditSharedFields && birthdayEntered && !birthdayValid;
  const canSaveAccount = !!nameInput.trim() && !birthdayInvalid;

  const saveAccount = async () => {
    const name = nameInput.trim();
    if (!canSaveAccount || savingAccount) return;
    setSavingAccount(true);
    try {
      const w = parseFloat(weightInput);
      const childLastName = lastNameInput.trim() || undefined;
      if (isCaregiverAccount) {
        // Nurse account: their own name (stored in childName/childLastName) + organization.
        await updateProfile({ childName: name, childLastName, organization: organizationInput.trim() || undefined });
        setAccountExpanded(false);
        return;
      }
      // "Your name" is personal to this account (never inherited from the circle owner), so it saves
      // for a co-guardian member too; updateProfile routes it to their own profile. The child's name
      // (childName/childLastName) is shared and routes to the circle owner for a member.
      const yourNamePatch = isParentAccount
        ? { parentName: yourNameInput.trim() || undefined, parentLastName: yourLastNameInput.trim() || undefined }
        : {};
      if (!canEditSharedFields) {
        await updateProfile({ childName: name, childLastName, ...yourNamePatch });
      } else {
        await updateProfile({
          childName: name,
          childLastName,
          ...yourNamePatch,
          weightLbs: !isNaN(w) && w > 0 ? w : undefined,
          // Leave the stored birthday untouched when the fields were cleared out entirely.
          ...(birthdayValid
            ? { dateOfBirth: `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}` }
            : {}),
        });
      }
      setAccountExpanded(false);
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSignOut = async () => {
    onClose();
    await signOut();
    router.replace("/auth");
  };

  const firstName = (profile?.childName ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const ageStr = ageLabel(ageYears);
  const typeStr = diabetesLabel(profile?.diabetesType);
  // A caregiver shows their organization (if any) instead of an age/diabetes sub-line.
  const subParts = isCaregiverAccount
    ? (profile?.organization ?? "")
    : [ageStr, typeStr].filter(Boolean).join(" · ");

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
              {/* Your name (the guardian) — personal to this account, shown as the byline on logs you
                  add. Always editable, even for a linked co-guardian, so each guardian's own name
                  credits their own entries instead of everyone showing the child's name. */}
              {isParentAccount ? (
                <>
                  <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Your Name</Text>
                  <View style={styles.nameRow}>
                    <TextInput
                      value={yourNameInput}
                      onChangeText={setYourNameInput}
                      placeholder="First"
                      placeholderTextColor={c.textMuted}
                      style={[styles.input, styles.nameFirst, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                      autoCapitalize="words"
                      returnKeyType="next"
                      maxLength={30}
                    />
                    <TextInput
                      value={yourLastNameInput}
                      onChangeText={setYourLastNameInput}
                      placeholder="Last"
                      placeholderTextColor={c.textMuted}
                      style={[styles.input, styles.nameLast, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                      autoCapitalize="words"
                      returnKeyType="next"
                      maxLength={30}
                    />
                  </View>
                  <Text style={[styles.hint, { color: c.textMuted }]}>
                    Shown on the logs you add, so co-guardians can see who logged what.
                  </Text>
                </>
              ) : null}
              <Text style={[styles.fieldLabel, { color: c.textMuted, marginTop: isParentAccount ? 12 : 0 }]}>
                {isParentAccount ? "Child's Name" : "Name"}
              </Text>
              <View style={styles.nameRow}>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="First"
                  placeholderTextColor={c.textMuted}
                  style={[styles.input, styles.nameFirst, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
                <TextInput
                  value={lastNameInput}
                  onChangeText={setLastNameInput}
                  placeholder="Last"
                  placeholderTextColor={c.textMuted}
                  style={[styles.input, styles.nameLast, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                  autoCapitalize="words"
                  returnKeyType="next"
                  maxLength={30}
                />
              </View>
              {isCaregiverAccount ? (
                <>
                  <Text style={[styles.fieldLabel, { color: c.textMuted, marginTop: 12 }]}>Organization</Text>
                  <TextInput
                    value={organizationInput}
                    onChangeText={setOrganizationInput}
                    placeholder="School or clinic (optional)"
                    placeholderTextColor={c.textMuted}
                    style={[styles.input, { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary }]}
                    autoCapitalize="words"
                    returnKeyType="done"
                    maxLength={60}
                    onSubmitEditing={saveAccount}
                  />
                </>
              ) : (
              <>
              <Text style={[styles.fieldLabel, { color: c.textMuted, marginTop: 12 }]}>Birthday</Text>
              <View style={styles.dobRow}>
                <TextInput
                  value={birthMonth}
                  onChangeText={(v) => setBirthMonth(v.replace(/\D/g, "").slice(0, 2))}
                  placeholder="MM"
                  placeholderTextColor={c.textMuted}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={canEditSharedFields}
                  style={[
                    styles.input,
                    styles.dobInput,
                    { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary },
                    canEditSharedFields ? null : { opacity: 0.5 },
                  ]}
                  returnKeyType="next"
                />
                <Text style={[styles.dobSeparator, { color: c.textMuted }]}>/</Text>
                <TextInput
                  value={birthDay}
                  onChangeText={(v) => setBirthDay(v.replace(/\D/g, "").slice(0, 2))}
                  placeholder="DD"
                  placeholderTextColor={c.textMuted}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={canEditSharedFields}
                  style={[
                    styles.input,
                    styles.dobInput,
                    { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary },
                    canEditSharedFields ? null : { opacity: 0.5 },
                  ]}
                  returnKeyType="next"
                />
                <Text style={[styles.dobSeparator, { color: c.textMuted }]}>/</Text>
                <TextInput
                  value={birthYear}
                  onChangeText={(v) => setBirthYear(v.replace(/\D/g, "").slice(0, 4))}
                  placeholder="YYYY"
                  placeholderTextColor={c.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                  editable={canEditSharedFields}
                  style={[
                    styles.input,
                    styles.dobInput,
                    styles.dobYearInput,
                    { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary },
                    canEditSharedFields ? null : { opacity: 0.5 },
                  ]}
                  returnKeyType="next"
                />
              </View>
              {birthdayInvalid ? (
                <Text style={[styles.hint, { color: T.color.coral }]}>
                  Enter a real date, e.g. 04 / 09 / 2014.
                </Text>
              ) : null}

              <Text style={[styles.fieldLabel, { color: c.textMuted, marginTop: 12 }]}>Weight (lbs)</Text>
              <TextInput
                value={weightInput}
                onChangeText={(v) => setWeightInput(v.replace(/[^0-9.]/g, "").slice(0, 6))}
                placeholder="Optional"
                placeholderTextColor={c.textMuted}
                keyboardType="decimal-pad"
                editable={canEditSharedFields}
                style={[
                  styles.input,
                  { backgroundColor: c.screen, borderColor: c.border, color: c.textPrimary },
                  canEditSharedFields ? null : { opacity: 0.5 },
                ]}
                returnKeyType="done"
                onSubmitEditing={saveAccount}
              />
              {!canEditSharedFields ? (
                <Text style={[styles.hint, { color: c.textMuted }]}>
                  Birthday and weight are managed by {circleOwnerName || "the circle owner"} for your care circle.
                </Text>
              ) : null}
              </>
              )}
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
                    { backgroundColor: canSaveAccount ? T.color.violetActive : withAlpha(c.textMuted, 0.2), opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={saveAccount}
                  disabled={!canSaveAccount || savingAccount}
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

          {/* Sign Out — caregiver (nurse) accounts have no dashboard, so it lives here. */}
          {isCaregiverAccount ? (
            <Pressable
              style={[styles.row, { borderTopColor: c.border }]}
              onPress={handleSignOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <View style={[styles.rowIcon, { backgroundColor: withAlpha(T.color.coral, 0.14) }]}>
                <Feather name="log-out" size={16} color={T.color.coral} />
              </View>
              <Text style={[styles.rowLabel, { color: T.color.coral }]}>Sign Out</Text>
              <Feather name="chevron-right" size={18} color={c.textMuted} />
            </Pressable>
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
  nameRow: { flexDirection: "row", gap: 8 },
  nameFirst: { flex: 1 },
  nameLast: { flex: 1 },
  hint: { fontSize: 12, fontWeight: "500", marginTop: 6, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "500",
  },
  dobRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dobInput: { flex: 1, paddingHorizontal: 10, textAlign: "center" },
  dobYearInput: { flex: 1.5 },
  dobSeparator: { fontSize: 15, fontWeight: "600" },
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
