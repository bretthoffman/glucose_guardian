/**
 * My Insulin — the pen / vial countdown on the Insulin page (under Suggested Dose). Code names still
 * say "pen" (data, ids, utils/pens); everything the family reads says the insulin and pen or vial.
 *
 *  - <PensCard />: every open pen or vial with a countdown ring (purple → amber in the last 3 days →
 *    red when due), e.g. "Humalog vial · School", a History link and "Start new insulin".
 *  - Start new insulin: insulin + pen/vial (only the ones in Insulin Settings), optional name, opened
 *    date, and "good for" days prefilled from the pen or vial label (utils/pens). Starting one with
 *    the same insulin, form and name as an open one replaces it, and asks why when it still had
 *    days left.
 *  - Edit: name, opened date, days; "I'm done with this pen/vial" (asks why); "Delete, added by
 *    mistake".
 *
 * Rules live in utils/pens; data in AuthContext (penLog / savePen / deletePen), shared with the
 * Care Circle. Caregiver sessions confirm before writing, like every other log path.
 */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import CalendarPicker from "@/components/CalendarPicker";
import { AccentShade, CardShade } from "@/components/Shade";
import { useAuth, type PenEntry } from "@/context/AuthContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import { useHelpAnchor } from "@/context/HelpContext";
import { formWord, type InsulinSupply } from "@/utils/insulinForms";
import {
  MAX_PEN_DAYS,
  MIN_PEN_DAYS,
  PEN_END_REASONS,
  activePens,
  addDays,
  defaultPenDays,
  endedPens,
  formatPenDate,
  insulinName,
  newPenId,
  parseLocalDate,
  penBeingReplaced,
  penEndReasonLabel,
  penStatus,
  penTitle,
  supplyName,
  toLocalDate,
  daysBetween,
  type PenEndReason,
  type PenTone,
} from "@/utils/pens";

type Palette = (typeof Colors)["light"];

const NAME_CHOICES = ["Home", "School", "Backpack"];

function toneColor(tone: PenTone): string {
  return tone === "ok" ? COLORS.primaryLight : tone === "soon" ? COLORS.warning : COLORS.danger;
}

function PenRing({ fraction, tone, label, size = 44, colors }: { fraction: number; tone: PenTone; label: string; size?: number; colors: Palette }) {
  const stroke = Math.max(4, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = toneColor(tone);
  const overdue = tone === "today" || tone === "over";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={overdue ? color : colors.border} strokeWidth={stroke} fill={overdue ? color + "22" : "none"} />
        {!overdue && fraction > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * fraction} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text style={{ fontSize: size * 0.32, fontWeight: "800", color: tone === "ok" ? colors.text : color }}>{label}</Text>
    </View>
  );
}

