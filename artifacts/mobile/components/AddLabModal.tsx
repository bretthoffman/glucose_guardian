/**
 * Add lab results: snap a photo of the report (read for you, then you check it), type one in, or
 * pull from MyChart (when available). Nothing is saved until the family taps Save.
 */
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade, CardShade } from "@/components/Shade";
import { apiUrl } from "@/utils/api-base-url";
import {
  LAB_TEST_CHOICES,
  newLabId,
  parseLabDate,
  toLocalIsoDate,
  type LabResult,
  type LabTest,
} from "@/utils/labs";
import { myChartAvailable } from "@/utils/mychartClient";

type Palette = (typeof Colors)["light"];
type Draft = { key: string; test: LabTest; name: string; valueText: string; unit: string; date: string; refRange?: string; keep: boolean };

function draftToLab(d: Draft, source: LabResult["source"]): Omit<LabResult, "authorName"> | string {
  const takenOn = parseLabDate(d.date);
  if (!takenOn) return `Check the date for ${d.name} (like 10/26/2026).`;
  const n = Number(d.valueText.replace(/[^0-9.]/g, ""));
  const numeric = d.valueText.trim() !== "" && /^[<>]?\s*\d+(\.\d+)?\s*%?$/.test(d.valueText.trim()) && Number.isFinite(n);
  if (!d.valueText.trim()) return `Enter the result for ${d.name}.`;
  if (d.test === "a1c" && (!numeric || n < 3 || n > 20)) return "An A1C is a number like 7.8. Check it.";
  return {
    id: newLabId(),
    test: d.test,
    name: d.name.trim() || "Lab result",
    ...(numeric ? { value: n } : { valueText: d.valueText.trim() }),
    ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
    ...(d.refRange ? { refRange: d.refRange } : {}),
    takenOn,
    source,
  };
}

function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : iso;
}

