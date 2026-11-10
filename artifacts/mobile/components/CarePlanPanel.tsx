/**
 * The Care Plan pop-up.
 * - Family (owner or co-guardian): write it. If low, If high, Glucagon and supplies, Notes, and how
 *   long to wait before rechecking a treated low. Who to call comes from Emergency Contacts.
 * - Caregiver (the school nurse, grandma): read it, easy to scan in a hurry, with Call buttons, and on
 *   their child's screens a "Treated it" button that starts the recheck timer.
 * Saved online (convex/carePlan), so a change shows for everyone right away.
 */
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { AccentShade, CardShade } from "@/components/Shade";
import { useCarePlanArgs } from "@/hooks/useCareCode";
import { api } from "@/utils/convex-auth-client";
import { DEFAULT_RECHECK_MINUTES, planSteps } from "../../../convex/carePlanLogic";

type Palette = (typeof Colors)["light"];
type Section = "low" | "high" | "supplies" | "notes";

const SECTIONS: { key: Section; title: string; icon: React.ComponentProps<typeof Feather>["name"]; color: string; placeholder: string; numbered: boolean }[] = [
  { key: "low", title: "IF LOW", icon: "arrow-down", color: "#FF6B66", placeholder: "What to give, how much, and when to recheck. One step per line.", numbered: true },
  { key: "high", title: "IF HIGH", icon: "arrow-up", color: "#FF9F1C", placeholder: "Water, bathroom, when to call home.", numbered: true },
  { key: "supplies", title: "GLUCAGON AND SUPPLIES", icon: "map-pin", color: "#5CB8FF", placeholder: "Where the glucagon, snacks and meter are kept.", numbered: false },
  { key: "notes", title: "NOTES", icon: "file-text", color: "#A99BFF", placeholder: "Sports days, lunch tips, anything else.", numbered: false },
];
const RECHECK_CHOICES = [10, 15, 20];

function fmtUpdated(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CarePlanPanel({
  colors,
  code,
  onTreatLow,
}: {
  colors: Palette;
  /** A child from the nurse's Caregiver Menu (their code); otherwise whoever is signed in. */
  code?: string;
  /** Shown on a caregiver's view inside the child's screens: log the treatment and start the timer. */
  onTreatLow?: () => void;
  onClose?: () => void;
}) {
  const sessionArgs = useCarePlanArgs();
  const args = code ? { code } : sessionArgs;
  const data = useQuery(api.carePlan.get, args ?? "skip");
  if (!args) return null;
  if (data === undefined) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 30 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Care Plan</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          The Care Plan isn't available right now. It opens during the hours your code works.
        </Text>
      </View>
    );
  }
  return data.canEdit ? <Editor colors={colors} data={data} args={args} /> : <Viewer colors={colors} data={data} onTreatLow={onTreatLow} />;
}

type PlanData = NonNullable<FunctionReturnType<typeof api.carePlan.get>>;