export default function PensCard({
  colors,
  canEdit,
  supplies,
}: {
  colors: Palette;
  /** False for view-only sessions: the countdown shows, the buttons don't. */
  canEdit: boolean;
  /** Insulins from Insulin Settings, each as a pen or vial (utils/insulinForms suppliesTaken). */
  supplies: InsulinSupply[];
}) {
  const { penLog, savePen, deletePen } = useAuth();
  const confirmLog = useCareLogConfirm();
  const helpPens = useHelpAnchor("insulin.pens");
  const today = toLocalDate(new Date());
  const open = useMemo(() => activePens(penLog, today), [penLog, today]);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState<PenEntry | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const save = (pen: Parameters<typeof savePen>[0]) => confirmLog(() => savePen(pen));

  return (
    <View ref={helpPens} collapsable={false} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={styles.headRow}>
        <Text style={[styles.headLabel, { color: colors.textSecondary }]}>MY INSULIN</Text>
        <Pressable onPress={() => setHistoryOpen(true)} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.link, { color: COLORS.primaryLight }]}>History</Text>
        </Pressable>
      </View>

      {open.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Nothing here yet. When you open a new pen or vial, start it here and we'll count down the days it's good for.
        </Text>
      ) : (
        open.map((pen, i) => {
          const st = penStatus(pen, today);
          const sub =
            st.tone === "ok"
              ? `${st.label} · opened ${formatPenDate(pen.openedOn)}`
              : st.tone === "soon"
                ? `${st.label} · change soon`
                : st.tone === "today"
                  ? "Change today"
                  : `${st.label} · time for a new ${formWord(pen.form)}`;
          return (
            <Pressable
              key={pen.id}
              onPress={canEdit ? () => setEditing(pen) : undefined}
              accessibilityRole={canEdit ? "button" : undefined}
              accessibilityLabel={`${penTitle(pen)}, ${st.label}`}
              style={({ pressed }) => [
                styles.row,
                i < open.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <PenRing
                fraction={st.fraction}
                tone={st.tone}
                label={st.tone === "today" || st.tone === "over" ? "!" : String(st.daysLeft)}
                colors={colors}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {insulinName(pen.insulinLabel)}{" "}
                  <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>{formWord(pen.form)}</Text>
                  {pen.name ? <Text style={{ color: colors.textSecondary, fontWeight: "500" }}> · {pen.name}</Text> : null}
                </Text>
                <Text
                  style={[styles.rowSub, { color: st.tone === "ok" ? colors.textSecondary : toneColor(st.tone), fontWeight: st.tone === "ok" ? "500" : "700" }]}
                  numberOfLines={1}
                >
                  {sub}
                </Text>
              </View>
              {canEdit && <Feather name="chevron-right" size={18} color={colors.textMuted} />}
            </Pressable>
          );
        })
      )}

      {canEdit && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setStarting(true);
          }}
          style={({ pressed }) => [styles.startBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <AccentShade radius={12} />
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.startText}>Start new insulin</Text>
        </Pressable>
      )}

      {starting && (
        <StartPenModal
          colors={colors}
          supplies={supplies}
          pens={penLog}
          today={today}
          onClose={() => setStarting(false)}
          onStart={(next, replace) => {
            // One confirmation for caregivers, covering both the end and the start.
            confirmLog(() => {
              if (replace) savePen(replace);
              savePen(next);
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setStarting(false);
          }}
        />
      )}
      {editing && (
        <EditPenModal
          key={editing.id}
          pen={editing}
          colors={colors}
          today={today}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            save(next);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setEditing(null);
          }}
          onDelete={() => {
            const id = editing.id;
            setEditing(null);
            confirmLog(() => deletePen(id));
          }}
        />
      )}
      {historyOpen && <PenHistoryModal colors={colors} pens={penLog} onClose={() => setHistoryOpen(false)} />}
    </View>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────────────────────

function Chip({ label, selected, onPress, colors, dashed }: { label: string; selected: boolean; onPress: () => void; colors: Palette; dashed?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? COLORS.primaryLight : colors.border,
          borderStyle: dashed ? "dashed" : "solid",
          backgroundColor: selected ? COLORS.primary + "33" : colors.backgroundTertiary,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: dashed && !selected ? colors.textSecondary : colors.text, fontWeight: selected ? "700" : "600" }]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryBtn, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}
    >
      {!disabled && <AccentShade radius={14} />}
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function TextButton({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.textBtn} hitSlop={6}>
      <Text style={[styles.textBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Name chips + "Other" (free text). */
function NamePicker({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: Palette }) {
  const isPreset = NAME_CHOICES.includes(value);
  const [otherOpen, setOtherOpen] = useState(!!value && !isPreset);
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Name (optional)</Text>
      <View style={styles.chipRow}>
        {NAME_CHOICES.map((n) => (
          <Chip
            key={n}
            label={n}
            selected={value === n}
            colors={colors}
            onPress={() => {
              setOtherOpen(false);
              onChange(value === n ? "" : n);
            }}
          />
        ))}
        <Chip label="+ Other" dashed selected={otherOpen} colors={colors} onPress={() => { setOtherOpen(true); if (isPreset) onChange(""); }} />
      </View>
      {otherOpen && (
        <TextInput
          value={isPreset ? "" : value}
          onChangeText={(t) => onChange(t.slice(0, 30))}
          placeholder="e.g. Grandma's house"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
          accessibilityLabel="Name"
          autoFocus
        />
      )}
    </View>
  );
}

/** Opened-on: Today / Yesterday / pick a date. */
function OpenedPicker({ value, onChange, today, colors }: { value: string; onChange: (v: string) => void; today: string; colors: Palette }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const yesterday = addDays(today, -1);
  const isOther = value !== today && value !== yesterday;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Opened on</Text>
      <View style={styles.chipRow}>
        <Chip label="Today" selected={value === today} colors={colors} onPress={() => onChange(today)} />
        <Chip label="Yesterday" selected={value === yesterday} colors={colors} onPress={() => onChange(yesterday)} />
        <Chip label={isOther ? formatPenDate(value) : "Pick a date"} selected={isOther} colors={colors} onPress={() => setCalendarOpen(true)} />
      </View>
      <CalendarPicker
        visible={calendarOpen}
        selected={parseLocalDate(value) ?? new Date()}
        maxDate={new Date()}
        onSelect={(d) => {
          onChange(toLocalDate(d));
          setCalendarOpen(false);
        }}
        onClose={() => setCalendarOpen(false)}
        colors={colors}
      />
    </View>
  );
}

function DaysInput({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: Palette }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Good for (days)</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, "").slice(0, 3))}
        keyboardType="number-pad"
        selectTextOnFocus
        style={[styles.input, styles.daysInput, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
        accessibilityLabel="Days it is good for"
      />
    </View>
  );
}

