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
  permissions: CarePermissions;
  access: CareAccess;
  accessState: AccessState;
  lastUsedAt?: number;
  createdAt: number;
}

interface CircleData {
  isAdmin: boolean;
  settings: { dependentMode: boolean; devicePermissions: CarePermissions };
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

  const [managingPatientId, setManagingPatientId] = useState<Id<"users"> | null>(null);
  const [circle, setCircle] = useState<CircleData | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
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
    { hasCredentials: boolean; matches: { userId: string; maskedEmail: string; name: string; alreadyLinked: boolean }[] } | null
  >(null);
  const [sensorSearched, setSensorSearched] = useState(false);
  const [editPermissions, setEditPermissions] = useState<CarePermissions>({ ...VIEWER_PERMISSIONS });
  const [editAccess, setEditAccess] = useState<CareAccess>({ mode: "always" });
  const [joinCode, setJoinCode] = useState("");

  const myUserId = (account?.convexUserId ?? null) as Id<"users"> | null;
  const targetPatientId = managingPatientId ?? myUserId;
  const managingOther = managingPatientId != null && managingPatientId !== myUserId;

  const refresh = useCallback(async () => {
    if (!account?.convexUserId || !targetPatientId) {
      setLoading(false);
      setError("Sign in with a Glucose Guardian account to use the Care Circle.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const client = createConvexAuthClient();
      const userId = account.convexUserId as Id<"users">;
      const [c, m] = await Promise.all([
        client.query(api.careCircle.getCircle, {
          userId,
          passwordHash: account.passwordHash,
          patientUserId: targetPatientId,
        }),
        client.query(api.careCircle.myMemberships, { userId, passwordHash: account.passwordHash }),
      ]);
      setCircle(c as CircleData | null);
      setMemberships(m as MembershipRow[]);
    } catch {
      setError("Could not load the care circle. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [account?.convexUserId, account?.passwordHash, targetPatientId]);

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
        await refresh();
      } catch (e) {
        Alert.alert("Care Circle", cleanConvexError(e));
      } finally {
        setBusy(false);
      }
    },
    [account?.convexUserId, account?.passwordHash, refresh],
  );

  const shareCode = async (code: string, kind: "invite" | "access") => {
    const patientName = managingOther
      ? memberships.find((m) => m.patientUserId === managingPatientId)?.patientName ?? "a patient"
      : profile?.childName ?? "a Glucose Guardian user";
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

  const adminCirclesIManages = memberships.filter((m) => m.dependentMode);
  const isAdmin = circle?.isAdmin ?? false;
  const dependentMode = circle?.settings.dependentMode ?? false;
  const viewingAsManagedKid = !managingOther && dependentMode && !isAdmin;

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
          <Pressable onPress={refresh}>
            <Text style={{ color: COLORS.danger, fontWeight: "700", fontSize: 12 }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── Circle selector (only when I administer someone else's circle) ── */}
      {adminCirclesIManages.length > 0 && (
        <View style={styles.modeChipsRow}>
          {[{ id: null as Id<"users"> | null, name: "My circle" }, ...adminCirclesIManages.map((m) => ({ id: m.patientUserId as Id<"users"> | null, name: `${m.patientName}'s` }))].map(
            (opt) => {
              const active = (managingPatientId ?? null) === opt.id;
              return (
                <Pressable
                  key={String(opt.id ?? "mine")}
                  style={[
                    styles.modeChip,
                    { backgroundColor: active ? COLORS.primary : colors.backgroundTertiary, borderColor: active ? COLORS.primary : colors.border },
                  ]}
                  onPress={() => setManagingPatientId(opt.id)}
                >
                  <Text style={[styles.modeChipText, { color: active ? "#fff" : colors.textSecondary }]}>{opt.name}</Text>
                </Pressable>
              );
            },
          )}
        </View>
      )}

      {circle && (
        <>
          {viewingAsManagedKid && (
            <View style={[styles.infoBanner, { backgroundColor: COLORS.primary + "12", borderColor: COLORS.primary + "40" }]}>
              <Feather name="shield" size={14} color={COLORS.primary} />
              <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
                This care circle is managed by your guardians.
              </Text>
            </View>
          )}

          {/* ── Parent-kid mode ── */}
          {(isAdmin || !viewingAsManagedKid) && (
            <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
              <View style={styles.permRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Parent-kid mode</Text>
                  <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                    Co-guardians manage this account; the patient's device gets limited controls.
                  </Text>
                </View>
                <Switch
                  value={dependentMode}
                  disabled={busy || (!isAdmin && dependentMode)}
                  trackColor={{ true: COLORS.primary }}
                  onValueChange={(on) => {
                    if (!targetPatientId) return;
                    Alert.alert(
                      on ? "Enable parent-kid mode?" : "Turn off parent-kid mode?",
                      on
                        ? "Co-guardians take over managing this care circle, and this becomes the kid's monitored account."
                        : "The patient account takes back control of its own care circle.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: on ? "Enable" : "Turn off",
                          onPress: () =>
                            runAction(async (client, userId, passwordHash) => {
                              await client.mutation(api.careCircle.setDependentMode, {
                                userId,
                                passwordHash,
                                patientUserId: targetPatientId,
                                enabled: on,
                              });
                            }),
                        },
                      ],
                    );
                  }}
                />
              </View>
              {dependentMode && isAdmin && (
                <View style={{ marginTop: 8, gap: 6 }}>
                  <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Patient's device may:</Text>
                  <PermissionToggles
                    value={circle.settings.devicePermissions}
                    deviceOnly
                    colors={colors}
                    disabled={busy}
                    onChange={(next) => {
                      if (!targetPatientId) return;
                      runAction(async (client, userId, passwordHash) => {
                        await client.mutation(api.careCircle.setDependentMode, {
                          userId,
                          passwordHash,
                          patientUserId: targetPatientId,
                          enabled: true,
                          devicePermissions: next,
                        });
                      });
                    }}
                  />
                </View>
              )}
            </View>
          )}

          {/* ── Co-guardians ── */}
          <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Co-guardians ({circle.coGuardians.length}/3)
            </Text>
            {circle.coGuardians.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No co-guardians linked yet.
              </Text>
            )}
            {circle.coGuardians.map((g) => (
              <View key={String(g.linkId)} style={[styles.memberRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                    {g.displayName}
                    {g.isMe ? "  (you)" : ""}
                  </Text>
                  <AccessChip accessState={g.accessState} colors={colors} />
                </View>
                {(isAdmin || g.isMe) && (
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
                                  linkId: g.linkId,
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
            ))}

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

            {isAdmin && circle.coGuardians.length < 3 && (
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
              For teachers, babysitters, nurses, and relatives — no account needed. They enter the
              code on the sign-in screen. Codes work until retired, only inside their schedule.
            </Text>
            {circle.accessCodes.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No access codes yet.</Text>
            )}
            {circle.accessCodes.map((c) => {
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

          {/* ── Shared-sensor discovery (manual; own circle only) ── */}
          {isAdmin && !managingOther && (
            <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Sharing a sensor?</Text>
              <Text style={[styles.sectionSub, { color: colors.textMuted }]}>
                If another account uses your Dexcom login (e.g. a parent and child), find it here and
                invite them as a co-guardian.
              </Text>
              <Pressable
                disabled={busy}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed || busy ? 0.8 : 1 }]}
                onPress={() =>
                  runAction(async (client, userId, passwordHash) => {
                    const res = await client.query(api.careCircle.findSharedSensorAccounts, { userId, passwordHash });
                    setSensorResult(res as typeof sensorResult);
                    setSensorSearched(true);
                  })
                }
              >
                <Text style={[styles.secondaryBtnText, { color: COLORS.primary }]}>Find accounts on my sensor</Text>
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
                    <Text style={[styles.sectionSub, { color: colors.textMuted }]}>{m.maskedEmail}</Text>
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
                          const result = await client.mutation(api.careCircle.createInvite, {
                            userId,
                            passwordHash,
                            patientUserId: targetPatientId,
                          });
                          setCreatedInvite(result);
                          Alert.alert("Care Circle", "Invite created. Share the code with them to link as a co-guardian.");
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

      {/* ── Circles I'm in + join ── */}
      {!managingOther && (
        <View style={[styles.sectionBox, { borderTopColor: colors.separator }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Circles I'm in</Text>
          {memberships.length === 0 && (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              You're not in anyone's care circle yet.
            </Text>
          )}
          {memberships.map((m) => (
            <View key={String(m.linkId)} style={[styles.memberRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                  {m.patientName} · co-guardian
                </Text>
                <AccessChip accessState={m.accessState} colors={colors} />
              </View>
              {m.accessState.state === "ok" && m.permissions.viewReadings && (
                <Pressable
                  disabled={busy}
                  style={({ pressed }) => [styles.viewBtn, { borderColor: COLORS.primary, opacity: pressed ? 0.7 : 1 }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const ok = await enterViewingMode(m.patientUserId);
                    if (ok) onClose?.();
                    else Alert.alert("Care Circle", "Access to this patient's data isn't available right now.");
                  }}
                >
                  <Feather name="eye" size={13} color={COLORS.primary} />
                  <Text style={[styles.actionLink, { color: COLORS.primary }]}>View</Text>
                </Pressable>
              )}
              <Pressable
                disabled={busy}
                onPress={() =>
                  Alert.alert(`Leave ${m.patientName}'s circle?`, "You'll immediately lose access to their data.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Leave",
                      style: "destructive",
                      onPress: () =>
                        runAction(async (client, userId, passwordHash) => {
                          await client.mutation(api.careCircle.revokeLink, {
                            userId,
                            passwordHash,
                            linkId: m.linkId,
                          });
                          setManagingPatientId(null);
                        }),
                    },
                  ])
                }
              >
                <Text style={[styles.dangerLink, { color: COLORS.danger }]}>Leave</Text>
              </Pressable>
            </View>
          ))}

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
      )}
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