function Editor({ colors, data, args }: { colors: Palette; data: PlanData; args: { code?: string } }) {
  const save = useMutation(api.carePlan.save);
  const [fields, setFields] = useState({ low: "", high: "", supplies: "", notes: "" });
  const [recheck, setRecheck] = useState(DEFAULT_RECHECK_MINUTES);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const seededAt = useRef<number | null>(null);

  // Load what's saved (and again if someone else saves while this is closed and reopened).
  useEffect(() => {
    const stamp = data.plan?.updatedAt ?? 0;
    if (seededAt.current === stamp) return;
    seededAt.current = stamp;
    setFields({ low: data.plan?.low ?? "", high: data.plan?.high ?? "", supplies: data.plan?.supplies ?? "", notes: data.plan?.notes ?? "" });
    setRecheck(data.recheckMinutes);
  }, [data.plan?.updatedAt, data.plan, data.recheckMinutes]);

  const onSave = async () => {
    setState("saving");
    try {
      await save({ ...args, ...fields, recheckMinutes: recheck });
      seededAt.current = null;
      setState("saved");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setState("error");
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={{ gap: 3 }}>
        <Text style={[styles.title, { color: colors.text }]}>{data.childName}'s Care Plan</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {data.plan ? `Updated ${fmtUpdated(data.plan.updatedAt)} by ${data.plan.updatedByName}. ` : ""}
          Shared with your co-guardian, the school nurse and everyone with a caregiver code.
        </Text>
      </View>

      {SECTIONS.map((s) => (
        <View key={s.key} style={{ gap: 6 }}>
          <SectionLabel colors={colors} title={s.title} icon={s.icon} color={s.color} />
          <TextInput
            value={fields[s.key]}
            onChangeText={(t) => {
              setFields((f) => ({ ...f, [s.key]: t }));
              setState("idle");
            }}
            placeholder={s.placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
            accessibilityLabel={s.title.toLowerCase()}
          />
          {s.key === "low" && (
            <View style={styles.recheckRow}>
              <Text style={[styles.recheckLabel, { color: colors.textSecondary }]}>Recheck timer</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {RECHECK_CHOICES.map((m) => {
                  const on = recheck === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => {
                        setRecheck(m);
                        setState("idle");
                      }}
                      style={[styles.chip, { backgroundColor: on ? COLORS.primary : colors.backgroundTertiary, borderColor: on ? COLORS.primary : colors.border }]}
                    >
                      <Text style={[styles.chipText, { color: on ? "#fff" : colors.text }]}>{m} min</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      ))}

      <View style={{ gap: 6 }}>
        <SectionLabel colors={colors} title="WHO TO CALL" icon="phone" color="#1FD18A" />
        <View style={[styles.contactsBox, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
          {data.contacts.length === 0 ? (
            <Text style={[styles.sub, { color: colors.textSecondary }]}>No emergency contacts yet. Add them under Emergency Contacts.</Text>
          ) : (
            data.contacts.map((c, i) => (
              <View key={`${c.name}${i}`} style={styles.contactRow}>
                <Text style={[styles.contactName, { color: colors.text }]}>{c.name}</Text>
                <Text style={[styles.sub, { color: colors.textSecondary }]}>{c.relation}</Text>
              </View>
            ))
          )}
          <Text style={[styles.hint, { color: colors.textMuted }]}>From Emergency Contacts. Change them there.</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={state === "saving"}
        onPress={onSave}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed || state === "saving" ? 0.8 : 1 }]}
      >
        <AccentShade radius={14} />
        {state === "saved" && <Feather name="check" size={17} color="#fff" />}
        <Text style={styles.primaryBtnText}>{state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Save Care Plan"}</Text>
      </Pressable>
      {state === "error" && (
        <Text style={[styles.hint, { color: COLORS.danger, textAlign: "center" }]}>Couldn't save. Check your connection and try again.</Text>
      )}
      <Text style={[styles.hint, { color: colors.textMuted, textAlign: "center" }]}>
        Write it from your child's care plan and your doctor's orders. Caregivers see exactly what you write.
      </Text>
    </View>
  );
}

function Viewer({ colors, data, onTreatLow }: { colors: Palette; data: PlanData; onTreatLow?: () => void }) {
  const plan = data.plan;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={{ gap: 3 }}>
        <Text style={[styles.title, { color: colors.text }]}>{data.childName}'s Care Plan</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {plan ? `From ${data.childName}'s family · Updated ${fmtUpdated(plan.updatedAt)} by ${plan.updatedByName}` : `${data.childName}'s family hasn't written a Care Plan yet.`}
        </Text>
      </View>

      {plan &&
        SECTIONS.map((s) => {
          const text = plan[s.key];
          if (!text.trim()) return null;
          const steps = planSteps(text);
          const isLow = s.key === "low";
          return (
            <View
              key={s.key}
              style={[
                styles.viewBox,
                { borderColor: s.color + (isLow || s.key === "high" ? "77" : "33"), backgroundColor: isLow || s.key === "high" ? s.color + "1A" : colors.backgroundTertiary },
              ]}
            >
              <SectionLabel colors={colors} title={s.title} icon={s.icon} color={s.color} />
              {s.numbered && steps.length > 1 ? (
                steps.map((step, i) => (
                  <View key={i} style={styles.stepRow}>
                    <View style={[styles.stepNum, { backgroundColor: s.color }]}>
                      <Text style={styles.stepNumText}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.stepText, { color: colors.text }]}>{text.trim()}</Text>
              )}
              {isLow && onTreatLow && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onTreatLow();
                  }}
                  style={({ pressed }) => [styles.treatBtn, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <MaterialCommunityIcons name="timer-outline" size={17} color="#fff" />
                  <Text style={styles.treatBtnText}>Treated it: start recheck timer</Text>
                </Pressable>
              )}
            </View>
          );
        })}

      {data.contacts.length > 0 && (
        <View style={[styles.viewBox, { borderColor: "#1FD18A33", backgroundColor: colors.backgroundTertiary }]}>
          <SectionLabel colors={colors} title="WHO TO CALL" icon="phone" color="#1FD18A" />
          {data.contacts.map((c, i) => (
            <View key={`${c.name}${i}`} style={styles.callRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.contactName, { color: colors.text }]}>{c.name}</Text>
                {!!c.relation && <Text style={[styles.sub, { color: colors.textSecondary }]}>{c.relation}</Text>}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${c.name}`}
                onPress={() => void Linking.openURL(`tel:${c.phone.replace(/[^0-9+]/g, "")}`)}
                style={({ pressed }) => [styles.callBtn, { backgroundColor: i === 0 ? "#1FD18A" : "#1FD18A29", opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={[styles.callBtnText, { color: i === 0 ? "#06281B" : "#7DE3B9" }]}>Call</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.hint, { color: colors.textMuted, textAlign: "center" }]}>
        Written by {data.childName}'s family. Always follow your school's care plan and the doctor's orders.
      </Text>
    </View>
  );
}

function SectionLabel({ colors, title, icon, color }: { colors: Palette; title: string; icon: React.ComponentProps<typeof Feather>["name"]; color: string }) {
  return (
    <View style={styles.labelRow}>
      <View style={[styles.labelIcon, { backgroundColor: color + "2E" }]}>
        <Feather name={icon} size={13} color={color} />
      </View>
      <Text style={[styles.label, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  title: { fontSize: 19, fontWeight: "800" },
  sub: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 17 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  labelIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12.5, fontWeight: "800", letterSpacing: 0.6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 15, lineHeight: 21, minHeight: 64, textAlignVertical: "top" },
  recheckRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  recheckLabel: { fontSize: 13, fontWeight: "600" },
  chip: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  contactsBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  contactName: { fontSize: 15.5, fontWeight: "700" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, overflow: "hidden" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  viewBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  stepText: { flex: 1, fontSize: 15.5, lineHeight: 22 },
  treatBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, backgroundColor: COLORS.danger, marginTop: 2 },
  treatBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  callRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  callBtn: { height: 42, paddingHorizontal: 20, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  callBtnText: { fontSize: 14.5, fontWeight: "800" },
});