function parseDays(text: string): number | null {
  const n = parseInt(text, 10);
  return Number.isInteger(n) && n >= MIN_PEN_DAYS && n <= MAX_PEN_DAYS ? n : null;
}

/** "Why are you starting a new one?" / "Why are you done with it?" */
function ReasonStep({
  title,
  subtitle,
  overdue,
  goodForDays,
  confirmLabel,
  colors,
  onConfirm,
  onCancel,
}: {
  title: string;
  subtitle: string;
  overdue: boolean;
  goodForDays: number;
  confirmLabel: string;
  colors: Palette;
  onConfirm: (reason: PenEndReason) => void;
  onCancel: () => void;
}) {
  const options: { key: PenEndReason; label: string }[] = overdue
    ? [{ key: "reached_limit", label: penEndReasonLabel("reached_limit", goodForDays) }, ...PEN_END_REASONS]
    : PEN_END_REASONS;
  const [reason, setReason] = useState<PenEndReason | null>(overdue ? "reached_limit" : null);
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{subtitle}</Text>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = reason === o.key;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setReason(o.key)}
              style={[styles.reason, { borderColor: on ? COLORS.primaryLight : colors.border, backgroundColor: on ? COLORS.primary + "33" : colors.backgroundTertiary }]}
            >
              <Text style={[styles.reasonText, { color: colors.text, fontWeight: on ? "700" : "600" }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton label={confirmLabel} disabled={!reason} onPress={() => reason && onConfirm(reason)} />
      <TextButton label="Cancel" color={colors.textSecondary} onPress={onCancel} />
    </View>
  );
}

// ─── Start new pen ──────────────────────────────────────────────────────────────────────────

type SaveInput = Parameters<ReturnType<typeof useAuth>["savePen"]>[0];

function toSaveInput(p: PenEntry): SaveInput {
  return {
    id: p.id,
    insulinLabel: p.insulinLabel,
    ...(p.form ? { form: p.form } : {}),
    ...(p.name ? { name: p.name } : {}),
    openedOn: p.openedOn,
    goodForDays: p.goodForDays,
    ...(p.endedOn ? { endedOn: p.endedOn } : {}),
    ...(p.endReason ? { endReason: p.endReason } : {}),
  };
}

