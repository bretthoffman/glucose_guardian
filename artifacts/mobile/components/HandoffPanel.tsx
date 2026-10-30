/**
 * Dashboard → Handoff (parents). Shows the catch-up a caregiver will see when they open the app, lets
 * the parent add an optional note (to everyone, or only some caregivers), and shows who saw it.
 * The sheet itself is filled in automatically (components/HandoffSheet); the note is the only thing
 * anyone types.
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery } from "convex/react";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import Colors, { COLORS } from "@/constants/colors";
import { AccentShade, CardShade } from "@/components/Shade";
import { HandoffBody, fmtClock, useHandoffSummaryBuilder, useHandoffViewer } from "@/components/HandoffSheet";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/utils/convex-auth-client";
import { firstName, joinNames } from "@/utils/handoff";

type Palette = (typeof Colors)["light"];

interface SentNote {
  id: string;
  text: string;
  recipientCodes: string[];
  createdAt: number;
  seen: { name: string; at: number }[];
}

export default function HandoffPanel({ colors }: { colors: Palette; onClose?: () => void }) {
  const { account } = useAuth();
  const viewer = useHandoffViewer();
  const build = useHandoffSummaryBuilder(viewer);
  const myUserId = (account?.convexUserId ?? null) as Id<"users"> | null;
  const memberships = useQuery(api.careCircle.myMemberships, myUserId ? {} : "skip");
  const anchor = ((memberships?.[0]?.patientUserId as Id<"users"> | undefined) ?? myUserId) as Id<"users"> | null;
  const circle = useQuery(api.careCircle.getCircle, myUserId && memberships !== undefined && anchor ? { patientUserId: anchor } : "skip");
  const forMe = useQuery(api.handoff.forMe, viewer?.kind === "family" ? {} : "skip") as { sent: SentNote | null } | null | undefined;
  const leaveNote = useMutation(api.handoff.leaveNote);

  const caregivers = useMemo(
    () =>
      ((circle?.accessCodes ?? []) as { code: string; label: string; kind: "caregiver" | "child" }[])
        .filter((c) => c.kind !== "child")
        .map((c) => ({ code: c.code, name: c.label })),
    [circle?.accessCodes],
  );

  const sent = forMe?.sent ?? null;
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // empty = everyone
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // Start from the note that's out there now, so they can edit it.
  useEffect(() => {
    if (forMe === undefined) return;
    const key = sent?.id ?? "none";
    if (loadedFrom === key) return;
    setLoadedFrom(key);
    setDraft(sent?.text ?? "");
    setPicked(sent?.recipientCodes ?? []);
  }, [forMe, sent, loadedFrom]);

  // Greets whoever is picked ("Holly and Andrea"); for everyone, no name (each person sees their own).
  const pickedNames = picked.map((code) => caregivers.find((c) => c.code === code)?.name).filter((n): n is string => !!n).map(firstName);
  const preview = build({ kind: "caregiver", greetAs: joinNames(pickedNames) });
  const ownName = viewer?.name || "you";
  const previewNote = draft.trim() ? { id: "preview", text: draft.trim(), fromName: ownName, createdAt: Date.now() } : null;

  const toggle = (code: string) => {
    Haptics.selectionAsync();
    setPicked((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  };

  const save = async (text: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await leaveNote({ text, recipientCodes: picked.length ? picked : undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedAt(Date.now());
      if (!text.trim()) setDraft("");
    } catch {
      setError("Couldn't save the note. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const sentTo = sent
    ? sent.recipientCodes.length
      ? sent.recipientCodes.map((c) => caregivers.find((x) => x.code === c)?.name ?? c).map(firstName).join(", ")
      : "everyone"
    : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={styles.headerRow}>
        <View style={[styles.headerIcon, { backgroundColor: "#A78BFA22" }]}>
          <Feather name="repeat" size={20} color="#A78BFA" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Handoff</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            When the school nurse or grandma opens the app, this catch-up pops up first. It fills in by itself. A note is optional.
          </Text>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.textMuted }]}>WHAT THEY'LL SEE</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>Each caregiver sees it with their own name.</Text>
      <View style={[styles.preview, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.previewTitle, { color: colors.text }]}>{preview.heading}</Text>
        <HandoffBody summary={preview} note={previewNote} colors={colors} />
      </View>

      <Text style={[styles.section, { color: colors.textMuted }]}>YOUR NOTE (OPTIONAL)</Text>
      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setSavedAt(null);
        }}
        placeholder="Rough night, extra snack in her backpack"
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={500}
        autoCapitalize="sentences"
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
        accessibilityLabel="Note for caregivers"
      />

      {caregivers.length > 0 && (
        <>
          <Text style={[styles.section, { color: colors.textMuted }]}>WHO GETS THE NOTE</Text>
          <View style={styles.chips}>
            <Chip label="Everyone" on={picked.length === 0} onPress={() => setPicked([])} colors={colors} />
            {caregivers.map((c) => (
              <Chip key={c.code} label={firstName(c.name)} on={picked.includes(c.code)} onPress={() => toggle(c.code)} colors={colors} />
            ))}
          </View>
        </>
      )}

      {sent && (
        <View style={[styles.status, { backgroundColor: colors.backgroundTertiary }]}>
          <Feather name={sent.seen.length ? "check-circle" : "clock"} size={16} color={sent.seen.length ? COLORS.success : colors.textMuted} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {sent.seen.length
              ? sent.seen.map((s) => `${firstName(s.name)} saw it at ${fmtClock(s.at)}`).join(". ")
              : `Note left at ${fmtClock(sent.createdAt)} for ${sentTo}. Not seen yet.`}
          </Text>
        </View>
      )}

      {!!error && <Text style={[styles.statusText, { color: COLORS.danger }]}>{error}</Text>}

      <Pressable
        onPress={() => save(draft)}
        disabled={saving || !draft.trim()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.primaryBtn, { opacity: saving || !draft.trim() ? 0.5 : pressed ? 0.85 : 1 }]}
      >
        <AccentShade radius={14} />
        <Text style={styles.primaryBtnText}>{saving ? "Saving..." : savedAt ? "Saved" : sent ? "Update note" : "Save note"}</Text>
      </Pressable>
      {sent && (
        <Pressable onPress={() => save("")} disabled={saving} accessibilityRole="button" style={styles.linkBtn}>
          <Text style={[styles.linkText, { color: COLORS.danger }]}>Remove note</Text>
        </Pressable>
      )}
      <Text style={[styles.foot, { color: colors.textMuted }]}>Notes show for one day. A new note replaces the last one.</Text>
    </View>
  );
}

function Chip({ label, on, onPress, colors }: { label: string; on: boolean; onPress: () => void; colors: Palette }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, { borderColor: on ? COLORS.primary : colors.border, backgroundColor: on ? COLORS.primary + "22" : "transparent" }]}
    >
      {on && <Feather name="check" size={14} color={COLORS.primaryLight} />}
      <Text style={[styles.chipText, { color: on ? COLORS.primaryLight : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  hint: { fontSize: 13, marginTop: -6 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 4 },
  preview: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  previewTitle: { fontSize: 18, fontWeight: "800", lineHeight: 24 },
  input: { borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 72, fontSize: 16, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 15, fontWeight: "600" },
  status: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 12, padding: 12 },
  statusText: { flex: 1, fontSize: 14, lineHeight: 19 },
  primaryBtn: {
    marginTop: 4,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingVertical: 6 },
  linkText: { fontSize: 15, fontWeight: "600" },
  foot: { fontSize: 12.5, textAlign: "center" },
});
