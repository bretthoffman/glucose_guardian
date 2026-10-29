/**
 * The handoff sheet: a pop-up, like "What's new", that catches the next person up. Nobody has to
 * send anything; it is filled in from the logs and readings this phone already has (utils/handoff).
 *
 * - A caregiver (school nurse, grandma: an access code, or a nurse account viewing the child) sees
 *   "Good morning, Holly. Here's Bella's morning." on the first open of the day, with the parent's
 *   note if one was left (convex/handoff). They can leave a note back for the family.
 * - A parent (the owner or a co-guardian) sees "While you were away" when they come back after 90+
 *   minutes and someone else logged meanwhile, or when a caregiver left them a note.
 *
 * It waits for What's new to finish so the two never stack.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { findInsulinByChipLabel } from "@/constants/insulin";
import { AccentShade } from "@/components/Shade";
import { BrandMark } from "@/components/BrandLogo";
import { useWhatsNewBusy } from "@/components/WhatsNew";
import { useAuth, type FoodLogEntry, type InsulinLogEntry } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useMessages } from "@/context/MessagesContext";
import { useTheme } from "@/context/ThemeContext";
import { api } from "@/utils/convex-auth-client";
import { capFirst } from "@/utils/capitalize";
import {
  buildHandoffSummary,
  firstName,
  shouldShowHandoff,
  type HandoffItem,
  type HandoffKind,
  type HandoffLog,
  type HandoffSummary,
} from "@/utils/handoff";
import { computeActiveInsulin } from "@/utils/onBoard";
import { toLocalDate } from "@/utils/pens";
import { getEffectiveTrend } from "@/utils/trend";

const STORE_PREFIX = "gg.handoff.v1:";
/** Let launch settle (What's new, first render) before the sheet slides up. */
const SHOW_DELAY_MS = 1200;
/** Never wait on What's new forever (e.g. it unmounted before deciding). */
const WHATS_NEW_WAIT_CAP_MS = 15_000;
/** A reading older than this isn't "right now". */
const FRESH_READING_MS = 20 * 60_000;

type Palette = (typeof Colors)["light"];

interface HandoffNote {
  id: string;
  text: string;
  fromName: string;
  createdAt: number;
}