function StartPenModal({
  colors,
  supplies,
  pens,
  today,
  onClose,
  onStart,
}: {
  colors: Palette;
  supplies: InsulinSupply[];
  pens: PenEntry[];
  today: string;
  onClose: () => void;
  /** `replace`: the open pen being ended (with its reason) as this one starts. */
  onStart: (next: SaveInput, replace: SaveInput | null) => void;
}) {
  const first = supplies[0] ?? null;
  const [supply, setSupply] = useState<InsulinSupply | null>(first);
  const [name, setName] = useState("");
  const [openedOn, setOpenedOn] = useState(today);
  const [daysText, setDaysText] = useState(String(first ? defaultPenDays(first.label, first.form) : 28));
  const [daysTouched, setDaysTouched] = useState(false);
  const [askWhy, setAskWhy] = useState<PenEntry | null>(null);
  const days = parseDays(daysText);
  const word = formWord(supply?.form);

  const pickSupply = (s: InsulinSupply) => {
    setSupply(s);
    if (!daysTouched) setDaysText(String(defaultPenDays(s.label, s.form)));
  };

  const build = (): SaveInput | null =>
    supply && days
      ? {
          id: newPenId(),
          insulinLabel: supply.label,
          form: supply.form,
          ...(name.trim() ? { name: name.trim() } : {}),
          openedOn,
          goodForDays: days,
        }
      : null;

  const submit = () => {
    const next = build();
    if (!next) return;
    const old = penBeingReplaced(pens, next.insulinLabel, next.name, next.form);
    if (!old) return onStart(next, null);
    const st = penStatus(old, today);
    // An old pen that had run its days ends quietly; one with days left asks why.
    if (st.daysLeft <= 0) return onStart(next, { ...toSaveInput(old), endedOn: today, endReason: "reached_limit" });
    setAskWhy(old);
  };

  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel="Start new insulin">
      <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        {askWhy ? (
          <ReasonStep
            title={`This ${formWord(askWhy.form)} still has ${penStatus(askWhy, today).daysLeft} day${penStatus(askWhy, today).daysLeft === 1 ? "" : "s"} left`}
            subtitle={`${penTitle(askWhy)}, opened ${formatPenDate(askWhy.openedOn)}. Why are you starting a new one?`}
            overdue={false}
            goodForDays={askWhy.goodForDays}
            confirmLabel={`Start new ${word}`}
            colors={colors}
            onCancel={() => setAskWhy(null)}
            onConfirm={(reason) => {
              const next = build();
              if (next) onStart(next, { ...toSaveInput(askWhy), endedOn: today, endReason: reason });
            }}
          />
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={[styles.title, { color: colors.text }]}>Start new insulin</Text>
            {supplies.length === 0 ? (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Add your insulins first: Dashboard → Insulin Settings. Then they'll show up here.
              </Text>
            ) : (
              <>
                <View style={{ gap: 8 }}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Insulin</Text>
                  <View style={styles.chipRow}>
                    {supplies.map((s) => (
                      <Chip
                        key={`${s.label}|${s.form}`}
                        label={supplyName({ insulinLabel: s.label, form: s.form })}
                        selected={supply?.label === s.label && supply?.form === s.form}
                        colors={colors}
                        onPress={() => pickSupply(s)}
                      />
                    ))}
                  </View>
                </View>
                <NamePicker value={name} onChange={setName} colors={colors} />
                <OpenedPicker value={openedOn} onChange={setOpenedOn} today={today} colors={colors} />
                <DaysInput value={daysText} onChange={(t) => { setDaysTouched(true); setDaysText(t); }} colors={colors} />
                {supply && (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    {defaultPenDays(supply.label, supply.form)} days is what the {insulinName(supply.label)} label says once a {word} is opened. Change it if your doctor told you something different.
                  </Text>
                )}
                <PrimaryButton label={`Start ${word}`} disabled={!supply || !days} onPress={submit} />
              </>
            )}
            <TextButton label="Cancel" color={colors.textSecondary} onPress={onClose} />
          </View>
        )}
      </View>
    </DashboardSectionModal>
  );
}

// ─── Edit pen ───────────────────────────────────────────────────────────────────────────────

function EditPenModal({
  pen,
  colors,
  today,
  onClose,
  onSave,
  onDelete,
}: {
  pen: PenEntry;
  colors: Palette;
  today: string;
  onClose: () => void;
  onSave: (next: SaveInput) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(pen.name ?? "");
  const [openedOn, setOpenedOn] = useState(pen.openedOn);
  const [daysText, setDaysText] = useState(String(pen.goodForDays));
  const [ending, setEnding] = useState(false);
  const days = parseDays(daysText);
  const live = penStatus({ openedOn, goodForDays: days ?? pen.goodForDays }, today);
  const base = { ...toSaveInput(pen), ...(name.trim() ? { name: name.trim() } : { name: undefined }), openedOn, goodForDays: days ?? pen.goodForDays };

  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel={`Edit ${formWord(pen.form)}`}>
      <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        {ending ? (
          <ReasonStep
            title={`Done with this ${formWord(pen.form)}?`}
            subtitle={`${penTitle(pen)}, opened ${formatPenDate(pen.openedOn)}. Why are you done with it?`}
            overdue={live.daysLeft <= 0}
            goodForDays={pen.goodForDays}
            confirmLabel={`End this ${formWord(pen.form)}`}
            colors={colors}
            onCancel={() => setEnding(false)}
            onConfirm={(reason) => onSave({ ...base, endedOn: today, endReason: reason })}
          />
        ) : (
          <View style={{ gap: 14 }}>
            <View style={styles.editHead}>
              <PenRing
                fraction={live.fraction}
                tone={live.tone}
                label={live.tone === "today" || live.tone === "over" ? "!" : String(live.daysLeft)}
                size={52}
                colors={colors}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: colors.text }]}>Edit {formWord(pen.form)}</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={1}>
                  {supplyName(pen)} · {live.label}
                </Text>
              </View>
            </View>
            <NamePicker value={name} onChange={setName} colors={colors} />
            <OpenedPicker value={openedOn} onChange={setOpenedOn} today={today} colors={colors} />
            <DaysInput value={daysText} onChange={setDaysText} colors={colors} />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Change it by <Text style={{ color: colors.text, fontWeight: "700" }}>{formatPenDate(live.changeBy)}</Text>. Reminders move with the date.
            </Text>
            <PrimaryButton label="Save" disabled={!days} onPress={() => onSave(base)} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Pressable
              accessibilityRole="button"
              onPress={() => setEnding(true)}
              style={({ pressed }) => [styles.outlineBtn, { borderColor: COLORS.primaryLight + "99", opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.outlineText, { color: COLORS.primaryLight }]}>I'm done with this {formWord(pen.form)}</Text>
            </Pressable>
            <TextButton
              label="Delete, added by mistake"
              color={COLORS.danger}
              onPress={() =>
                Alert.alert(`Delete this ${formWord(pen.form)}?`, "Use this only if it was added by mistake. It won't show in History.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: onDelete },
                ])
              }
            />
          </View>
        )}
      </View>
    </DashboardSectionModal>
  );
}

