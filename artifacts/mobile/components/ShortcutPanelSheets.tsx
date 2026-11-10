/**
 * Dashboard pop-ups that the shortcuts open right over the Glucose screen (closing one leaves you
 * there): A1C, Doctor Office, Care Circle, Handoff, Care Plan and Day Recap. Each is the same content
 * as its Dashboard pop-up; the shortcut is only offered to people who see that Dashboard row.
 */
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import A1CEstimateCard from "@/components/A1CEstimateCard";
import CareCirclePanel from "@/components/CareCirclePanel";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import DoctorOfficePanel from "@/components/DoctorOfficePanel";
import HandoffPanel from "@/components/HandoffPanel";
import LabResultsSection from "@/components/LabResultsSection";
import CarePlanPanel from "@/components/CarePlanPanel";
import { DayRecapPanel } from "@/components/DayRecap";
import { useShortcutAccess } from "@/hooks/useShortcuts";
import { CardShade } from "@/components/Shade";
import { useTheme } from "@/context/ThemeContext";
import type { OverGlucoseSection } from "@/utils/shortcuts";

export default function ShortcutPanelSheets({
  request,
  onTreatLow,
}: {
  request: { section: OverGlucoseSection; nonce: number } | null;
  /** The Care Plan's "Treated it" button: close this and open Treated a Low over the Glucose screen. */
  onTreatLow?: () => void;
}) {
  const { canOpenLogs } = useShortcutAccess();
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const [open, setOpen] = useState<OverGlucoseSection | null>(null);
  useEffect(() => {
    if (request) setOpen(request.section);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setOpen(null);

  return (
    <>
      <DashboardSectionModal visible={open === "summary"} onClose={close} accessibilityLabel="A1C">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>A1C</Text>
          <A1CEstimateCard embedded />
        </View>
        <LabResultsSection colors={colors} />
      </DashboardSectionModal>

      <DashboardSectionModal visible={open === "doctor"} onClose={close} accessibilityLabel="Doctor Office">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>Doctor Office</Text>
          <DoctorOfficePanel colors={colors} />
        </View>
      </DashboardSectionModal>

      <DashboardSectionModal visible={open === "careCircle"} onClose={close} accessibilityLabel="Care Circle">
        <CareCirclePanel colors={colors} onClose={close} />
      </DashboardSectionModal>

      <DashboardSectionModal visible={open === "handoff"} onClose={close} accessibilityLabel="Handoff">
        <HandoffPanel colors={colors} onClose={close} />
      </DashboardSectionModal>

      <DashboardSectionModal visible={open === "carePlan"} onClose={close} accessibilityLabel="Care Plan">
        <CarePlanPanel
          colors={colors}
          onClose={close}
          onTreatLow={
            onTreatLow && canOpenLogs
              ? () => {
                  close();
                  // iOS can't present the next pop-up while this one is still sliding away.
                  setTimeout(onTreatLow, Platform.OS === "ios" ? 380 : 0);
                }
              : undefined
          }
        />
      </DashboardSectionModal>

      <DashboardSectionModal visible={open === "dayRecap"} onClose={close} accessibilityLabel="Day Recap">
        <DayRecapPanel colors={colors} />
      </DashboardSectionModal>
    </>
  );
}

// Same as the Dashboard pop-up cards.
const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16, gap: 14 },
  cardTitle: { fontSize: 17, fontWeight: "700" },
});
