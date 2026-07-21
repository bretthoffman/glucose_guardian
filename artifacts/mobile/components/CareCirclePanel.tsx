/**
 * Care Circle panel — the management surface for account linking (see CARE_CIRCLE_ROLES_AUDIT_01.md).
 *
 *  - Co-guardians (parents/spouses): real accounts joined via short-lived invite codes; max 3.
 *  - External guardians (teacher/babysitter/relative): named persistent 8-char access codes with
 *    per-code permissions + schedules; retire to kill, schedule to pause/resume.
 *  - Parent-kid mode (`dependentMode`): moves admin control to the co-guardians; the patient (kid)
 *    device is governed by device permissions shown here as one more manageable row.
 *
 * The server is the enforcement boundary — every list row's status chip renders the SERVER's
 * `accessState` evaluation; this panel never re-derives access locally.
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CareAccess, CarePermissions } from "../../../convex/careSchedule";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { formatTimeInputText, parseTimeInputText } from "@/utils/logTime";

type AccessState = { state: "ok" | "before_window" | "outside_window" | "disabled"; nextStartMs?: number };

interface CoGuardianRow {
  linkId: Id<"careLinks">;
  memberUserId: Id<"users">;
  displayName: string;
  permissions: CarePermissions;
  access: CareAccess;
  accessState: AccessState;
  isMe: boolean;
  createdAt: number;
}

interface AccessCodeRow {
  codeId: Id<"careAccessCodes">;
  code: string;
  label: string;
  kind: "caregiver" | "child";
  permissions: CarePermissions;
  access: CareAccess;
  accessState: AccessState;
  lastUsedAt?: number;
  createdAt: number;
}

/** A peer in the shared circle — the owner (Dexcom/patient account) or a co-guardian. */
interface GuardianRow {
  userId: Id<"users">;
  displayName: string;
  isMe: boolean;
  isOwner: boolean;
  linkId: Id<"careLinks"> | null;
  accessState: AccessState;
}

interface CircleData {
  isAdmin: boolean;
  settings: { dependentMode: boolean; devicePermissions: CarePermissions };
  patientUserId: Id<"users">;
  patientName: string;
  guardians: GuardianRow[];
  maxGuardians: number;
  coGuardians: CoGuardianRow[];
  pendingInvites: { inviteId: Id<"careInvites">; code: string; expiresAt: number }[];
  accessCodes: AccessCodeRow[];
}

interface MembershipRow {
  linkId: Id<"careLinks">;
  patientUserId: Id<"users">;
  patientName: string;
  permissions: CarePermissions;
  access: CareAccess;
  accessState: AccessState;
  dependentMode: boolean;
}

interface IncomingInvite {
  inviteId: Id<"careInvites">;
  code: string;
  patientUserId: Id<"users">;
  patientName: string;
  invitedByName: string;
  expiresAt: number;
}

const VIEWER_PERMISSIONS: CarePermissions = {
  viewReadings: true,
  viewLogs: true,
  log: false,
  useCalculator: false,
  chat: false,
};

/** Convex surfaces server `throw new Error("msg")` inside a noisy wrapper — pull the message out. */
function cleanConvexError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw);
  const marker = "Uncaught Error: ";
  const at = text.indexOf(marker);
  if (at >= 0) {
    const rest = text.slice(at + marker.length);
    const end = rest.indexOf(" at handler");
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  }
  return "Something went wrong. Check your connection and try again.";
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtNextOpening(ms: number): string {
  const withinDay = ms - Date.now() < 24 * 60 * 60 * 1000;
  if (withinDay) return fmtClock(ms);
  return `${new Date(ms).toLocaleDateString([], { weekday: "short" })} ${fmtClock(ms)}`;
}

function minutesToTimeText(minutes: number): string {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return formatTimeInputText(d);
}

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function describeAccess(access: CareAccess): string {
  switch (access.mode) {
    case "always":
      return "Always on";
    case "disabled":
      return "Turned off";
    case "window":
      return Date.now() < access.endMs ? `One-time · until ${fmtNextOpening(access.endMs)}` : "One-time · ended";
    case "weekly": {
      const days = access.days.map((d) => DAY_LETTERS[d] ?? "?").join(" ");
      return `${days} · ${minutesToTimeText(access.startMinute)}–${minutesToTimeText(access.endMinute)}`;
    }
  }
}

/** QR of a code on a white tile so it scans reliably in any theme (phone cameras decode the text). */
function CodeQR({ value }: { value: string }) {
  return (
    <View style={styles.qrTile}>
      <QRCode value={value} size={132} color="#0B1830" backgroundColor="#FFFFFF" />
    </View>
  );
}