// ─── History ────────────────────────────────────────────────────────────────────────────────

function PenHistoryModal({ colors, pens, onClose }: { colors: Palette; pens: PenEntry[]; onClose: () => void }) {
  const today = toLocalDate(new Date());
  const rows = [...activePens(pens, today), ...endedPens(pens)];
  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel="Insulin history">
      <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.title, { color: colors.text }]}>Insulin history</Text>
        <Text style={[styles.body, { color: colors.textSecondary, marginBottom: 6 }]}>Every pen and vial, newest first.</Text>
        {rows.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Nothing yet.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 460 }}>
            {rows.map((p, i) => {
              const ended = !!p.endedOn;
              const used = ended ? daysBetween(p.openedOn, p.endedOn!) : null;
              return (
                <View
                  key={p.id}
                  style={[styles.histRow, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                      {insulinName(p.insulinLabel)}{" "}
                      <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>{formWord(p.form)}</Text>
                      {p.name ? <Text style={{ color: colors.textSecondary, fontWeight: "500" }}> · {p.name}</Text> : null}
                    </Text>
                    <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
                      {ended
                        ? `${formatPenDate(p.openedOn)} to ${formatPenDate(p.endedOn!)} · ${used} day${used === 1 ? "" : "s"}`
                        : `${formatPenDate(p.openedOn)} to now`}
                    </Text>
                  </View>
                  {ended ? (
                    <Text style={[styles.histReason, { color: p.endReason === "lost" || p.endReason === "damaged" || p.endReason === "temperature" ? COLORS.warning : colors.textSecondary }]}>
                      {penEndReasonLabel(p.endReason, p.goodForDays)}
                    </Text>
                  ) : (
                    <View style={styles.inUse}>
                      <AccentShade radius={99} />
                      <Text style={styles.inUseText}>IN USE</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, marginBottom: 16, gap: 2 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  headLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8 },
  link: { fontSize: 14, fontWeight: "600" },
  empty: { fontSize: 13.5, lineHeight: 19, paddingVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, minHeight: 56 },
  rowTitle: { fontSize: 15, fontWeight: "700" },
  rowSub: { fontSize: 12.5, marginTop: 1 },
  startBtn: {
    marginTop: 10, height: 46, borderRadius: 12, backgroundColor: COLORS.primary, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden",
  },
  startText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  modalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  title: { fontSize: 20, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12.5, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  daysInput: { width: 110, fontSize: 17, fontWeight: "700" },
  primaryBtn: { height: 50, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginTop: 2 },
  primaryText: { color: "#fff", fontSize: 16.5, fontWeight: "700" },
  textBtn: { alignItems: "center", paddingVertical: 10 },
  textBtnText: { fontSize: 15, fontWeight: "600" },
  outlineBtn: { height: 46, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  outlineText: { fontSize: 15.5, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  editHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  reason: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  reasonText: { fontSize: 15 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  histReason: { fontSize: 13, fontWeight: "600", maxWidth: 140, textAlign: "right" },
  inUse: { backgroundColor: COLORS.primary, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  inUseText: { color: "#fff", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
});
