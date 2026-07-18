/**
 * FoodInsulinModal — the Food page's "Calculate Insulin" popup. Visually it's the Insulin page's
 * dose calculator card, but fully self-contained: its carb field is pre-filled from the analyzed
 * meal and shares NO state with the main calculator. The insulin type is locked to the user's
 * mealtime (short-acting) insulin — displayed, not changeable. IOB/COB aware like the main
 * calculator, so a dose logged here immediately nets out of the next suggestion everywhere.
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { DoseRow, DoseWarningsList, EditableDoseTotalBadge } from "@/components/DoseCalculatorBits";
import {
  findInsulinByChipLabel,
  insulinChipLabel,
  insulinDisplayLabel,
  isBolusInsulin,
  type InsulinOption,
} from "@/constants/insulin";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { computeDose } from "@/utils/dose";
import type { DoseBreakdown } from "@/utils/dose";
import {
  doseAmountsEqual,
  filterDoseInputText,
  finalizeManualDoseInput,
  formatDoseAmount,
  roundToQuarterUnits,
} from "@/utils/doseOverride";
import { computeActiveCarbs, computeActiveInsulin, formatAgeShort } from "@/utils/onBoard";
import { getEffectiveTrend } from "@/utils/trend";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Carbs from the food analysis — pre-fills this popup's own carb field. */
  initialCarbs: number;
  /** Shown in the subtitle, e.g. the analyzed food's name. */
  foodName?: string;
  /** Called once the dose is logged — parent closes the popup and turns its button green. */
  onLogged: () => void;
  colors: (typeof Colors)["light"];
}

