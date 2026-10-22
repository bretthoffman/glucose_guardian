/**
 * Dashboard → Doctor Office. The doctor's card (call / email / text), the Visit Summary PDF (a range
 * picker, a preview of the numbers, and a share step), and quick notes that fill in the matching
 * numbers. The math and text live in utils/visitSummary, utils/visitSummaryHtml and utils/doctorNotes.
 *
 * Sending: a plain note goes out through mailto:/sms: links with the doctor's address filled in. A
 * PDF can't ride on those links, so anything with the PDF goes through the share sheet (Mail,
 * Messages, AirDrop, Files) with the message as its text. Read-only: nothing here writes logs or
 * touches dose settings.
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { BrandShade, ControlShade } from "@/components/Shade";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { buildNote, NOTE_KINDS, noteBody, visitSummaryMessage, type NoteKind } from "@/utils/doctorNotes";
import { fetchGlucoseRange, identityKey, mergeReadings, type GlucoseIdentity } from "@/utils/glucoseRangeFetch";
import { buildVisitSummary, DAY_MS, glucoseStats, inWindow, lowEpisodes, type SummaryReading } from "@/utils/visitSummary";
import { buildVisitSummaryHtml, EVERY_MEAL_MAX_DAYS, visitSummaryFileName } from "@/utils/visitSummaryHtml";

type Palette = typeof Colors.dark;
const RANGES = [7, 14, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
/** Photos are embedded small; this many keeps the PDF a reasonable size to email. */
const MAX_PHOTOS = 60;

function initials(name: string): string {
  const words = name.replace(/^dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "DR").slice(0, 2);
}