interface Stored {
  lastActiveMs?: number;
  lastShownDay?: string;
  lastShownMs?: number;
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function insulinTitle(e: InsulinLogEntry): string {
  const opt = e.insulinType ? findInsulinByChipLabel(e.insulinType) : undefined;
  const name = opt?.name ?? e.insulinType?.split(" · ")[0] ?? "Insulin";
  const units = Math.round(e.units * 100) / 100;
  return `${name} ${units} ${units === 1 ? "unit" : "units"}`;
}

function mealTitle(f: FoodLogEntry): string {
  const carbs = Math.round(f.estimatedCarbs);
  return `${capFirst(f.foodName || "Meal")} · ${carbs}g carbs`;
}

/** Who is looking: a caregiver (by access code) or a family account. Null = no handoff here. */
export function useHandoffViewer(): { kind: HandoffKind; args: { code?: string }; storeKey: string; name: string } | null {
  const auth = useAuth();
  return useMemo(() => {
    if (auth.doctorSession) return null;
    if (auth.caregiverSession) {
      if (auth.accessCodeRole !== "caregiver" || auth.caregiverCodeKind !== "access" || !auth.caregiverCloudCode) return null;
      return { kind: "caregiver" as const, args: { code: auth.caregiverCloudCode }, storeKey: `c:${auth.caregiverCloudCode}`, name: "" };
    }
    if (auth.isCaregiverAccount) {
      // A nurse account viewing a child reads it through the child's access code.
      if (!auth.nurseViewCode) return null;
      return { kind: "caregiver" as const, args: { code: auth.nurseViewCode }, storeKey: `c:${auth.nurseViewCode}`, name: auth.ownParentName ?? "" };
    }
    if (!auth.isSignedIn || !auth.account?.convexUserId || auth.isChildMode) return null;
    return { kind: "family" as const, args: {}, storeKey: `u:${auth.account.convexUserId}`, name: auth.ownParentName ?? "" };
  }, [
    auth.doctorSession,
    auth.caregiverSession,
    auth.accessCodeRole,
    auth.caregiverCodeKind,
    auth.caregiverCloudCode,
    auth.isCaregiverAccount,
    auth.nurseViewCode,
    auth.isSignedIn,
    auth.account?.convexUserId,
    auth.isChildMode,
    auth.ownParentName,
  ]);
}

/** Logs as the sheet sees them, with "by you" worked out for this viewer. */
export function useHandoffLogs(viewer: { kind: HandoffKind; args: { code?: string } } | null): HandoffLog[] {
  const { insulinLog, foodLog, fingerStickLog, account } = useAuth();
  return useMemo(() => {
    if (!viewer) return [];
    const myId = account?.convexUserId ?? null;
    const myCode = viewer.args.code?.toUpperCase() ?? null;
    const mine = (l: { authorUserId?: string; authorCode?: string }) =>
      viewer.kind === "caregiver"
        ? !!myCode && l.authorCode?.toUpperCase() === myCode
        : // Entries from before bylines carry no author: those were the owner's own phone.
          (!!myId && l.authorUserId === myId) || (!l.authorUserId && !l.authorCode);
    return [
      ...(insulinLog ?? [])
        .filter((e) => e.units > 0)
        .map((e) => ({ timestamp: e.timestamp, kind: "insulin" as const, title: insulinTitle(e), authorName: e.authorName, byYou: mine(e) })),
      ...(foodLog ?? []).map((f) => ({ timestamp: f.timestamp, kind: "meal" as const, title: mealTitle(f), authorName: f.authorName, byYou: mine(f) })),
      ...(fingerStickLog ?? []).map((f) => ({
        timestamp: f.timestamp,
        kind: "stick" as const,
        title: `Finger stick ${Math.round(f.glucose)}`,
        authorName: f.authorName,
        byYou: mine(f),
      })),
    ];
  }, [viewer, insulinLog, foodLog, fingerStickLog, account?.convexUserId]);
}

/** Builds the sheet for this viewer right now (also used by the Dashboard Handoff preview). */
export function useHandoffSummaryBuilder(viewer: { kind: HandoffKind; args: { code?: string }; name: string } | null) {
  const { profile, insulinLog, caregiverSession } = useAuth();
  const { history, latestReading } = useGlucose();
  const logs = useHandoffLogs(viewer);
  return useCallback(
    (opts: { kind?: HandoffKind; sinceMs?: number | null; viewerName?: string; nowMs?: number }): HandoffSummary => {
      const nowMs = opts.nowMs ?? Date.now();
      const kind = opts.kind ?? viewer?.kind ?? "caregiver";
      const latestMs = latestReading ? new Date(latestReading.timestamp).getTime() : NaN;
      const fresh = latestReading && Number.isFinite(latestMs) && nowMs - latestMs <= FRESH_READING_MS;
      const iob = computeActiveInsulin(insulinLog ?? [], nowMs);
      return buildHandoffSummary({
        kind,
        viewerName: opts.viewerName ?? viewer?.name ?? (caregiverSession ? "there" : ""),
        childName: profile?.childName?.trim() || "your child",
        nowMs,
        sinceMs: opts.sinceMs,
        readings: history.map((h) => ({ glucose: h.glucose, timestamp: h.timestamp })),
        // From the preview, the caregiver's view shows the caregiver's side (every log, by name).
        logs: opts.kind === "caregiver" && viewer?.kind === "family" ? logs.map((l) => ({ ...l, byYou: false, authorName: l.authorName ?? (l.byYou ? viewer.name || undefined : undefined) })) : logs,
        current: fresh ? { glucose: Math.round(latestReading!.glucose), trend: getEffectiveTrend(history).label } : null,
        iob: { units: iob.totalUnits, remainingMin: iob.remainingMin },
        fmtTime: fmtClock,
      });
    },
    [viewer, profile?.childName, history, latestReading, insulinLog, logs, caregiverSession],
  );
}

async function readStore(key: string): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(STORE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

async function writeStore(key: string, patch: Stored): Promise<void> {
  try {
    const cur = await readStore(key);
    await AsyncStorage.setItem(STORE_PREFIX + key, JSON.stringify({ ...cur, ...patch }));
  } catch {
    // best-effort: worst case the sheet shows once more
  }
}

export function HandoffPrompt() {
  const { isLoading, profile, accessCodeRole, accessCodePermissions, accessLock } = useAuth();
  const viewer = useHandoffViewer();
  const whatsNewBusy = useWhatsNewBusy();
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  const forMe = useQuery(api.handoff.forMe, viewer ? viewer.args : "skip") as
    | { note: HandoffNote | null; sent: unknown }
    | null
    | undefined;
  const markSeen = useMutation(api.handoff.markSeen);
  const build = useHandoffSummaryBuilder(viewer);
  const logs = useHandoffLogs(viewer);
  const [shown, setShown] = useState<{ summary: HandoffSummary; note: HandoffNote | null; otherName: string | null } | null>(null);
  const busy = useRef(false);
  const latest = useRef({ build, logs, forMe, viewer });
  latest.current = { build, logs, forMe, viewer };

  useEffect(() => {
    const t = setTimeout(() => setWaitedLongEnough(true), WHATS_NEW_WAIT_CAP_MS);
    return () => clearTimeout(t);
  }, []);

  // Outside a caregiver's hours the lock screen is up: wait until they're let in.
  const ready = !isLoading && !accessLock && !!profile && !!viewer && forMe !== undefined && (!whatsNewBusy || waitedLongEnough);
  const noteCreatedAt = forMe?.note?.createdAt ?? null;

  const evaluate = useCallback(async () => {
    const { build: b, logs: l, forMe: fm, viewer: v } = latest.current;
    if (!v || fm === undefined || busy.current || shown) return;
    busy.current = true;
    try {
      const nowMs = Date.now();
      const stored = await readStore(v.storeKey);
      const note = fm?.note ?? null;
      const sinceMs = v.kind === "family" ? stored.lastActiveMs ?? null : null;
      const summary = b({ sinceMs });
      const othersLogged =
        sinceMs != null && l.some((x) => !x.byYou && new Date(x.timestamp).getTime() > sinceMs);
      const show = shouldShowHandoff({
        kind: v.kind,
        nowMs,
        todayKey: toLocalDate(new Date(nowMs)),
        lastShownDay: stored.lastShownDay ?? null,
        lastShownMs: stored.lastShownMs ?? null,
        lastOpenMs: stored.lastActiveMs ?? null,
        othersLoggedSinceLastOpen: othersLogged,
        hasContent: summary.items.length > 0 || summary.now != null || summary.active != null || !!note,
        noteCreatedAt: note?.createdAt ?? null,
      });
      if (show) {
        await new Promise((r) => setTimeout(r, SHOW_DELAY_MS));
        // "Message Holly": the note's author, else whoever else logged most recently.
        const lastOther = l
          .filter((x) => !x.byYou && x.authorName)
          .sort((a, c) => new Date(c.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        const otherName = note ? firstName(note.fromName) : lastOther?.authorName ? firstName(lastOther.authorName) : null;
        setShown({ summary, note, otherName });
        if (note) markSeen({ ...v.args, noteId: note.id as never }).catch(() => {});
        await writeStore(v.storeKey, { lastShownDay: toLocalDate(new Date(nowMs)), lastShownMs: nowMs, lastActiveMs: nowMs });
      } else {
        await writeStore(v.storeKey, { lastActiveMs: nowMs });
      }
    } finally {
      busy.current = false;
    }
  }, [markSeen, shown]);

  // At launch, when a newer note arrives, and each time the app comes back to the front.
  useEffect(() => {
    if (ready) void evaluate();
  }, [ready, noteCreatedAt, evaluate]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      const v = latest.current.viewer;
      if (s === "active") {
        if (ready) void evaluate();
      } else if (s === "background" && v) {
        void writeStore(v.storeKey, { lastActiveMs: Date.now() });
      }
    });
    return () => sub.remove();
  }, [ready, evaluate]);

  if (!shown || !viewer || accessLock) return null;
  const chatLocked = accessCodeRole != null && !accessCodePermissions?.chat;
  return (
    <HandoffSheet
      summary={shown.summary}
      note={shown.note}
      otherName={shown.otherName}
      viewerArgs={viewer.args}
      canMessage={!chatLocked}
      onClose={() => setShown(null)}
    />
  );
}

function usePalette(): { colors: Palette; isDark: boolean } {
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  return { colors: isDark ? Colors.dark : Colors.light, isDark };
}

const ITEM_ICON: Record<HandoffItem["icon"], { name: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; color: string }> = {
  insulin: { name: "needle", color: COLORS.primaryLight },
  meal: { name: "silverware-fork-knife", color: COLORS.success },
  stick: { name: "water-outline", color: "#6CC4FF" },
  low: { name: "arrow-down-circle-outline", color: COLORS.danger },
  high: { name: "arrow-up-circle-outline", color: COLORS.warning },
};

/** The sheet's content, shared by the pop-up and the Dashboard preview. */
export function HandoffBody({ summary, note, colors }: { summary: HandoffSummary; note: HandoffNote | null; colors: Palette }) {
  return (
    <View style={{ gap: 14 }}>
      {(summary.now || summary.active || summary.inRangePct != null) && (
        <View style={styles.statRow}>
          {summary.now && (
            <View style={[styles.stat, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Right now</Text>
              <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {summary.now.glucose}
              </Text>
              {!!summary.now.trend && <Text style={[styles.statSub, { color: colors.textSecondary }]}>{summary.now.trend}</Text>}
            </View>
          )}
          {summary.active ? (
            <View style={[styles.stat, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Still active</Text>
              <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {summary.active.units}u
              </Text>
              <Text style={[styles.statSub, { color: colors.textSecondary }]}>Wears off around {fmtClock(summary.active.wearsOffAt)}</Text>
            </View>
          ) : summary.inRangePct != null ? (
            <View style={[styles.stat, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>In range</Text>
              <Text style={[styles.statValue, { color: colors.text }]}>{summary.inRangePct}%</Text>
              <Text style={[styles.statSub, { color: colors.textSecondary }]}>70 to 180, since you looked</Text>
            </View>
          ) : null}
        </View>
      )}
      {note && (
        <View style={[styles.note, { borderColor: COLORS.primary + "55", backgroundColor: COLORS.primary + "14" }]}>
          <Text style={[styles.noteFrom, { color: COLORS.primaryLight }]}>Note from {firstName(note.fromName)}</Text>
          <Text style={[styles.noteText, { color: colors.text }]}>{note.text}</Text>
        </View>
      )}
      {summary.items.length > 0 ? (
        <View style={{ gap: 12 }}>
          {summary.items.map((item, i) => (
            <View key={`${item.title}-${i}`} style={styles.item}>
              <View style={[styles.itemIcon, { backgroundColor: ITEM_ICON[item.icon].color + "26" }]}>
                <MaterialCommunityIcons name={ITEM_ICON[item.icon].name} size={18} color={ITEM_ICON[item.icon].color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.itemSub, { color: colors.textSecondary }]}>{item.sub}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Nothing logged yet.</Text>
      )}
    </View>
  );
}

/** Drawn as an overlay (like What's new), not a native Modal, so it shows reliably at launch. */
function HandoffSheet({
  summary,
  note,
  otherName,
  viewerArgs,
  canMessage,
  onClose,
}: {
  summary: HandoffSummary;
  note: HandoffNote | null;
  otherName: string | null;
  viewerArgs: { code?: string };
  canMessage: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = usePalette();
  const { threads } = useMessages();
  const leaveNote = useMutation(api.handoff.leaveNote);
  const slide = useRef(new Animated.Value(1)).current;
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 280, useNativeDriver: true }).start();
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [slide, onClose]);

  const showMessage = canMessage && threads.length > 0;

  const sendNote = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await leaveNote({ ...viewerArgs, text });
      setSent(true);
      setWriting(false);
    } catch {
      // keep the draft so they can try again
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <KeyboardAvoidingView style={styles.sheetHost} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,25,45,0.38)" }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close the handoff"
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 20 },
            { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 700] }) }] },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.kickerRow}>
            <BrandMark size={22} />
            <Text style={[styles.kicker, { color: COLORS.primaryLight }]} numberOfLines={1}>
              HANDOFF · {summary.timeLabel.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {summary.heading}
          </Text>
          {!!summary.sinceLine && (
            <Text style={[styles.since, { color: colors.textSecondary }]}>{summary.sinceLine}</Text>
          )}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingVertical: 4 }} keyboardShouldPersistTaps="handled">
            <HandoffBody summary={summary} note={note} colors={colors} />
            {summary.kind === "caregiver" && (
              <View style={{ marginTop: 16 }}>
                {sent ? (
                  <Text style={[styles.itemSub, { color: COLORS.success }]}>Your note was sent to the family.</Text>
                ) : writing ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Ate all her lunch, PE at 1:30, felt fine"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      maxLength={500}
                      autoCapitalize="sentences"
                      autoFocus
                      style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
                      accessibilityLabel="Note for the family"
                    />
                    <Pressable
                      onPress={sendNote}
                      disabled={!draft.trim() || sending}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.secondaryBtn, { borderColor: COLORS.primary, opacity: !draft.trim() || sending ? 0.5 : pressed ? 0.8 : 1 }]}
                    >
                      <Text style={[styles.secondaryText, { color: COLORS.primaryLight }]}>{sending ? "Sending..." : "Send note"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setWriting(true)} accessibilityRole="button" style={styles.linkBtn}>
                    <Text style={[styles.linkText, { color: COLORS.primaryLight }]}>Leave a note for the family</Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <AccentShade radius={14} />
            <Text style={styles.primaryBtnText}>Got it</Text>
          </Pressable>
          {showMessage && (
            <Pressable
              onPress={() => {
                onClose();
                router.push({ pathname: "/(tabs)/chat", params: { openMessages: String(Date.now()) } });
              }}
              accessibilityRole="button"
              style={styles.linkBtn}
            >
              <Text style={[styles.linkText, { color: COLORS.primaryLight }]}>{otherName ? `Message ${otherName}` : "Open Messages"}</Text>
            </Pressable>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  sheetHost: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 22,
    paddingTop: 10,
    maxHeight: "90%",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  grabber: { width: 40, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 14 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, flexShrink: 1 },
  title: { fontSize: 24, fontWeight: "800", marginTop: 8, marginBottom: 14, lineHeight: 30 },
  since: { fontSize: 14, marginTop: -8, marginBottom: 14 },
  statRow: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, borderRadius: 16, padding: 14, gap: 2 },
  statLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 30, fontWeight: "800" },
  statSub: { fontSize: 13, lineHeight: 17 },
  note: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  noteFrom: { fontSize: 13, fontWeight: "700" },
  noteText: { fontSize: 16, lineHeight: 22 },
  item: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 16, fontWeight: "700" },
  itemSub: { fontSize: 14, lineHeight: 19, marginTop: 1 },
  input: { borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 72, fontSize: 16, textAlignVertical: "top" },
  primaryBtn: {
    marginTop: 18,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondaryBtn: { height: 46, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 16, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkText: { fontSize: 15, fontWeight: "600" },
});
