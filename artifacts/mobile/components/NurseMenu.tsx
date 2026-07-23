/**
 * Nurse Menu — the single home screen for a Caregiver (school-nurse) account. Lists every child the
 * nurse manages via a guardian-issued access code, each with their current glucose, and lets the
 * nurse add more codes. Tapping a child opens that child's live view (the normal app pages, gated by
 * the code's permissions + schedule) exactly like a co-guardian's "View glucose".
 *
 * Rendered as a full-screen overlay from (tabs)/_layout when the account is a caregiver and not
 * currently viewing a child; the tab bar is hidden underneath it.
 */
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useProfilePhotoPicker } from "@/hooks/useProfilePhotoPicker";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import type { Id } from "../../../convex/_generated/dataModel";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";
import { computeActiveCarbs, computeActiveInsulin, formatAgeShort } from "@/utils/onBoard";
import { SettingsModal } from "@/components/SettingsModal";

interface Kid {
  code: string;
  patientUserId: string;
  name: string;
  lastName: string;
  ageYears: number | null;
  diabetesType: string;
  accessState: { state: "ok" | "before_window" | "outside_window" | "disabled"; nextStartMs?: number };
  latestGlucose: number | null;
  thresholds: { urgentLow: number; low: number; high: number; urgentHigh: number };
  recentFood: { timestamp: string; estimatedCarbs: number }[];
  recentInsulin: { timestamp: string; units: number; type: string; insulinType?: string }[];
}

/** "1h 15m ago" / "just now" for the active-log timestamps. */
function agoLabel(ageMin: number | null): string {
  const s = formatAgeShort(ageMin);
  return ageMin != null && ageMin >= 1 ? `${s} ago` : s;
}

function diabetesLabel(type: string): string {
  if (type === "type1") return "Type 1";
  if (type === "type2") return "Type 2";
  return "Diabetes";
}

/** Ring color from the child's own thresholds — matches the gauge coloring used elsewhere. */
function ringColor(value: number | null, t: Kid["thresholds"]): string {
  if (value == null) return "#7A8699";
  if (value <= t.urgentLow || value >= t.urgentHigh) return COLORS.danger;
  if (value < t.low || value > t.high) return COLORS.warning;
  return COLORS.success;
}