export default function DoctorOfficePanel({ colors }: { colors: Palette }) {
  const auth = useAuth();
  const { profile, updateProfile, foodLog, insulinLog, fingerStickLog, ageYears, isChildMode, caregiverSession } = auth;
  const { history, carbRatio, correctionFactor, targetGlucose } = useGlucose();
  const canEdit = !isChildMode && !caregiverSession;

  const doctorName = profile?.doctorName?.trim() ?? "";
  const doctorEmail = profile?.doctorEmail?.trim() ?? "";
  const doctorPhone = profile?.doctorPhone?.trim() ?? "";
  const patientName = profile?.childName?.trim() || "Patient";

  // ── Which view: the main card, the doctor-info form, or one quick note. ──
  const [view, setView] = useState<"home" | "edit" | NoteKind>("home");

  // ── Readings for the report. Fetched once per identity, extended backward when a longer range
  // is picked; the last day is topped up from live history so "today" is current. ──
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
  const idKey = identityKey(identity);
  const [range, setRange] = useState<RangeDays>(14);
  const [fetched, setFetched] = useState<{ key: string; fromMs: number; readings: SummaryReading[] } | null>(null);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const inflight = useRef<Promise<SummaryReading[] | null> | null>(null);
  const endMs = useMemo(() => {
    // Through the end of today, so the window is whole local days ending today.
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }, []);

  const ensureReadings = useCallback(
    async (days: number): Promise<SummaryReading[] | null> => {
      const needFrom = endMs - days * DAY_MS;
      const have = fetched && fetched.key === idKey ? fetched : null;
      if (have && have.fromMs <= needFrom) return have.readings;
      if (inflight.current) await inflight.current;
      const fromMs = needFrom;
      const toMs = have ? have.fromMs : endMs;
      const run = (async () => {
        setLoadError(false);
        setLoading({ done: 0, total: 1 });
        try {
          const rows = await fetchGlucoseRange(identity, fromMs, toMs, (done, total) => setLoading({ done, total }));
          const merged = mergeReadings(rows, have?.readings ?? []);
          setFetched({ key: idKey, fromMs, readings: merged });
          return merged;
        } catch {
          setLoadError(true);
          return null;
        } finally {
          setLoading(null);
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    // identity fields are folded into idKey; the fetch itself reads the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endMs, fetched, idKey],
  );

  useEffect(() => {
    void ensureReadings(range);
  }, [range, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Server readings plus this device's live history (fresher for the last few minutes). */
  const readings = useMemo(() => {
    const server = fetched && fetched.key === idKey ? fetched.readings : [];
    return mergeReadings(server, history.map((h) => ({ glucose: h.glucose, timestamp: h.timestamp })));
  }, [fetched, idKey, history]);

  const startMs = endMs - range * DAY_MS;
  const rangeReady = !!fetched && fetched.key === idKey && fetched.fromMs <= startMs;
  const peek = useMemo(() => {
    const inRange = readings.filter((r) => inWindow(r.timestamp, startMs, endMs));
    const s = glucoseStats(inRange);
    return { tir: s ? Math.round(s.pct.inRange) : null, gmi: s?.gmi ?? null, lows: s ? lowEpisodes(inRange).length : null };
  }, [readings, startMs, endMs]);

  // ── Visit Summary ──
  const [includePhotos, setIncludePhotos] = useState(false);
  const [everyMeal, setEveryMeal] = useState(false);
  const [building, setBuilding] = useState(false);

  async function photoSources(meals: { timestamp: string; photoUri?: string }[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const m of meals.filter((x) => x.photoUri).slice(0, MAX_PHOTOS)) {
      const uri = m.photoUri!;
      try {
        if (/^https?:\/\//i.test(uri)) {
          out[m.timestamp] = uri;
        } else {
          const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 120 } }], {
            compress: 0.6,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          });
          if (small.base64) out[m.timestamp] = `data:image/jpeg;base64,${small.base64}`;
        }
      } catch {
        /* a photo that can't be read is just left out */
      }
    }
    return out;
  }

  /** Build the PDF for `days` and return its file path plus the matching message. */
  async function buildPdf(days: number, opts: { photos: boolean; everyMeal: boolean }) {
    const rows = await ensureReadings(days);
    if (!rows) throw new Error("readings");
    const all = mergeReadings(rows, history.map((h) => ({ glucose: h.glucose, timestamp: h.timestamp })));
    const data = buildVisitSummary({
      days,
      endMs,
      readings: all,
      food: foodLog,
      insulin: insulinLog,
      sticks: fingerStickLog ?? [],
      accessLog: profile?.accessLog ?? [],
    });
    const meta = {
      patientName,
      ageYears,
      diabetesType: profile?.diabetesType,
      doctorName: doctorName || undefined,
      doctorInstitution: profile?.doctorInstitution?.trim() || undefined,
      carbRatio,
      correctionFactor,
      targetGlucose,
      generatedAt: Date.now(),
    };
    const listsEveryMeal = days <= EVERY_MEAL_MAX_DAYS || opts.everyMeal;
    const photos = opts.photos && listsEveryMeal ? await photoSources(data.meals) : undefined;
    const html = buildVisitSummaryHtml(data, meta, { includeEveryMeal: opts.everyMeal, photos });
    // Letter size. iOS takes margins here; Android uses the @page margin in the HTML.
    const { uri } = await Print.printToFileAsync({
      html,
      width: 612,
      height: 792,
      ...(Platform.OS === "ios" ? { margins: { left: 32, right: 32, top: 32, bottom: 32 } } : {}),
    });
    const dest = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "") + visitSummaryFileName(meta);
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({ from: uri, to: dest });
    return { file: dest, data, ...visitSummaryMessage(data, patientName, doctorName || undefined) };
  }

  /** Share a PDF with a message (Mail puts the message in the body and attaches the PDF). */
  async function sharePdf(file: string, subject: string, message: string) {
    if (Platform.OS === "ios") {
      await Share.share({ url: file, message }, { subject });
    } else if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: "application/pdf", dialogTitle: subject, UTI: "com.adobe.pdf" });
    } else {
      Alert.alert("PDF ready", "Sharing isn't available on this device.");
    }
  }

  async function sendVisitSummary() {
    if (building) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuilding(true);
    try {
      const pdf = await buildPdf(range, { photos: includePhotos, everyMeal });
      await sharePdf(pdf.file, pdf.subject, pdf.message);
    } catch {
      Alert.alert("Couldn't build the summary", "Check your internet connection and try again.");
    } finally {
      setBuilding(false);
    }
  }

  // ── Doctor info form ──
  const [form, setForm] = useState({ name: "", institution: "", phone: "", email: "" });
  const openEdit = () => {
    setForm({ name: doctorName, institution: profile?.doctorInstitution ?? "", phone: doctorPhone, email: doctorEmail });
    setView("edit");
  };
  async function saveForm() {
    await updateProfile({
      doctorName: form.name.trim(),
      doctorInstitution: form.institution.trim(),
      doctorPhone: form.phone.trim(),
      doctorEmail: form.email.trim(),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setView("home");
  }

  const openUrl = (url: string, what: string) =>
    Linking.openURL(url).catch(() => Alert.alert(`Couldn't open ${what}`, `Make sure ${what} is set up on this phone.`));
  const smsUrl = (body?: string) => {
    const sep = Platform.OS === "ios" ? "&" : "?";
    return `sms:${doctorPhone.replace(/[^\d+]/g, "")}${body ? `${sep}body=${encodeURIComponent(body)}` : ""}`;
  };
  const mailUrl = (subject: string, body?: string) =>
    `mailto:${encodeURIComponent(doctorEmail).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;

  if (view === "edit") {
    const field = (label: string, key: keyof typeof form, placeholder: string, extra?: object) => (
      <View style={{ gap: 6 }}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text }]}
          value={form[key]}
          onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          {...extra}
        />
      </View>
    );
    return (
      <View style={{ gap: 12 }}>
        <BackRow colors={colors} title="Doctor info" onBack={() => setView("home")} />
        {field("Doctor or practice name", "name", "Dr. Smith")}
        {field("Hospital or office", "institution", "MUSC Children's Hospital")}
        {field("Office phone", "phone", "(843) 555-0100", { keyboardType: "phone-pad" })}
        {field("Email", "email", "doctor@clinic.com", { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false })}
        <Pressable onPress={saveForm} style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button">
          <BrandShade radius={14} />
          <Feather name="check" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Save</Text>
        </Pressable>
      </View>
    );
  }

  if (view !== "home") {
    return (
      <QuickNote
        kind={view}
        colors={colors}
        onBack={() => setView("home")}
        context={{
          patientName,
          doctorName: doctorName || undefined,
          now: Date.now(),
          readings,
          food: foodLog,
          insulin: insulinLog,
          carbRatio,
          correctionFactor,
          targetGlucose,
          insulinTypes: profile?.insulinTypes,
        }}
        readingsLoading={!!loading}
        hasEmail={!!doctorEmail}
        hasPhone={!!doctorPhone}
        doctorLabel={doctorName || "your doctor"}
        onEmail={(subject, body) => openUrl(mailUrl(subject, body), "email")}
        onText={(body) => openUrl(smsUrl(body), "Messages")}
        onShareWithPdf={async (subject, body) => {
          const pdf = await buildPdf(7, { photos: false, everyMeal: false });
          await sharePdf(pdf.file, subject, body);
        }}
      />
    );
  }

  const action = (icon: React.ComponentProps<typeof Feather>["name"], label: string, enabled: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      disabled={!enabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${doctorName || "doctor"}`}
      style={({ pressed }) => [styles.action, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: !enabled ? 0.4 : pressed ? 0.75 : 1 }]}
    >
      <ControlShade radius={12} />
      <Feather name={icon} size={17} color={enabled ? COLORS.primary : colors.textMuted} />
      <Text style={[styles.actionText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 10 }}>
      {/* Doctor card */}
      {doctorName || doctorEmail || doctorPhone ? (
        <Pressable
          disabled={!canEdit}
          onPress={openEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit doctor info"
          style={[styles.doctorCard, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
        >
          <View style={styles.avatar}>
            <BrandShade radius={23} />
            <Text style={styles.avatarText}>{initials(doctorName)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.doctorName, { color: colors.text }]} numberOfLines={1}>{doctorName || "Your doctor"}</Text>
            {!!profile?.doctorInstitution && (
              <Text style={[styles.doctorSub, { color: colors.textSecondary }]} numberOfLines={1}>{profile.doctorInstitution}</Text>
            )}
            {!!doctorEmail && (
              <Text style={[styles.doctorSub, { color: colors.textMuted }]} numberOfLines={1}>{doctorEmail}</Text>
            )}
          </View>
          {canEdit && <Feather name="edit-2" size={15} color={colors.textMuted} />}
        </Pressable>
      ) : canEdit ? (
        <Pressable
          onPress={openEdit}
          accessibilityRole="button"
          style={({ pressed }) => [styles.doctorCard, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, borderStyle: "dashed", opacity: pressed ? 0.8 : 1 }]}
        >
          <Feather name="user-plus" size={18} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.doctorName, { color: colors.text }]}>Add your doctor</Text>
            <Text style={[styles.doctorSub, { color: colors.textSecondary }]}>Name, office phone, and email, so sending takes one tap.</Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {action("phone", "Call", !!doctorPhone, () => openUrl(`tel:${doctorPhone}`, "the phone"))}
        {action("mail", "Email", !!doctorEmail, () => openUrl(mailUrl(patientName), "email"))}
        {action("message-circle", "Text", !!doctorPhone, () => openUrl(smsUrl(), "Messages"))}
      </View>

      {/* Visit Summary */}
      <Text style={[styles.section, { color: colors.textMuted }]}>VISIT SUMMARY</Text>
      <Pressable
        onPress={sendVisitSummary}
        disabled={building}
        accessibilityRole="button"
        style={({ pressed }) => [styles.bigBtn, { opacity: pressed || building ? 0.85 : 1 }]}
      >
        <BrandShade radius={16} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {building ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="file-text" size={18} color="#fff" />}
          <Text style={styles.bigBtnTitle}>{building ? "Building your summary…" : "Send Visit Summary"}</Text>
        </View>
        <Text style={styles.bigBtnSub}>
          PDF of the last {range} days{doctorName ? ` for ${doctorName}` : ""}, with every {range > EVERY_MEAL_MAX_DAYS && !everyMeal ? "food" : "meal"} and the glucose around it
        </Text>
      </Pressable>
      <View style={styles.seg}>
        {RANGES.map((d) => {
          const on = d === range;
          return (
            <Pressable
              key={d}
              onPress={() => {
                Haptics.selectionAsync();
                setRange(d);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segBtn, { borderColor: on ? COLORS.primary : colors.border, backgroundColor: on ? COLORS.primary + "26" : colors.backgroundTertiary }]}
            >
              <Text style={[styles.segText, { color: on ? colors.text : colors.textSecondary }]}>{d} days</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.peek}>
        {loading && !rangeReady ? (
          <View style={[styles.peekBox, { flex: 1, borderColor: colors.border, backgroundColor: colors.backgroundTertiary, flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={[styles.peekLabel, { color: colors.textSecondary, fontSize: 13 }]}>
              Loading {range} days of readings{loading.total > 1 ? ` (${loading.done} of ${loading.total})` : ""}…
            </Text>
          </View>
        ) : loadError && !rangeReady ? (
          <Pressable
            onPress={() => void ensureReadings(range)}
            style={[styles.peekBox, { flex: 1, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
          >
            <Text style={[styles.peekLabel, { color: colors.textSecondary, fontSize: 13 }]}>Couldn't load readings. Tap to try again.</Text>
          </Pressable>
        ) : (
          <>
            <PeekBox colors={colors} value={peek.tir != null ? `${peek.tir}%` : "·"} label="In range" color={peek.tir != null && peek.tir >= 70 ? COLORS.success : undefined} />
            <PeekBox colors={colors} value={peek.gmi != null ? `${peek.gmi}%` : "·"} label="Est. A1C" />
            <PeekBox colors={colors} value={peek.lows != null ? String(peek.lows) : "·"} label={peek.lows === 1 ? "Low" : "Lows"} color={peek.lows ? COLORS.danger : undefined} />
          </>
        )}
      </View>
      {range <= EVERY_MEAL_MAX_DAYS || everyMeal ? (
        <ToggleRow colors={colors} label="Include meal photos" hint="Small pictures next to each meal. Makes the file bigger." value={includePhotos} onChange={setIncludePhotos} />
      ) : null}
      {range > EVERY_MEAL_MAX_DAYS && (
        <ToggleRow colors={colors} label="Include every meal" hint="90 days lists the foods eaten most often. Turn on to list every meal too." value={everyMeal} onChange={setEveryMeal} />
      )}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Opens your share menu with the PDF attached. Pick Mail{doctorEmail ? ` and send it to ${doctorEmail}` : ""}, or Messages, AirDrop, or Files.
      </Text>

      {/* Quick notes */}
      <Text style={[styles.section, { color: colors.textMuted }]}>SEND A QUICK NOTE</Text>
      {NOTE_KINDS.map((k) => (
        <Pressable
          key={k.kind}
          onPress={() => {
            Haptics.selectionAsync();
            setView(k.kind);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.noteRow, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
        >
          <View style={[styles.noteIcon, { backgroundColor: k.tint + "26" }]}>
            <Feather name={k.icon as React.ComponentProps<typeof Feather>["name"]} size={15} color={k.tint} />
          </View>
          <Text style={[styles.noteText, { color: colors.text }]}>{k.title}</Text>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

function BackRow({ colors, title, onBack }: { colors: Palette; title: string; onBack: () => void }) {
  return (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Doctor Office" style={styles.backRow} hitSlop={8}>
      <Feather name="chevron-left" size={20} color={COLORS.primary} />
      <Text style={[styles.backText, { color: COLORS.primary }]}>Doctor Office</Text>
      <Text style={[styles.backTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

function PeekBox({ colors, value, label, color }: { colors: Palette; value: string; label: string; color?: string }) {
  return (
    <View style={[styles.peekBox, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.peekValue, { color: color ?? colors.text }]}>{value}</Text>
      <Text style={[styles.peekLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function ToggleRow({ colors, label, hint, value, onChange }: { colors: Palette; label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.toggleHint, { color: colors.textMuted }]}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: COLORS.success }} accessibilityLabel={label} />
    </View>
  );
}

function QuickNote({
  kind,
  colors,
  onBack,
  context,
  readingsLoading,
  hasEmail,
  hasPhone,
  doctorLabel,
  onEmail,
  onText,
  onShareWithPdf,
}: {
  kind: NoteKind;
  colors: Palette;
  onBack: () => void;
  context: Parameters<typeof buildNote>[1];
  readingsLoading: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  doctorLabel: string;
  onEmail: (subject: string, body: string) => void;
  onText: (body: string) => void;
  onShareWithPdf: (subject: string, body: string) => Promise<void>;
}) {
  const note = useMemo(() => buildNote(kind, context), [kind, context]);
  const [message, setMessage] = useState(note.message);
  const [edited, setEdited] = useState(false);
  // Until the family types, keep the starter in step with readings that are still loading in.
  useEffect(() => {
    if (!edited) setMessage(note.message);
  }, [note.message, edited]);
  const [attach, setAttach] = useState(false);
  const [sharing, setSharing] = useState(false);
  const meta = NOTE_KINDS.find((k) => k.kind === kind)!;
  const body = noteBody(message, note);

  const shareWithPdf = async () => {
    setSharing(true);
    try {
      await onShareWithPdf(note.subject, body);
    } catch {
      Alert.alert("Couldn't build the summary", "Check your internet connection and try again.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <BackRow colors={colors} title={`Note to ${doctorLabel}`} onBack={onBack} />
      <View style={[styles.tag, { backgroundColor: meta.tint + "24" }]}>
        <Feather name={meta.icon as React.ComponentProps<typeof Feather>["name"]} size={13} color={meta.tint} />
        <Text style={[styles.tagText, { color: meta.tint }]}>{meta.title}</Text>
      </View>
      <TextInput
        style={[styles.messageInput, { color: colors.text, borderColor: COLORS.primary, backgroundColor: colors.backgroundTertiary }]}
        value={message}
        onChangeText={(t) => {
          setEdited(true);
          setMessage(t);
        }}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Your message to the doctor"
      />
      {note.details.length > 0 && (
        <View style={[styles.detailsBox, { borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[styles.detailsTitle, { color: colors.textMuted }]}>{`ADDED FROM THE APP · ${note.detailsTitle.split("·")[1]?.trim().toUpperCase() ?? ""}`}</Text>
            {readingsLoading && <ActivityIndicator size="small" color={colors.textMuted} />}
          </View>
          {note.details.map((d, i) => (
            <View key={i} style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]} numberOfLines={2}>{d.label}</Text>
              <Text style={[styles.detailValue, { color: d.tone === "low" ? COLORS.danger : d.tone === "high" ? COLORS.warning : colors.text }]}>{d.value}</Text>
            </View>
          ))}
        </View>
      )}
      <ToggleRow colors={colors} label="Attach 7-day Visit Summary PDF" hint="Sends through your share menu so the PDF can go with it." value={attach} onChange={setAttach} />
      {attach ? (
        <Pressable onPress={shareWithPdf} disabled={sharing} accessibilityRole="button" style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || sharing ? 0.85 : 1 }]}>
          <BrandShade radius={14} />
          {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="share" size={16} color="#fff" />}
          <Text style={styles.primaryBtnText}>{sharing ? "Building PDF…" : "Send with PDF"}</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => onText(body)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <ControlShade radius={14} />
            <Feather name="message-circle" size={16} color={colors.text} />
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Text</Text>
          </Pressable>
          <Pressable onPress={() => onEmail(note.subject, body)} accessibilityRole="button" style={({ pressed }) => [styles.primaryBtn, { flex: 1, opacity: pressed ? 0.85 : 1 }]}>
            <BrandShade radius={14} />
            <Feather name="mail" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Email</Text>
          </Pressable>
        </View>
      )}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {attach
          ? "Pick Mail or Messages, then choose who to send it to."
          : `Opens your ${hasEmail || !hasPhone ? "email" : "messages"} app with everything filled in${
              hasEmail ? "" : ". Add the doctor's email in Doctor Office so it fills in the address too"
            }. You can change anything before you send.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  doctorCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: COLORS.primary },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  doctorName: { fontSize: 16, fontWeight: "700" },
  doctorSub: { fontSize: 13, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 10, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  actionText: { fontSize: 13, fontWeight: "600" },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 10, marginLeft: 2 },
  bigBtn: { borderRadius: 16, padding: 14, overflow: "hidden", backgroundColor: COLORS.primary, gap: 4 },
  bigBtnTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  bigBtnSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, lineHeight: 18 },
  seg: { flexDirection: "row", gap: 6 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  segText: { fontSize: 13, fontWeight: "600" },
  peek: { flexDirection: "row", gap: 8 },
  peekBox: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1 },
  peekValue: { fontSize: 18, fontWeight: "700" },
  peekLabel: { fontSize: 11, marginTop: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  toggleHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  hint: { fontSize: 12, lineHeight: 17 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, borderWidth: 1 },
  noteIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  noteText: { flex: 1, fontSize: 14, fontWeight: "500" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  backText: { fontSize: 15, fontWeight: "600" },
  backTitle: { flex: 1, textAlign: "right", fontSize: 15, fontWeight: "700", marginLeft: 8 },
  fieldLabel: { fontSize: 12, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: "700" },
  messageInput: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, lineHeight: 22, minHeight: 130 },
  detailsBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: 14, padding: 12, gap: 6 },
  detailsTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  detailLabel: { flex: 1, fontSize: 13 },
  detailValue: { fontSize: 13, fontWeight: "700" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, overflow: "hidden", backgroundColor: COLORS.primary },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  secondaryBtnText: { fontSize: 15, fontWeight: "700" },
});