export default function AddLabModal({
  colors,
  onClose,
  onSave,
  onMyChart,
}: {
  colors: Palette;
  onClose: () => void;
  /** Saves each result (the caller confirms for caregivers); resolves when done. */
  onSave: (labs: Omit<LabResult, "authorName">[]) => Promise<void>;
  onMyChart?: () => void;
}) {
  const today = usDate(toLocalIsoDate(new Date()));
  const [mode, setMode] = useState<"choose" | "reading" | "review">("choose");
  const [source, setSource] = useState<LabResult["source"]>("manual");
  const [drafts, setDrafts] = useState<Draft[]>([
    { key: "d0", test: "a1c", name: "A1C", valueText: "", unit: "%", date: today, keep: true },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  async function snap(fromCamera: boolean) {
    setError("");
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", fromCamera ? "Allow camera access to snap the result." : "Allow photo access to pick the result.");
      return;
    }
    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    setMode("reading");
    try {
      const img = await ImageManipulator.manipulateAsync(picked.assets[0].uri, [{ resize: { width: 1400 } }], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      const res = await fetch(apiUrl("/api/labs/read-photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoBase64: img.base64, mimeType: "image/jpeg" }),
      });
      const body = (await res.json()) as { results?: { test: LabTest; name: string; value?: number; valueText?: string; unit?: string; refRange?: string; takenOn?: string }[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't read that photo.");
      const found = body.results ?? [];
      if (found.length === 0) {
        setError("Couldn't find a lab result in that photo. Try a closer shot, or type it in.");
        setMode("choose");
        return;
      }
      setSource("photo");
      setDrafts(
        found.map((r, i) => {
          const choice = LAB_TEST_CHOICES.find((c) => c.test === r.test);
          return {
            key: `p${i}`,
            test: r.test,
            name: r.test === "other" ? r.name : choice?.name ?? r.name,
            valueText: r.value != null ? String(r.value) : r.valueText ?? "",
            unit: r.unit ?? choice?.unit ?? "",
            date: r.takenOn ? usDate(r.takenOn) : today,
            refRange: r.refRange,
            keep: r.test !== "other",
          };
        }),
      );
      setMode("review");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
      setMode("choose");
    }
  }

  async function save() {
    setError("");
    const chosen = drafts.filter((d) => d.keep);
    if (chosen.length === 0) {
      setError("Pick at least one result to save.");
      return;
    }
    const labs: Omit<LabResult, "authorName">[] = [];
    for (const d of chosen) {
      const lab = draftToLab(d, source);
      if (typeof lab === "string") {
        setError(lab);
        return;
      }
      labs.push(lab);
    }
    setSaving(true);
    try {
      await onSave(labs);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message.replace(/^.*ConvexError:\s*/, "") : "Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel="Add a lab result">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.title, { color: colors.text }]}>{mode === "review" ? "Check what was read" : "Add a lab result"}</Text>

        {mode === "reading" && (
          <View style={styles.reading}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={[styles.body, { color: colors.textSecondary }]}>Reading the result…</Text>
          </View>
        )}

        {mode === "choose" && (
          <>
            {onMyChart && myChartAvailable() && (
              <Pressable accessibilityRole="button" onPress={onMyChart} style={[styles.bigRow, { borderColor: COLORS.primaryLight + "66", backgroundColor: COLORS.primary + "22" }]}>
                <Feather name="link" size={18} color={COLORS.primaryLight} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>Get results from MyChart</Text>
                  <Text style={[styles.rowSub, { color: colors.textSecondary }]}>Sign in on MyChart's own page</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable accessibilityRole="button" onPress={() => snap(true)} style={[styles.snapBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
                <Feather name="camera" size={18} color={colors.text} />
                <Text style={[styles.snapText, { color: colors.text }]}>Snap it</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => snap(false)} style={[styles.snapBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
                <Feather name="image" size={18} color={colors.text} />
                <Text style={[styles.snapText, { color: colors.text }]}>From photos</Text>
              </Pressable>
            </View>
            <Text style={[styles.hint, { color: colors.textMuted }]}>A photo of a lab report or a MyChart screen works. You check the numbers before saving.</Text>
            <Text style={[styles.label, { color: colors.textMuted }]}>OR TYPE IT</Text>
          </>
        )}

        {(mode === "choose" || mode === "review") &&
          drafts.map((d) => (
            <View key={d.key} style={[styles.draft, { borderColor: colors.border, opacity: d.keep ? 1 : 0.5 }]}>
              {mode === "review" && (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: d.keep }}
                  onPress={() => patch(d.key, { keep: !d.keep })}
                  style={styles.keepRow}
                >
                  <Feather name={d.keep ? "check-square" : "square"} size={18} color={d.keep ? COLORS.primaryLight : colors.textMuted} />
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{d.name}</Text>
                </Pressable>
              )}
              {mode === "choose" && (
                <View style={styles.chipRow}>
                  {LAB_TEST_CHOICES.map((c) => {
                    const on = d.test === c.test;
                    return (
                      <Pressable
                        key={c.test}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => patch(d.key, { test: c.test, name: c.test === "other" ? "" : c.name, unit: c.unit ?? "" })}
                        style={[styles.chip, { borderColor: on ? COLORS.primaryLight : colors.border, backgroundColor: on ? COLORS.primary + "33" : colors.backgroundTertiary }]}
                      >
                        <Text style={[styles.chipText, { color: colors.text, fontWeight: on ? "700" : "600" }]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {mode === "choose" && d.test === "other" && (
                <TextInput
                  value={d.name}
                  onChangeText={(t) => patch(d.key, { name: t.slice(0, 60) })}
                  placeholder="Test name"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Test name"
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
                />
              )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Result{d.unit ? ` (${d.unit})` : ""}</Text>
                  <TextInput
                    value={d.valueText}
                    onChangeText={(t) => patch(d.key, { valueText: t.slice(0, 40) })}
                    placeholder={d.test === "a1c" ? "7.8" : d.test === "celiac" ? "Negative" : "Result"}
                    placeholderTextColor={colors.textMuted}
                    keyboardType={d.test === "celiac" || d.test === "other" ? "default" : "decimal-pad"}
                    accessibilityLabel={`${d.name} result`}
                    style={[styles.input, styles.valueInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Date drawn</Text>
                  <TextInput
                    value={d.date}
                    onChangeText={(t) => patch(d.key, { date: t.slice(0, 20) })}
                    placeholder="10/26/2026"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel={`${d.name} date drawn`}
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
                  />
                </View>
              </View>
              {d.refRange ? <Text style={[styles.hint, { color: colors.textMuted }]}>Lab range: {d.refRange}</Text> : null}
            </View>
          ))}

        {!!error && <Text style={[styles.error, { color: COLORS.danger }]}>{error}</Text>}

        {mode !== "reading" && (
          <Pressable accessibilityRole="button" disabled={saving} onPress={save} style={({ pressed }) => [styles.primary, { opacity: saving ? 0.5 : pressed ? 0.85 : 1 }]}>
            <AccentShade radius={14} />
            <Text style={styles.primaryText}>
              {saving ? "Saving…" : mode === "review" ? `Save ${drafts.filter((d) => d.keep).length === 1 ? "result" : `${drafts.filter((d) => d.keep).length} results`}` : "Save result"}
            </Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" onPress={mode === "review" ? () => { setMode("choose"); setSource("manual"); setDrafts([{ key: "d0", test: "a1c", name: "A1C", valueText: "", unit: "%", date: today, keep: true }]); } : onClose} style={styles.textBtn}>
          <Text style={[styles.textBtnText, { color: colors.textSecondary }]}>{mode === "review" ? "Start over" : "Cancel"}</Text>
        </Pressable>
      </View>
    </DashboardSectionModal>
  );
}


const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12.5, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 6 },
  reading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20, justifyContent: "center" },
  bigRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  rowTitle: { fontSize: 15.5, fontWeight: "700" },
  rowSub: { fontSize: 12.5 },
  snapBtn: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  snapText: { fontSize: 15, fontWeight: "700" },
  draft: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  keepRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13.5 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  valueInput: { fontSize: 17, fontWeight: "700" },
  error: { fontSize: 13.5, fontWeight: "600" },
  primary: { height: 50, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  primaryText: { color: "#fff", fontSize: 16.5, fontWeight: "700" },
  textBtn: { alignItems: "center", paddingVertical: 8 },
  textBtnText: { fontSize: 15, fontWeight: "600" },
});