export default function NurseMenu() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { account, isCaregiverAccount, isViewingLinkedPatient, enterKidView } = useAuth();

  const [kids, setKids] = useState<Kid[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Ticks every 30s so the active-carbs/insulin values decay live between the 45s data polls.
  const [nowMs, setNowMs] = useState(Date.now());
  const { pickPhoto, uploading: photoUploading } = useProfilePhotoPicker();

  const accountRef = useRef(account);
  useEffect(() => { accountRef.current = account; }, [account]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) return;
    if (!silent) setLoading(true);
    try {
      const rows = await createConvexAuthClient().query(api.caregiverAccounts.listCaregiverKids, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
      });
      setKids(rows as Kid[]);
    } catch {
      /* offline — keep the last known list */
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll so a retired code drops its card, a schedule window opening/closing flips the reading, and
  // fresh glucose appears — all without the nurse doing anything.
  useEffect(() => {
    if (!isCaregiverAccount || isViewingLinkedPatient) return;
    void refresh();
    const id = setInterval(() => refresh(true), 45_000);
    return () => clearInterval(id);
  }, [isCaregiverAccount, isViewingLinkedPatient, refresh]);

  const submitCode = useCallback(async () => {
    const acc = accountRef.current;
    const code = codeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!acc?.convexUserId || code.length !== 8 || adding) return;
    setAdding(true);
    try {
      const res = await createConvexAuthClient().mutation(api.caregiverAccounts.addCaregiverCode, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        code,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCodeInput("");
      setAddOpen(false);
      await refresh(true);
      if (res.alreadyLinked) Alert.alert("Already added", `${res.patientName} is already on your list.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^\[.*?\]\s*/, "") : "Could not add that code.";
      Alert.alert("Couldn't add code", msg);
    } finally {
      setAdding(false);
    }
  }, [codeInput, adding, refresh]);

  const openKid = useCallback(async (kid: Kid) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Enter the view even when the window is closed — the schedule-lock screen then takes over so the
    // nurse sees "outside your access window" instead of live data.
    const ok = await enterKidView(kid.code, kid.patientUserId, kid.name);
    if (!ok) {
      Alert.alert("Unavailable", `${kid.name}'s access code is no longer active.`);
      void refresh(true);
    }
  }, [enterKidView, refresh]);

  const confirmRemove = useCallback((kid: Kid) => {
    Alert.alert(`Remove ${kid.name}?`, "This takes them off your list. You can add their code again anytime.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const acc = accountRef.current;
          if (!acc?.convexUserId) return;
          try {
            await createConvexAuthClient().mutation(api.caregiverAccounts.removeCaregiverCode, {
              userId: acc.convexUserId as Id<"users">,
              passwordHash: acc.passwordHash,
              code: kid.code,
            });
            await refresh(true);
          } catch {
            /* ignore */
          }
        },
      },
    ]);
  }, [refresh]);

  if (!isCaregiverAccount || isViewingLinkedPatient) return null;

  const avatarInitial = (accountRef.current?.email ?? "N").slice(0, 1).toUpperCase();

  return (
    <View style={[styles.overlay, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Caregiver Menu</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Select a child to view details</Text>
        </View>
        <Pressable
          onPress={() => { setSettingsOpen(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.avatarBtn, { backgroundColor: COLORS.primary + "22" }]}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Feather name="user" size={22} color={COLORS.primary} />
        </Pressable>
      </View>

      <ScrollView
        {...NO_AUTO_CONTENT_INSETS}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 32, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && kids.length === 0 ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : kids.length === 0 ? (
          <View style={[styles.emptyBox, { borderColor: colors.border }]}>
            <Feather name="users" size={26} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No children yet</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              Add a caregiver access code from a parent or guardian to start watching over a child.
            </Text>
          </View>
        ) : (
          kids.map((kid) => {
            const locked = kid.accessState.state !== "ok";
            const value = locked ? null : kid.latestGlucose;
            const color = ringColor(value, kid.thresholds);
            const fullName = [kid.name, kid.lastName].filter(Boolean).join(" ");
            const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
            // Same active-carbs / active-insulin math the dose calculator uses, decaying live via nowMs.
            const carbs = computeActiveCarbs((kid.recentFood ?? []) as FoodLogEntry[], nowMs);
            const insulin = computeActiveInsulin((kid.recentInsulin ?? []) as InsulinLogEntry[], nowMs);
            return (
              <Pressable
                key={kid.code}
                onPress={() => openKid(kid)}
                onLongPress={() => confirmRemove(kid)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.kidAvatar, { backgroundColor: COLORS.primary + "18" }]}>
                    <Text style={[styles.kidInitials, { color: COLORS.primary }]}>{initials || "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.kidName, { color: colors.text }]} numberOfLines={1}>{fullName}</Text>
                    <Text style={[styles.kidMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {kid.ageYears != null ? `${kid.ageYears} years old · ` : ""}{diabetesLabel(kid.diabetesType)}
                      {locked ? " · Locked" : ""}
                    </Text>
                  </View>
                  <View style={[styles.ring, { borderColor: color }]}>
                    <Text style={[styles.ringValue, { color: colors.text }]}>{value != null ? value : "--"}</Text>
                    <Text style={[styles.ringUnit, { color: colors.textMuted }]}>mg/dL</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={colors.textMuted} />
                </View>

                {/* Active carbs / insulin taking effect on this access code — hidden while locked. */}
                {!locked && (
                  <View style={[styles.activeRow, { borderTopColor: colors.separator ?? colors.border }]}>
                    <View style={styles.activeCol}>
                      <View style={styles.activeHead}>
                        <MaterialCommunityIcons name="silverware-fork-knife" size={13} color={colors.textMuted} />
                        <Text style={[styles.activeLabel, { color: colors.textMuted }]}>ACTIVE CARBS</Text>
                      </View>
                      {carbs.entryCount > 0 ? (
                        <>
                          <Text style={[styles.activeValue, { color: COLORS.warning }]}>+{carbs.totalGrams} g</Text>
                          <Text style={[styles.activeAge, { color: colors.textMuted }]}>{agoLabel(carbs.lastEntryAgeMin)}</Text>
                        </>
                      ) : (
                        <Text style={[styles.activeNone, { color: colors.textMuted }]}>None active</Text>
                      )}
                    </View>
                    <View style={[styles.activeDivider, { backgroundColor: colors.separator ?? colors.border }]} />
                    <View style={styles.activeCol}>
                      <View style={styles.activeHead}>
                        <MaterialCommunityIcons name="needle" size={13} color={colors.textMuted} />
                        <Text style={[styles.activeLabel, { color: colors.textMuted }]}>ACTIVE INSULIN</Text>
                      </View>
                      {insulin.doseCount > 0 ? (
                        <>
                          <Text style={[styles.activeValue, { color: COLORS.success }]}>-{insulin.totalUnits} u</Text>
                          <Text style={[styles.activeAge, { color: colors.textMuted }]}>{agoLabel(insulin.lastDoseAgeMin)}</Text>
                        </>
                      ) : (
                        <Text style={[styles.activeNone, { color: colors.textMuted }]}>None active</Text>
                      )}
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })
        )}

        {/* Add caregiver code */}
        <Pressable
          onPress={() => { setCodeInput(""); setAddOpen(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "0E", opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Feather name="plus" size={18} color={COLORS.primary} />
          <Text style={[styles.addBtnText, { color: COLORS.primary }]}>Add caregiver code</Text>
        </Pressable>
      </ScrollView>

      {/* Add-code modal — same idea as "Sign in with access code", but it links a child instead. */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)} statusBarTranslucent>
        <Pressable style={styles.mdBackdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={[styles.mdCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.mdTitle, { color: colors.text }]}>Add caregiver code</Text>
            <Text style={[styles.mdSub, { color: colors.textSecondary }]}>
              Enter the 8-character access code the child's guardian shared with you.
            </Text>
            <TextInput
              value={codeInput}
              onChangeText={(t) => setCodeInput(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="Access code"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={8}
              style={[styles.mdInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              onSubmitEditing={submitCode}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable
                style={({ pressed }) => [styles.mdCancel, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setAddOpen(false)}
              >
                <Text style={[styles.mdCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={codeInput.length !== 8 || adding}
                style={({ pressed }) => [
                  styles.mdAdd,
                  { backgroundColor: codeInput.length === 8 ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={submitCode}
              >
                {adding ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={[styles.mdAddText, { color: codeInput.length === 8 ? "#fff" : colors.textMuted }]}>Add</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onUpdatePhoto={() => { setSettingsOpen(false); pickPhoto(); }}
        uploading={photoUploading}
        canEditPhoto
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingBottom: 16, gap: 12 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontWeight: "500", marginTop: 2 },
  avatarBtn: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  centerBox: { paddingVertical: 60, alignItems: "center" },
  emptyBox: { borderWidth: 1, borderRadius: 18, padding: 28, alignItems: "center", gap: 10, marginTop: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 13, fontWeight: "400", textAlign: "center", lineHeight: 19 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  activeRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  activeCol: { flex: 1, gap: 3 },
  activeDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", marginHorizontal: 12 },
  activeHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 },
  activeValue: { fontSize: 17, fontWeight: "800" },
  activeAge: { fontSize: 11.5, fontWeight: "500" },
  activeNone: { fontSize: 13, fontWeight: "500", fontStyle: "italic" },
  kidAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  kidInitials: { fontSize: 17, fontWeight: "700" },
  kidName: { fontSize: 18, fontWeight: "700" },
  kidMeta: { fontSize: 13, fontWeight: "500", marginTop: 2 },
  ring: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  ringValue: { fontSize: 20, fontWeight: "800" },
  ringUnit: { fontSize: 9, fontWeight: "600", marginTop: -1 },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1.5, borderStyle: "dashed", borderRadius: 16, paddingVertical: 16, marginTop: 6,
  },
  addBtnText: { fontSize: 15, fontWeight: "700" },
  mdBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  mdCard: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  mdTitle: { fontSize: 18, fontWeight: "800" },
  mdSub: { fontSize: 13, fontWeight: "400", lineHeight: 19 },
  mdInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, fontWeight: "700", letterSpacing: 3, textAlign: "center" },
  mdCancel: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  mdCancelText: { fontSize: 15, fontWeight: "600" },
  mdAdd: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  mdAddText: { fontSize: 15, fontWeight: "700" },
});