export default function FoodInsulinModal({
  visible,
  onClose,
  initialCarbs,
  foodName,
  onLogged,
  colors,
}: Props) {
  const { targetGlucose, carbRatio, correctionFactor, history } = useGlucose();
  const { profile, insulinLog, foodLog, logInsulinDose, isMinor } = useAuth();

  const [carbInput, setCarbInput] = useState("");
  const [bgInput, setBgInput] = useState("");
  const [bgManual, setBgManual] = useState(false);
  const [manualDoseOverride, setManualDoseOverride] = useState<number | null>(null);
  const [doseEditing, setDoseEditing] = useState(false);
  const [doseEditText, setDoseEditText] = useState("");
  const manualOverrideBeforeEditRef = useRef<number | null>(null);
  const doseInputRef = useRef<TextInput>(null);

  // Fresh calculator per open: analyzed carbs in, live BG, no leftover override.
  useEffect(() => {
    if (!visible) return;
    setCarbInput(initialCarbs > 0 ? String(initialCarbs) : "");
    setBgInput("");
    setBgManual(false);
    setManualDoseOverride(null);
    setDoseEditing(false);
  }, [visible, initialCarbs]);

  /** Locked mealtime insulin: the user's first rapid-acting, else first bolus-capable one. */
  const lockedInsulin = useMemo<InsulinOption | undefined>(() => {
    const opts = (profile?.insulinTypes ?? [])
      .map(findInsulinByChipLabel)
      .filter((o): o is InsulinOption => o != null);
    return opts.find((o) => o.type === "rapid") ?? opts.find((o) => isBolusInsulin(o.type));
  }, [profile?.insulinTypes]);

  const latest = history[history.length - 1];

  const doseBg = useMemo(() => {
    if (bgManual) {
      const v = parseFloat(bgInput);
      if (!isNaN(v) && v > 0) return { n: v, label: bgInput } as const;
      return null;
    }
    if (latest != null && latest.glucose > 0) {
      return { n: latest.glucose, label: String(latest.glucose) } as const;
    }
    return null;
  }, [bgManual, bgInput, latest?.glucose, latest?.timestamp]);

  // Transient popup — computed per render is fresh enough (no 30s tick needed).
  const activeInsulin = useMemo(
    () => computeActiveInsulin(insulinLog ?? [], Date.now()),
    [insulinLog, visible],
  );
  const activeCarbs = useMemo(
    () => computeActiveCarbs(foodLog ?? [], Date.now()),
    [foodLog, visible],
  );

  const hasCarbs = carbInput !== "" && parseFloat(carbInput) > 0;

  const dose = useMemo<DoseBreakdown | null>(() => {
    const carbs = carbInput === "" ? 0 : parseFloat(carbInput);
    if (!doseBg || isNaN(carbs) || carbs < 0) return null;
    const trend = latest ? getEffectiveTrend(history).glucoseTrend : "stable";
    const prev = history.length >= 2 ? history[history.length - 2].glucose : undefined;
    return computeDose({
      carbs,
      currentBG: doseBg.n,
      targetBG: targetGlucose,
      carbRatio,
      correctionFactor,
      trend,
      previousBG: prev,
      insulinKind: lockedInsulin?.type,
      activeInsulinUnits: activeInsulin.totalUnits,
      activeCarbsGrams: activeCarbs.totalGrams,
    });
  }, [carbInput, doseBg, targetGlucose, carbRatio, correctionFactor, history, latest, lockedInsulin, activeInsulin, activeCarbs]);

  const systemRecommendedDose = dose?.totalDose ?? 0;
  const effectiveDose = manualDoseOverride ?? systemRecommendedDose;

  const completeDoseEdit = useCallback(() => {
    if (!doseEditing) return;
    const finalized = finalizeManualDoseInput(doseEditText);
    if (finalized == null) {
      setManualDoseOverride(manualOverrideBeforeEditRef.current);
    } else if (finalized === systemRecommendedDose) {
      setManualDoseOverride(null);
    } else {
      setManualDoseOverride(finalized);
    }
    setDoseEditing(false);
  }, [doseEditing, doseEditText, systemRecommendedDose]);

  const startDoseEdit = useCallback(() => {
    manualOverrideBeforeEditRef.current = manualDoseOverride;
    setDoseEditText(formatDoseAmount(manualDoseOverride ?? systemRecommendedDose));
    setDoseEditing(true);
    requestAnimationFrame(() => {
      doseInputRef.current?.focus();
    });
  }, [manualDoseOverride, systemRecommendedDose]);

  const handleTookInsulin = () => {
    if (!dose || effectiveDose <= 0) return;
    const wasManual =
      manualDoseOverride != null && !doseAmountsEqual(effectiveDose, systemRecommendedDose);
    logInsulinDose({
      timestamp: new Date().toISOString(),
      units: roundToQuarterUnits(effectiveDose),
      type: "bolus",
      ...(lockedInsulin ? { insulinType: insulinChipLabel(lockedInsulin) } : {}),
      recommendedUnits: roundToQuarterUnits(systemRecommendedDose),
      manualOverride: wasManual,
    });
    onLogged();
  };

  return (
    <DashboardSectionModal visible={visible} onClose={onClose} accessibilityLabel="Meal insulin calculator">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Insulin Calculator</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {foodName ? `For ${foodName} — carbs pre-filled from the analysis.` : "Carbs pre-filled from the analysis."}
        </Text>

        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Carbs (g)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              value={carbInput}
              onChangeText={(v) => setCarbInput(v.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputGroup}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Current BG</Text>
              {latest && !bgManual && (
                <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                  <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                </View>
              )}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: bgManual ? COLORS.primary : colors.border }]}
              value={bgManual ? bgInput : doseBg?.label ?? ""}
              onChangeText={(v) => { setBgInput(v.replace(/[^0-9]/g, "")); setBgManual(true); }}
              keyboardType="numeric"
              placeholder="mg/dL"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        {/* Locked mealtime insulin — shows the name, no change button by design. */}
        <View style={styles.lockedRow}>
          <Text numberOfLines={1} style={[styles.lockedCurrent, { color: colors.textMuted }]}>
            Mealtime insulin
          </Text>
          <View style={[styles.lockedTag, { backgroundColor: COLORS.primary + "16", borderColor: COLORS.primary + "50" }]}>
            <Feather name="lock" size={11} color={COLORS.primary} />
            <Text numberOfLines={1} style={[styles.lockedTagText, { color: COLORS.primary }]}>
              {lockedInsulin ? insulinDisplayLabel(lockedInsulin) : "No mealtime insulin set"}
            </Text>
          </View>
        </View>

        {dose && doseBg ? (
          <>
            <DoseWarningsList warnings={dose.warnings} />

            <View style={[styles.breakdown, { borderTopColor: colors.border }]}>
              {hasCarbs && (
                <DoseRow label="Carb Dose" sub={`${parseFloat(carbInput)}g ÷ ${carbRatio}g`} value={dose.carbInsulin} unit="u" colors={colors} />
              )}
              <DoseRow
                label="Correction"
                sub={dose.correctionSuppressed
                  ? "BG below target — suppressed"
                  : `(${doseBg.label} − ${targetGlucose}) ÷ ${correctionFactor}`}
                value={dose.correctionInsulin}
                unit="u"
                colors={colors}
                dimmed={dose.correctionSuppressed}
              />
              <DoseRow label="Trend Adj." sub={dose.trendLabel} value={dose.trendAdjustment} unit="u" colors={colors} signed />
              {dose.activeCarbInsulin > 0 && (
                <DoseRow
                  label="Active Carbs"
                  sub={`${activeCarbs.totalGrams}g still absorbing · logged ${formatAgeShort(activeCarbs.lastEntryAgeMin)}${activeCarbs.lastEntryAgeMin != null && activeCarbs.lastEntryAgeMin >= 1 ? " ago" : ""}`}
                  value={dose.activeCarbInsulin}
                  unit="u"
                  colors={colors}
                  signed
                />
              )}
              {dose.activeInsulinUnits > 0 && (
                <DoseRow
                  label="Active Insulin"
                  sub={`${
                    activeInsulin.doseCount > 1
                      ? `${activeInsulin.doseCount} recent doses`
                      : `${formatDoseAmount(activeInsulin.lastDoseUnits ?? 0)}u`
                  } · taken ${formatAgeShort(activeInsulin.lastDoseAgeMin)}${activeInsulin.lastDoseAgeMin != null && activeInsulin.lastDoseAgeMin >= 1 ? " ago" : ""}`}
                  value={-dose.activeInsulinUnits}
                  unit="u"
                  colors={colors}
                  signed
                />
              )}
            </View>

            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <View style={styles.totalLabelWrap}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
                  {isMinor
                    ? "Ask your adult to give:"
                    : hasCarbs
                    ? `Insulin to give (with ${carbInput}g carbs)`
                    : "Insulin to give (no carbs)"}
                </Text>
                {dose.totalRaw !== dose.totalDose && (
                  <Text style={[styles.roundNote, { color: colors.textMuted }]}>
                    Raw {dose.totalRaw}u → rounded to nearest ½
                  </Text>
                )}
              </View>
              <EditableDoseTotalBadge
                effectiveDose={effectiveDose}
                systemRecommendedDose={systemRecommendedDose}
                manualOverrideActive={manualDoseOverride != null}
                editing={doseEditing}
                editText={doseEditText}
                inputRef={doseInputRef}
                colors={colors}
                onStartEdit={startDoseEdit}
                onChangeEditText={(t) => setDoseEditText(filterDoseInputText(t))}
                onCompleteEdit={completeDoseEdit}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I took this insulin"
              disabled={effectiveDose <= 0}
              style={({ pressed }) => [
                styles.tookBtn,
                { backgroundColor: COLORS.primary, opacity: pressed ? 0.8 : effectiveDose <= 0 ? 0.5 : 1 },
              ]}
              onPress={handleTookInsulin}
            >
              <Feather name="check" size={14} color="#fff" />
              <Text style={styles.tookBtnText}>I Took This Insulin</Text>
            </Pressable>
          </>
        ) : (
          <Text style={[styles.prompt, { color: colors.textMuted }]}>
            No glucose reading available — enter your current BG above to calculate this dose.
          </Text>
        )}
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -8 },

  inputRow: { flexDirection: "row", gap: 12 },
  inputGroup: { flex: 1, gap: 6 },
  inputLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, fontWeight: "700", textAlign: "center" },
  inputDivider: { width: 1, backgroundColor: "rgba(128,128,128,0.15)", marginVertical: 4 },
  liveTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveTagText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },

  lockedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  lockedCurrent: { fontSize: 11, fontWeight: "500" },
  lockedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 1,
  },
  lockedTagText: { fontSize: 11, fontWeight: "700" },

  breakdown: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 14, gap: 10 },
  totalLabelWrap: { flex: 1, minWidth: 0 },
  totalLabel: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  roundNote: { fontSize: 11, fontWeight: "400" },

  tookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, borderRadius: 11 },
  tookBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  prompt: { fontSize: 13, fontWeight: "400", lineHeight: 20, textAlign: "center", paddingVertical: 8 },
});