function AccessChip({ accessState, colors }: { accessState: AccessState; colors: (typeof Colors)["light"] }) {
  const { state, nextStartMs } = accessState;
  const [label, color] =
    state === "ok"
      ? ["Active now", COLORS.success]
      : state === "disabled"
      ? ["Off", colors.textMuted]
      : nextStartMs != null
      ? [`Opens ${fmtNextOpening(nextStartMs)}`, COLORS.warning]
      : ["Window ended", COLORS.warning];
  return (
    <View style={[styles.chip, { backgroundColor: color + "1E" }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const PERMISSION_ROWS: { key: keyof CarePermissions; label: string; deviceRow: boolean }[] = [
  { key: "viewReadings", label: "View glucose readings", deviceRow: false },
  { key: "viewLogs", label: "View food & insulin logs", deviceRow: false },
  { key: "log", label: "Add logs", deviceRow: true },
  { key: "useCalculator", label: "Use the dose calculator", deviceRow: true },
  { key: "chat", label: "Use the AI chat", deviceRow: true },
];

function PermissionToggles({
  value,
  onChange,
  colors,
  deviceOnly = false,
  disabled = false,
}: {
  value: CarePermissions;
  onChange: (next: CarePermissions) => void;
  colors: (typeof Colors)["light"];
  /** Kid-device rows only (viewing own data is never restricted). */
  deviceOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      {PERMISSION_ROWS.filter((r) => !deviceOnly || r.deviceRow).map((row) => (
        <View key={row.key} style={styles.permRow}>
          <Text style={[styles.permLabel, { color: colors.text }]}>{row.label}</Text>
          <Switch
            value={value[row.key]}
            disabled={disabled}
            trackColor={{ true: COLORS.primary }}
            onValueChange={(on) => onChange({ ...value, [row.key]: on })}
          />
        </View>
      ))}
    </View>
  );
}

const WINDOW_HOUR_CHOICES = [1, 3, 6, 12, 24, 48];

function ScheduleEditor({
  value,
  onChange,
  colors,
}: {
  value: CareAccess;
  onChange: (next: CareAccess) => void;
  colors: (typeof Colors)["light"];
}) {
  const [startText, setStartText] = useState(
    value.mode === "weekly" ? minutesToTimeText(value.startMinute) : "8:00 AM",
  );
  const [endText, setEndText] = useState(
    value.mode === "weekly" ? minutesToTimeText(value.endMinute) : "3:30 PM",
  );

  const weeklyDays = value.mode === "weekly" ? value.days : [1, 2, 3, 4, 5];

  const commitWeekly = (days: number[], sText: string, eText: string) => {
    const s = parseTimeInputText(sText);
    const e = parseTimeInputText(eText);
    if (!s || !e) return;
    const startMinute = s.hours * 60 + s.minutes;
    const endMinute = e.hours * 60 + e.minutes;
    if (endMinute <= startMinute || days.length === 0) return;
    onChange({
      mode: "weekly",
      days,
      startMinute,
      endMinute,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.modeChipsRow}>
        {(
          [
            ["always", "Always"],
            ["weekly", "Schedule"],
            ["window", "One-time"],
            ["disabled", "Off"],
          ] as const
        ).map(([mode, label]) => {
          const active = value.mode === mode;
          return (
            <Pressable
              key={mode}
              style={[
                styles.modeChip,
                { backgroundColor: active ? COLORS.primary : colors.backgroundTertiary, borderColor: active ? COLORS.primary : colors.border },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (mode === "always") onChange({ mode: "always" });
                else if (mode === "disabled") onChange({ mode: "disabled" });
                else if (mode === "window") {
                  const now = Date.now();
                  onChange({ mode: "window", startMs: now, endMs: now + 3 * 3_600_000 });
                } else {
                  commitWeekly(weeklyDays, startText, endText);
                  if (value.mode !== "weekly") {
                    onChange({
                      mode: "weekly",
                      days: [1, 2, 3, 4, 5],
                      startMinute: 8 * 60,
                      endMinute: 15 * 60 + 30,
                      tzOffsetMinutes: -new Date().getTimezoneOffset(),
                    });
                  }
                }
              }}
            >
              <Text style={[styles.modeChipText, { color: active ? "#fff" : colors.textSecondary }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {value.mode === "window" && (
        <View style={{ gap: 8 }}>
          <Text style={[styles.editorHint, { color: colors.textSecondary }]}>
            Starts now — pick how long access lasts:
          </Text>
          <View style={styles.modeChipsRow}>
            {WINDOW_HOUR_CHOICES.map((h) => {
              const active = Math.round((value.endMs - value.startMs) / 3_600_000) === h;
              return (
                <Pressable
                  key={h}
                  style={[
                    styles.hourChip,
                    { backgroundColor: active ? COLORS.primary : colors.backgroundTertiary, borderColor: active ? COLORS.primary : colors.border },
                  ]}
                  onPress={() => {
                    const now = Date.now();
                    onChange({ mode: "window", startMs: now, endMs: now + h * 3_600_000 });
                  }}
                >
                  <Text style={[styles.modeChipText, { color: active ? "#fff" : colors.textSecondary }]}>{h}h</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.editorHint, { color: colors.textMuted }]}>
            Ends {fmtNextOpening(value.endMs)}
          </Text>
        </View>
      )}

      {value.mode === "weekly" && (
        <View style={{ gap: 8 }}>
          <View style={styles.modeChipsRow}>
            {DAY_LETTERS.map((letter, day) => {
              const active = weeklyDays.includes(day);
              return (
                <Pressable
                  key={day}
                  style={[
                    styles.dayChip,
                    { backgroundColor: active ? COLORS.primary : colors.backgroundTertiary, borderColor: active ? COLORS.primary : colors.border },
                  ]}
                  onPress={() => {
                    const next = active ? weeklyDays.filter((d) => d !== day) : [...weeklyDays, day].sort();
                    commitWeekly(next, startText, endText);
                  }}
                >
                  <Text style={[styles.modeChipText, { color: active ? "#fff" : colors.textSecondary }]}>{letter}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.timeRow}>
            <TextInput
              value={startText}
              onChangeText={(t) => {
                setStartText(t);
                commitWeekly(weeklyDays, t, endText);
              }}
              style={[styles.timeInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: parseTimeInputText(startText) ? colors.border : COLORS.danger }]}
              placeholder="8:00 AM"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={{ color: colors.textMuted }}>to</Text>
            <TextInput
              value={endText}
              onChangeText={(t) => {
                setEndText(t);
                commitWeekly(weeklyDays, startText, t);
              }}
              style={[styles.timeInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: parseTimeInputText(endText) ? colors.border : COLORS.danger }]}
              placeholder="3:30 PM"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <Text style={[styles.editorHint, { color: colors.textMuted }]}>
            Access turns on only during these hours (your timezone).
          </Text>
        </View>
      )}
    </View>
  );
}

export default function CareCirclePanel({
  colors,
  onClose,
}: {
  colors: (typeof Colors)["light"];
  /** Close the hosting dashboard popup — used after entering viewing mode. */
  onClose?: () => void;
}) {
  const { account, profile, enterViewingMode } = useAuth();

  const [circle, setCircle] = useState<CircleData | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [incoming, setIncoming] = useState<IncomingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [createdInvite, setCreatedInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [showCreateCode, setShowCreateCode] = useState(false);
  const [newCodeLabel, setNewCodeLabel] = useState("");
  const [newCodePermissions, setNewCodePermissions] = useState<CarePermissions>({ ...VIEWER_PERMISSIONS });
  const [newCodeAccess, setNewCodeAccess] = useState<CareAccess>({ mode: "always" });
  const [createdCode, setCreatedCode] = useState<{ code: string; label: string } | null>(null);
  const [editingCodeId, setEditingCodeId] = useState<Id<"careAccessCodes"> | null>(null);
  const [qrCodeId, setQrCodeId] = useState<Id<"careAccessCodes"> | null>(null);
  const [sensorResult, setSensorResult] = useState<
    { hasCredentials: boolean; matches: { userId: Id<"users">; email: string; name: string; alreadyLinked: boolean }[] } | null
  >(null);
  const [sensorSearched, setSensorSearched] = useState(false);
  const [editPermissions, setEditPermissions] = useState<CarePermissions>({ ...VIEWER_PERMISSIONS });
  const [editAccess, setEditAccess] = useState<CareAccess>({ mode: "always" });
  const [joinCode, setJoinCode] = useState("");

  const myUserId = (account?.convexUserId ?? null) as Id<"users"> | null;
  // Co-guardians share ONE circle, anchored on the patient/Dexcom-owner account. If I'm a co-guardian
  // of someone's circle, that shared circle is my view; otherwise I'm the owner of my own. Both sides
  // resolve to the same anchor, so both render the identical roster/codes. The loaded circle's own
  // `patientUserId` is the authoritative target for every create/manage action.
  const targetPatientId = (circle?.patientUserId as Id<"users"> | undefined) ?? myUserId;
  const viewingOthersCircle = circle != null && myUserId != null && circle.patientUserId !== myUserId;

  const refresh = useCallback(async (silent = false) => {
    if (!account?.convexUserId) {
      setLoading(false);
      setError("Sign in with a Glucose Guardian account to use the Care Circle.");
      return;
    }
    // Silent refreshes (after an action) update data in place — no full-panel spinner remount,
    // which would blink the popup and jump the scroll back to the top.
    if (!silent) setLoading(true);
    setError("");
    try {
      const client = createConvexAuthClient();
      const userId = account.convexUserId as Id<"users">;
      // Resolve the shared anchor first (memberships tell me whose circle I belong to), then load
      // that one merged circle — so a co-guardian and the owner see identical data.
      const [m, inc] = await Promise.all([
        client.query(api.careCircle.myMemberships, { userId, passwordHash: account.passwordHash }),
        client.query(api.careCircle.incomingInvites, { userId, passwordHash: account.passwordHash }),
      ]);
      const memberships = m as MembershipRow[];
      const anchor = (memberships[0]?.patientUserId as Id<"users"> | undefined) ?? userId;
      let c = (await client.query(api.careCircle.getCircle, {
        userId,
        passwordHash: account.passwordHash,
        patientUserId: anchor,
      })) as CircleData | null;
      // Never leave the panel blank: if the shared circle can't be loaded (e.g. a stale membership),
      // fall back to my own circle so I can always manage codes and invites.
      if (!c && anchor !== userId) {
        c = (await client.query(api.careCircle.getCircle, {
          userId,
          passwordHash: account.passwordHash,
          patientUserId: userId,
        })) as CircleData | null;
      }
      setCircle(c);
      setMemberships(memberships);
      setIncoming(inc as IncomingInvite[]);
    } catch {
      setError("Could not load the care circle. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [account?.convexUserId, account?.passwordHash]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (fn: (client: ReturnType<typeof createConvexAuthClient>, userId: Id<"users">, passwordHash: string) => Promise<void>) => {
      if (!account?.convexUserId) return;
      setBusy(true);
      try {
        const client = createConvexAuthClient();
        await fn(client, account.convexUserId as Id<"users">, account.passwordHash);
        await refresh(true);
      } catch (e) {
        Alert.alert("Care Circle", cleanConvexError(e));
      } finally {
        setBusy(false);
      }
    },
    [account?.convexUserId, account?.passwordHash, refresh],
  );

  /** Same-sensor discovery is a read-only query — no circle refresh, so the panel never blinks. */
  const findSensorAccounts = useCallback(async () => {
    if (!account?.convexUserId) return;
    setBusy(true);
    try {
      const client = createConvexAuthClient();
      const res = await client.query(api.careCircle.findSharedSensorAccounts, {
        userId: account.convexUserId as Id<"users">,
        passwordHash: account.passwordHash,
      });
      setSensorResult(res as typeof sensorResult);
      setSensorSearched(true);
    } catch (e) {
      Alert.alert("Care Circle", cleanConvexError(e));
    } finally {
      setBusy(false);
    }
  }, [account?.convexUserId, account?.passwordHash]);

  const shareCode = async (code: string, kind: "invite" | "access") => {
    // Always name the shared circle's patient (works whether I'm the owner or a co-guardian of it).
    const patientName = circle?.patientName ?? profile?.childName ?? "a Glucose Guardian user";
    const message =
      kind === "invite"
        ? `You're invited to join ${patientName}'s care circle as a co-guardian on Glucose Guardian. Download the app, sign in, and enter this invite code in Dashboard → Care Circle → Join: ${code}`
        : `You've been given caregiver access to ${patientName} on Glucose Guardian. Download the app and enter this caregiver code on the sign-in screen: ${code}`;
    try {
      await Share.share({ message });
    } catch {
      /* user dismissed the sheet */
    }
  };

  const isAdmin = circle?.isAdmin ?? false;
  const caregiverCodes = (circle?.accessCodes ?? []).filter((c) => c.kind !== "child");
  const childCodes = (circle?.accessCodes ?? []).filter((c) => c.kind === "child");

  // Roster of the shared circle with "You" pinned to the top.
  const guardians = [...(circle?.guardians ?? [])].sort((a, b) => (a.isMe === b.isMe ? 0 : a.isMe ? -1 : 1));
  const maxGuardians = circle?.maxGuardians ?? 4;
  // When I'm a co-guardian (not the owner), let me open the patient's live glucose in viewing mode.
  const membershipForCircle = memberships.find((m) => m.patientUserId === circle?.patientUserId);

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 30 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={[styles.headerIcon, { backgroundColor: COLORS.primary + "15" }]}>
          <Feather name="share-2" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Care Circle</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Link co-guardians and manage caregiver access.
          </Text>
        </View>
      </View>

      {!!error && (
        <View style={[styles.errorBox, { backgroundColor: COLORS.dangerLight }]}>
          <Feather name="alert-circle" size={14} color={COLORS.danger} />
          <Text style={[styles.errorText, { color: COLORS.danger }]}>{error}</Text>
          <Pressable onPress={() => refresh()}>
            <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── View the patient's live glucose (co-guardians only; the owner already sees it natively) ── */}
      {viewingOthersCircle && membershipForCircle?.accessState.state === "ok" && membershipForCircle.permissions.viewReadings && (
        <Pressable
          disabled={busy}
          style={({ pressed }) => [styles.viewCircleBtn, { borderColor: COLORS.primary, opacity: pressed ? 0.7 : 1 }]}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const ok = await enterViewingMode(circle!.patientUserId);
            if (ok) onClose?.();
            else Alert.alert("Care Circle", "Access to this patient's data isn't available right now.");
          }}
        >
          <Feather name="eye" size={15} color={COLORS.primary} />
          <Text style={[styles.viewCircleBtnText, { color: COLORS.primary }]}>View {circle!.patientName}'s glucose</Text>
        </Pressable>
      )}

      {circle && (
        <>
          {/* ── Child Access (kids have no account — they use a code on their own phone) ── */}
          {isAdmin && (
            <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Child Access</Text>
              <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                Your child views their own data on their phone with this code — no account needed. You
                control what they can do below.
              </Text>
              {childCodes.map((c) => (
                <View key={String(c.codeId)} style={[styles.memberRow, { borderColor: colors.border, flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{c.label}</Text>
                      <Text style={[styles.codeText, { color: COLORS.primary }]}>{c.code}</Text>
                    </View>
                    <AccessChip accessState={c.accessState} colors={colors} />
                  </View>
                  <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Your child may:</Text>
                  <PermissionToggles
                    value={c.permissions}
                    deviceOnly
                    colors={colors}
                    disabled={busy}
                    onChange={(next) =>
                      runAction(async (client, userId, passwordHash) => {
                        await client.mutation(api.careCircle.updateAccessCode, {
                          userId,
                          passwordHash,
                          codeId: c.codeId,
                          permissions: next,
                        });
                      })
                    }
                  />
                  {qrCodeId === c.codeId && <CodeQR value={c.code} />}
                  <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
                    <Pressable disabled={busy} onPress={() => shareCode(c.code, "access")}>
                      <Text style={[styles.actionLink, { color: COLORS.primary }]}>Share</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => setQrCodeId(qrCodeId === c.codeId ? null : c.codeId)}>
                      <Text style={[styles.actionLink, { color: COLORS.primary }]}>{qrCodeId === c.codeId ? "Hide QR" : "QR"}</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        Alert.alert("Remove child access?", "This code stops working immediately.", [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: () =>
                              runAction(async (client, userId, passwordHash) => {
                                await client.mutation(api.careCircle.retireAccessCode, { userId, passwordHash, codeId: c.codeId });
                              }),
                          },
                        ])
                      }
                    >
                      <Text style={[styles.dangerLink, { color: COLORS.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              <Pressable
                disabled={busy}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed || busy ? 0.8 : 1 }]}
                onPress={() =>
                  runAction(async (client, userId, passwordHash) => {
                    if (!targetPatientId) return;
                    const base = profile?.childName ? `${profile.childName}'s phone` : "My child's phone";
                    const label = childCodes.length > 0 ? `${base} ${childCodes.length + 1}` : base;
                    const result = await client.mutation(api.careCircle.createAccessCode, {
                      userId,
                      passwordHash,
                      patientUserId: targetPatientId,
                      label,
                      kind: "child",
                    });
                    setCreatedCode({ code: result.code, label });
                  })
                }
              >
                <Feather name="plus" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>{childCodes.length > 0 ? "Add another child device" : "Generate child code"}</Text>
              </Pressable>
            </View>
          )}

          {/* ── Co-guardians (shared roster: you + everyone else, identical on both accounts) ── */}
          <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Co-guardians ({guardians.length}/{maxGuardians})
            </Text>
            {guardians.map((g) => {
              // The owner has no link to sever; a member can Leave themselves; an admin can Remove others.
              const canRemove = g.linkId != null && (g.isMe || isAdmin);
              return (
                <View key={String(g.userId)} style={[styles.memberRow, { borderColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                      {g.isMe ? "You" : g.displayName}
                      {g.isOwner ? "  ·  owner" : ""}
                    </Text>
                    {!g.isOwner && <AccessChip accessState={g.accessState} colors={colors} />}
                  </View>
                  {canRemove && (
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          g.isMe ? "Leave this care circle?" : `Remove ${g.displayName}?`,
                          g.isMe
                            ? "You'll immediately lose access to this patient's data."
                            : "They immediately lose access to this patient's data.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: g.isMe ? "Leave" : "Remove",
                              style: "destructive",
                              onPress: () =>
                                runAction(async (client, userId, passwordHash) => {
                                  await client.mutation(api.careCircle.revokeLink, {
                                    userId,
                                    passwordHash,
                                    linkId: g.linkId!,
                                  });
                                }),
                            },
                          ],
                        )
                      }
                    >
                      <Text style={[styles.dangerLink, { color: COLORS.danger }]}>{g.isMe ? "Leave" : "Remove"}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

            {circle.pendingInvites.map((inv) => (
              <View key={String(inv.inviteId)} style={[styles.memberRow, { borderColor: COLORS.primary + "40" }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.codeText, { color: COLORS.primary }]}>{inv.code}</Text>
                  <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                    Invite · expires {fmtNextOpening(inv.expiresAt)}
                  </Text>
                </View>
                <Pressable disabled={busy} onPress={() => shareCode(inv.code, "invite")}>
                  <Feather name="share" size={16} color={COLORS.primary} />
                </Pressable>
                {isAdmin && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      runAction(async (client, userId, passwordHash) => {
                        await client.mutation(api.careCircle.cancelInvite, {
                          userId,
                          passwordHash,
                          inviteId: inv.inviteId,
                        });
                      })
                    }
                  >
                    <Feather name="x" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            ))}

            {isAdmin && guardians.length < maxGuardians && (
              <Pressable
                disabled={busy}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed || busy ? 0.8 : 1 }]}
                onPress={() =>
                  runAction(async (client, userId, passwordHash) => {
                    if (!targetPatientId) return;
                    const result = await client.mutation(api.careCircle.createInvite, {
                      userId,
                      passwordHash,
                      patientUserId: targetPatientId,
                    });
                    setCreatedInvite(result);
                  })
                }
              >
                <Feather name="user-plus" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Invite co-guardian</Text>
              </Pressable>
            )}

            {createdInvite && (
              <View style={[styles.resultBox, { backgroundColor: COLORS.primary + "10", borderColor: COLORS.primary + "40" }]}>
                <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Share this invite code — or let them scan it:</Text>
                <Text style={[styles.codeTextBig, { color: COLORS.primary }]}>{createdInvite.code}</Text>
                <CodeQR value={createdInvite.code} />
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => shareCode(createdInvite.code, "invite")}
                >
                  <Feather name="share" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Share</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* ── Caregiver access codes ── */}
          <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Caregiver codes</Text>
            <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
              {(profile?.accountRole === "adult"
                ? "For spouses, relatives, trusted friends — no account needed."
                : "For relatives, babysitters, teachers, nurses — no account needed.") +
                " They enter the code on the sign-in screen. Codes work until retired, only inside their schedule."}
            </Text>
            {caregiverCodes.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No caregiver codes yet.</Text>
            )}
            {caregiverCodes.map((c) => {
              const editing = editingCodeId === c.codeId;
              return (
                <View key={String(c.codeId)} style={[styles.memberRow, { borderColor: colors.border, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{c.label}</Text>
                      <Text style={[styles.codeText, { color: COLORS.primary }]}>{c.code}</Text>
                      <Text style={[styles.sectionSub, { color: colors.textMuted }]}>{describeAccess(c.access)}</Text>
                    </View>
                    <AccessChip accessState={c.accessState} colors={colors} />
                  </View>
                  {qrCodeId === c.codeId && <CodeQR value={c.code} />}
                  {isAdmin && (
                    <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
                      <Pressable disabled={busy} onPress={() => shareCode(c.code, "access")}>
                        <Text style={[styles.actionLink, { color: COLORS.primary }]}>Share</Text>
                      </Pressable>
                      <Pressable disabled={busy} onPress={() => setQrCodeId(qrCodeId === c.codeId ? null : c.codeId)}>
                        <Text style={[styles.actionLink, { color: COLORS.primary }]}>{qrCodeId === c.codeId ? "Hide QR" : "QR"}</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          if (editing) {
                            setEditingCodeId(null);
                          } else {
                            setEditingCodeId(c.codeId);
                            setEditPermissions({ ...c.permissions });
                            setEditAccess(c.access);
                          }
                        }}
                      >
                        <Text style={[styles.actionLink, { color: COLORS.primary }]}>{editing ? "Close" : "Edit"}</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          Alert.alert(`Retire "${c.label}"?`, "This code stops working immediately and cannot be reactivated.", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Retire",
                              style: "destructive",
                              onPress: () =>
                                runAction(async (client, userId, passwordHash) => {
                                  await client.mutation(api.careCircle.retireAccessCode, {
                                    userId,
                                    passwordHash,
                                    codeId: c.codeId,
                                  });
                                }),
                            },
                          ])
                        }
                      >
                        <Text style={[styles.dangerLink, { color: COLORS.danger }]}>Retire</Text>
                      </Pressable>
                    </View>
                  )}
                  {editing && (
                    <View style={{ gap: 10 }}>
                      <PermissionToggles value={editPermissions} onChange={setEditPermissions} colors={colors} disabled={busy} />
                      <ScheduleEditor value={editAccess} onChange={setEditAccess} colors={colors} />
                      <Pressable
                        disabled={busy}
                        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed || busy ? 0.8 : 1 }]}
                        onPress={() =>
                          runAction(async (client, userId, passwordHash) => {
                            await client.mutation(api.careCircle.updateAccessCode, {
                              userId,
                              passwordHash,
                              codeId: c.codeId,
                              permissions: editPermissions,
                              access: editAccess,
                            });
                            setEditingCodeId(null);
                          })
                        }
                      >
                        <Feather name="check" size={14} color="#fff" />
                        <Text style={styles.primaryBtnText}>Save changes</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}

            {isAdmin && !showCreateCode && (
              <Pressable
                disabled={busy}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed || busy ? 0.8 : 1 }]}
                onPress={() => {
                  setShowCreateCode(true);
                  setCreatedCode(null);
                }}
              >
                <Feather name="plus" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Add caregiver code</Text>
              </Pressable>
            )}

            {isAdmin && showCreateCode && (
              <View style={{ gap: 10, marginTop: 4 }}>
                <TextInput
                  value={newCodeLabel}
                  onChangeText={setNewCodeLabel}
                  placeholder={'Who is this for? e.g. "Ms. Rivera (teacher)"'}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.labelInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
                />
                <PermissionToggles value={newCodePermissions} onChange={setNewCodePermissions} colors={colors} disabled={busy} />
                <ScheduleEditor value={newCodeAccess} onChange={setNewCodeAccess} colors={colors} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => setShowCreateCode(false)}
                  >
                    <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={busy || !newCodeLabel.trim()}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { flex: 1, backgroundColor: newCodeLabel.trim() ? COLORS.primary : colors.backgroundTertiary, opacity: pressed || busy ? 0.8 : 1 },
                    ]}
                    onPress={() =>
                      runAction(async (client, userId, passwordHash) => {
                        if (!targetPatientId) return;
                        const result = await client.mutation(api.careCircle.createAccessCode, {
                          userId,
                          passwordHash,
                          patientUserId: targetPatientId,
                          label: newCodeLabel.trim(),
                          permissions: newCodePermissions,
                          access: newCodeAccess,
                        });
                        setCreatedCode({ code: result.code, label: newCodeLabel.trim() });
                        setShowCreateCode(false);
                        setNewCodeLabel("");
                        setNewCodePermissions({ ...VIEWER_PERMISSIONS });
                        setNewCodeAccess({ mode: "always" });
                      })
                    }
                  >
                    <Feather name="check" size={14} color={newCodeLabel.trim() ? "#fff" : colors.textMuted} />
                    <Text style={[styles.primaryBtnText, { color: newCodeLabel.trim() ? "#fff" : colors.textMuted }]}>Create code</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {createdCode && (
              <View style={[styles.resultBox, { backgroundColor: COLORS.primary + "10", borderColor: COLORS.primary + "40" }]}>
                <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
                  Code for {createdCode.label} — share it or let them scan:
                </Text>
                <Text style={[styles.codeTextBig, { color: COLORS.primary }]}>{createdCode.code}</Text>
                <CodeQR value={createdCode.code} />
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => shareCode(createdCode.code, "access")}
                >
                  <Feather name="share" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>Share</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* ── Shared-sensor discovery (manual) ── */}
          {isAdmin && !viewingOthersCircle && (
            <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Sharing a sensor?</Text>
              <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                If another account uses your Dexcom login (e.g. a parent and child), find it here and
                invite them as a co-guardian.
              </Text>
              <Pressable
                disabled={busy}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed || busy ? 0.8 : 1 }]}
                onPress={findSensorAccounts}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.primary} size="small" />
                ) : (
                  <Text style={[styles.secondaryBtnText, { color: COLORS.primary }]}>Find accounts on my sensor</Text>
                )}
              </Pressable>
              {sensorSearched && sensorResult && sensorResult.matches.length === 0 && (
                <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                  {sensorResult.hasCredentials
                    ? "No other accounts found on this sensor. If you expect one, have them reconnect their Dexcom first."
                    : "Connect your Dexcom to your account first, then check again."}
                </Text>
              )}
              {sensorResult?.matches.map((m) => (
                <View key={m.userId} style={[styles.memberRow, { borderColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{m.name}</Text>
                    <Text style={[styles.sectionSub, { color: colors.textMuted }]}>{m.email}</Text>
                  </View>
                  {m.alreadyLinked ? (
                    <View style={[styles.chip, { backgroundColor: COLORS.success + "1E" }]}>
                      <Text style={[styles.chipText, { color: COLORS.success }]}>Linked</Text>
                    </View>
                  ) : (
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        runAction(async (client, userId, passwordHash) => {
                          if (!targetPatientId) return;
                          await client.mutation(api.careCircle.createInvite, {
                            userId,
                            passwordHash,
                            patientUserId: targetPatientId,
                            targetUserId: m.userId,
                          });
                          Alert.alert(
                            "Invitation sent",
                            `${m.name} will see your co-guardian request in their Care Circle. It also appears there for them to accept.`,
                          );
                        })
                      }
                    >
                      <Text style={[styles.actionLink, { color: COLORS.primary }]}>Invite</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* ── Invitations addressed to me (directed-invite inbox) ── */}
      {incoming.length > 0 && (
        <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Invitations for you</Text>
          <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
            You've been invited to help care for someone. Accept to become a co-guardian.
          </Text>
          {incoming.map((inv) => (
            <View key={String(inv.inviteId)} style={[styles.memberRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                  {inv.patientName}
                </Text>
                <Text style={[styles.sectionSub, { color: colors.textMuted }]} numberOfLines={1}>
                  Invited by {inv.invitedByName}
                </Text>
              </View>
              <Pressable
                disabled={busy}
                style={({ pressed }) => [
                  styles.viewBtn,
                  { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "12", opacity: pressed || busy ? 0.7 : 1 },
                ]}
                onPress={() =>
                  runAction(async (client, userId, passwordHash) => {
                    const result = await client.mutation(api.careCircle.redeemInvite, {
                      userId,
                      passwordHash,
                      code: inv.code,
                    });
                    Alert.alert("Care Circle", `You're now a co-guardian for ${result.patientName}.`);
                  })
                }
              >
                <Feather name="check" size={13} color={COLORS.primary} />
                <Text style={[styles.actionLink, { color: COLORS.primary }]}>Accept</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* ── Join a circle with an invite code (co-guardians share one merged circle above) ── */}
      <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Have an invite code?</Text>
        <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
          Enter a co-guardian invite code to join and share that circle.
        </Text>
          <View style={styles.joinRow}>
            <TextInput
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="Invite code"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              style={[styles.joinInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
            />
            <Pressable
              disabled={busy || joinCode.length !== 8}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: joinCode.length === 8 ? COLORS.primary : colors.backgroundTertiary, opacity: pressed || busy ? 0.8 : 1 },
              ]}
              onPress={() =>
                runAction(async (client, userId, passwordHash) => {
                  const result = await client.mutation(api.careCircle.redeemInvite, {
                    userId,
                    passwordHash,
                    code: joinCode,
                  });
                  setJoinCode("");
                  Alert.alert("Care Circle", `You're now a co-guardian for ${result.patientName}.`);
                })
              }
            >
              <Text style={[styles.primaryBtnText, { color: joinCode.length === 8 ? "#fff" : colors.textMuted }]}>Join</Text>
            </Pressable>
          </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 12, fontWeight: "400", marginTop: 2 },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errorText: { flex: 1, fontSize: 12, fontWeight: "500" },

  infoBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  infoBannerText: { flex: 1, fontSize: 12, fontWeight: "500" },

  sectionBox: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "700" },
  sectionSub: { fontSize: 11, fontWeight: "400", lineHeight: 16 },
  emptyText: { fontSize: 12, fontWeight: "400", fontStyle: "italic" },

  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  memberName: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  chip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 10, fontWeight: "700" },

  qrTile: { alignSelf: "center", backgroundColor: "#FFFFFF", padding: 12, borderRadius: 12 },
  codeText: { fontSize: 14, fontWeight: "800", letterSpacing: 2 },
  codeTextBig: { fontSize: 22, fontWeight: "800", letterSpacing: 4, textAlign: "center" },
  resultBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },

  actionLink: { fontSize: 12, fontWeight: "700" },
  dangerLink: { fontSize: 12, fontWeight: "700" },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  viewCircleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  viewCircleBtnText: { fontSize: 14, fontWeight: "700" },

  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  secondaryBtnText: { fontSize: 13, fontWeight: "600" },

  permRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  permLabel: { fontSize: 13, fontWeight: "500", flex: 1 },

  modeChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  modeChipText: { fontSize: 12, fontWeight: "600" },
  hourChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  dayChip: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeInput: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontWeight: "600", textAlign: "center" },
  editorHint: { fontSize: 11, fontWeight: "400" },

  labelInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  joinRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  joinInput: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, fontWeight: "700", letterSpacing: 2, textAlign: "center" },
});
