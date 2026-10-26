/**
 * Lab results under the A1C card (Dashboard → A1C): the latest lab A1C with its change and how the
 * app's estimate for the 90 days before it compared, other recent labs, Add a result (snap, type,
 * or MyChart), "Ways to help" from the last two weeks, and (owner only) who sees meal tips.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Id } from "../../../convex/_generated/dataModel";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useLabResults } from "@/hooks/useLabResults";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import AddLabModal from "@/components/AddLabModal";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { CardShade } from "@/components/Shade";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { estimateA1C } from "@/utils/a1c";
import { mergeWindowStats, windowChunks } from "@/utils/a1cRange";
import { fetchGlucoseRange, type GlucoseIdentity } from "@/utils/glucoseRangeFetch";
import {
  a1cChange,
  a1cResults,
  estimateVsLab,
  formatLabDate,
  formatLabValue,
  labGlucoseNote,
  newLabId,
  sortLabs,
  type LabResult,
} from "@/utils/labs";
import { canSeeMealTips, waysToHelp, type WaysToHelp } from "@/utils/mealTips";
import { listMyChartOrgs, myChartAvailable, pullMyChartLabs, type MyChartOrg } from "@/utils/mychartClient";

type Palette = (typeof Colors)["light"];
const DAY_MS = 86_400_000;

function SourceTag({ source, colors }: { source: LabResult["source"]; colors: Palette }) {
  const label = source === "mychart" ? "MyChart" : source === "photo" ? "Photo" : "Typed";
  return <Text style={[styles.source, { color: colors.textMuted }]}>{label}</Text>;
}

export default function LabResultsSection({ colors }: { colors: Palette }) {
  const auth = useAuth();
  const { labs, canSee, canEdit, save, remove } = useLabResults();
  const confirmLog = useCareLogConfirm();
  const [adding, setAdding] = useState(false);
  const [pickOrg, setPickOrg] = useState<MyChartOrg[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const isOwner = !auth.isCircleMember;
  const name = auth.profile?.accountRole === "parent" ? auth.profile?.childName?.trim() || null : null;

  const sorted = useMemo(() => sortLabs(labs ?? []), [labs]);
  const a1cs = useMemo(() => a1cResults(sorted), [sorted]);
  const latest = a1cs[0];
  const others = useMemo(() => {
    const seen = new Set<string>();
    return sorted.filter((l) => {
      if (l.test === "a1c" || seen.has(l.test + l.name)) return false;
      seen.add(l.test + l.name);
      return true;
    }).slice(0, 4);
  }, [sorted]);

  // The app's estimate for the 90 days before the latest lab A1C (the real accuracy check).
  const [estimateAtLab, setEstimateAtLab] = useState<number | null>(null);
  useEffect(() => {
    setEstimateAtLab(null);
    const acc = auth.account;
    if (!latest || !acc?.convexUserId || !canSee) return;
    let cancelled = false;
    (async () => {
      try {
        const endMs = new Date(`${latest.takenOn}T23:59:59`).getTime();
        const client = createConvexAuthClient();
        const parts = await Promise.all(
          windowChunks(90, endMs).map((w) =>
            client.query(api.patientGlucose.windowStats, {
              userId: acc.convexUserId as Id<"users">,
              passwordHash: acc.passwordHash,
              startTimestamp: w.startTimestamp,
              endTimestamp: w.endTimestamp,
              lowThreshold: 70,
              highThreshold: 180,
            }),
          ),
        );
        const merged = mergeWindowStats(parts);
        // Only compare when the sensor covered a good part of those 90 days (14+ days' worth).
        if (!cancelled && merged.count >= 14 * 96) setEstimateAtLab(estimateA1C(Math.round(merged.sum / merged.count)));
      } catch {
        /* offline: just skip the comparison */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latest?.takenOn, latest?.value, auth.account?.convexUserId, canSee]);

  // "Ways to help": the last two weeks of readings, bucketed by part of the day.
  const tipsVisible = canSeeMealTips({
    isChildMode: auth.isChildMode,
    isCaregiver: !!auth.caregiverSession || auth.isCaregiverAccount || !!auth.nurseViewCode,
    mealTipsCaregivers: auth.profile?.mealTipsCaregivers,
    mealTipsChildMode: auth.profile?.mealTipsChildMode,
  });
  const [ways, setWays] = useState<WaysToHelp | null | "loading">(null);
  useEffect(() => {
    if (!canSee || !tipsVisible) return;
    const identity: GlucoseIdentity = {
      isSignedIn: auth.isSignedIn,
      convexUserId: auth.account?.convexUserId,
      passwordHash: auth.account?.passwordHash,
      caregiverSession: !!auth.caregiverSession,
      caregiverCloudCode: auth.caregiverCloudCode,
      caregiverCodeKind: auth.caregiverCodeKind,
      nurseViewCode: auth.nurseViewCode,
      viewingPatientId: auth.viewingPatientId,
    };
    let cancelled = false;
    setWays("loading");
    const now = Date.now();
    fetchGlucoseRange(identity, now - 14 * DAY_MS, now)
      .then((rows) => {
        if (!cancelled) setWays(waysToHelp(rows, 180, name, -new Date().getTimezoneOffset()));
      })
      .catch(() => {
        if (!cancelled) setWays(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, tipsVisible, auth.account?.convexUserId, auth.viewingPatientId]);

  if (!canSee) return null;

  const saveAll = (list: Omit<LabResult, "authorName">[]) =>
    new Promise<void>((resolve, reject) => {
      confirmLog(() => {
        (async () => {
          for (const l of list) await save(l);
        })().then(resolve, reject);
      });
    });

  async function startMyChart() {
    setAdding(false);
    setPickOrg(await listMyChartOrgs());
  }

  async function pullFrom(org: MyChartOrg) {
    setPickOrg(null);
    setPulling(true);
    const r = await pullMyChartLabs(org);
    setPulling(false);
    if (!r.ok) {
      if (!r.cancelled) Alert.alert("MyChart", r.error);
      return;
    }
    if (r.labs.length === 0) {
      Alert.alert("MyChart", "No A1C, thyroid, celiac or glucose results were found.");
      return;
    }
    Alert.alert("MyChart", `Found ${r.labs.length} result${r.labs.length === 1 ? "" : "s"}. Results already here won't be added twice.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: () => {
          saveAll(r.labs.map((l) => ({ ...l, id: newLabId() }))).catch(() => Alert.alert("MyChart", "Couldn't save. Check your connection."));
        },
      },
    ]);
  }

  function askRemove(l: LabResult) {
    if (!canEdit) return;
    Alert.alert(`Remove this result?`, `${l.name} ${formatLabValue(l)}, ${formatLabDate(l.takenOn)}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove(l.id) },
    ]);
  }

  const change = latest ? a1cChange(latest, a1cs[1]) : null;

  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>LAB RESULTS</Text>

        {labs === undefined ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
        ) : !latest && others.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Add {name ? `${name}'s` : "your"} lab A1C to see it next to the app's estimate. Snap a photo of the result or type it in.
          </Text>
        ) : null}

        {latest && (
          <Pressable onLongPress={() => askRemove(latest)} accessibilityHint={canEdit ? "Long press to remove" : undefined}>
            <View style={styles.latestRow}>
              <Text style={[styles.latestValue, { color: colors.text }]}>{formatLabValue(latest)}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>Lab A1C</Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.date, { color: colors.textMuted }]}>{formatLabDate(latest.takenOn)}</Text>
            </View>
            {change && <Text style={[styles.change, { color: change.startsWith("Down") ? COLORS.success : colors.textSecondary }]}>{change}</Text>}
            {estimateAtLab != null && latest.value != null && (
              <Text style={[styles.body, { color: colors.textSecondary, marginTop: 6 }]}>{estimateVsLab(latest.value, estimateAtLab)}</Text>
            )}
          </Pressable>
        )}

        {a1cs.length > 1 && (
          <View style={[styles.list, { borderTopColor: colors.border }]}>
            {a1cs.slice(1, 5).map((l) => (
              <Pressable key={l.id} onLongPress={() => askRemove(l)} style={styles.listRow}>
                <Text style={[styles.rowName, { color: colors.text }]}>A1C {formatLabValue(l)}</Text>
                <SourceTag source={l.source} colors={colors} />
                <Text style={[styles.date, { color: colors.textMuted }]}>{formatLabDate(l.takenOn)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {others.length > 0 && (
          <View style={[styles.list, { borderTopColor: colors.border }]}>
            {others.map((l) => (
              <Pressable key={l.id} onLongPress={() => askRemove(l)} style={{ paddingVertical: 8, gap: 2 }}>
                <View style={styles.listRowInner}>
                  <Text style={[styles.rowName, { color: colors.text }]}>{l.name}</Text>
                  <Text style={[styles.rowValue, { color: colors.text }]}>{formatLabValue(l)}</Text>
                </View>
                <Text style={[styles.date, { color: colors.textMuted }]}>
                  {formatLabDate(l.takenOn)}
                  {l.test === "glucose" ? `. ${labGlucoseNote()}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {canEdit && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={[styles.outlineBtn, { borderColor: COLORS.primaryLight + "99" }]}>
              <Feather name="plus" size={16} color={COLORS.primaryLight} />
              <Text style={[styles.outlineText, { color: COLORS.primaryLight }]}>Add a result</Text>
            </Pressable>
            {myChartAvailable() && (
              <Pressable accessibilityRole="button" disabled={pulling} onPress={startMyChart} style={[styles.outlineBtn, { borderColor: colors.border }]}>
                {pulling ? <ActivityIndicator color={colors.text} /> : <Feather name="refresh-cw" size={15} color={colors.text} />}
                <Text style={[styles.outlineText, { color: colors.text }]}>MyChart</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {tipsVisible && ways && ways !== "loading" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>WAYS TO HELP</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{ways.intro}</Text>
          {ways.ideas.map((idea, i) => (
            <View key={idea.title} style={styles.idea}>
              <View style={[styles.ideaNum, { backgroundColor: idea.askDoctor ? COLORS.primary + "26" : COLORS.success + "24" }]}>
                <Text style={[styles.ideaNumText, { color: idea.askDoctor ? COLORS.primaryLight : COLORS.success }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.ideaText, { color: colors.text }]}>
                <Text style={{ fontWeight: "700" }}>{idea.title}</Text> {idea.body}
              </Text>
            </View>
          ))}
        </View>
      )}

      {isOwner && canEdit && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>MEAL TIPS</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Gentle ideas from {name ? `${name}'s` : "your"} own patterns, at most one a day. Never about insulin doses. Guardians always see them.
          </Text>
          <View style={styles.switchRow}>
            <Text style={[styles.rowName, { color: colors.text, flex: 1 }]}>Caregivers and nurses</Text>
            <Switch
              value={auth.profile?.mealTipsCaregivers !== false}
              onValueChange={(on) => { void auth.updateProfile({ mealTipsCaregivers: on }); }}
              accessibilityLabel="Show meal tips to caregivers and nurses"
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.rowName, { color: colors.text, flex: 1 }]}>Child Mode</Text>
            <Switch
              value={auth.profile?.mealTipsChildMode === true}
              onValueChange={(on) => { void auth.updateProfile({ mealTipsChildMode: on }); }}
              accessibilityLabel="Show meal tips in Child Mode"
            />
          </View>
        </View>
      )}

      {adding && (
        <AddLabModal
          colors={colors}
          onClose={() => setAdding(false)}
          onSave={saveAll}
          onMyChart={myChartAvailable() ? startMyChart : undefined}
        />
      )}
      {pickOrg && (
        <DashboardSectionModal visible onClose={() => setPickOrg(null)} accessibilityLabel="Pick your health system">
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <CardShade radius={16} />
            <Text style={[styles.title, { color: colors.text }]}>Find your health system</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>Then sign in on MyChart's own page. We never see your password and only read lab results.</Text>
            {pickOrg.map((o) => (
              <Pressable key={o.fhirBase} accessibilityRole="button" onPress={() => pullFrom(o)} style={[styles.orgRow, { borderColor: colors.border }]}>
                <Text style={[styles.rowName, { color: colors.text, flex: 1 }]}>{o.name}</Text>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </DashboardSectionModal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, overflow: "hidden" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  title: { fontSize: 19, fontWeight: "800" },
  body: { fontSize: 13.5, lineHeight: 19 },
  hint: { fontSize: 12.5, lineHeight: 18 },
  latestRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  latestValue: { fontSize: 30, fontWeight: "800" },
  date: { fontSize: 12.5 },
  change: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 2 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  listRowInner: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  rowName: { fontSize: 14.5, fontWeight: "600" },
  rowValue: { fontSize: 14.5, fontWeight: "700" },
  source: { fontSize: 11.5, fontWeight: "600", flex: 1 },
  outlineBtn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  outlineText: { fontSize: 14.5, fontWeight: "700" },
  idea: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 2 },
  ideaNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  ideaNumText: { fontSize: 12.5, fontWeight: "800" },
  ideaText: { flex: 1, fontSize: 14, lineHeight: 20 },
  switchRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  orgRow: { flexDirection: "row", alignItems: "center", minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
});
