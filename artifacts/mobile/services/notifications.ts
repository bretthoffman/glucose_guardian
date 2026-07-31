import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerNotificationCategories() {
  if (isWeb) return;
  await Notifications.setNotificationCategoryAsync("GLUCOSE_ALERT", [
    {
      identifier: "REPLY",
      buttonTitle: "Reply",
      textInput: {
        submitButtonTitle: "Send",
        placeholder: "Type a message to the chat...",
      },
    },
    {
      identifier: "DISMISS",
      buttonTitle: "Dismiss",
    },
  ]);
}

export interface NotificationPermissionStatus {
  granted: boolean;
  soundEnabled: boolean;
  criticalAlertsEnabled: boolean;
  canAskAgain: boolean;
  /** iOS is showing the "Notification Settings" link into our own in-app alert preferences. */
  appSettingsLinkEnabled: boolean;
}

/**
 * The iOS options we ask for. Requested as ONE full set at first prompt because iOS only shows the
 * system dialog once — anything omitted here can't be granted later without the user going to
 * Settings. This is a build-time-critical decision (see PREBUILD_PLAN_01 §2.1).
 *
 * - `provideAppNotificationSettings` adds a "Notification Settings" row under
 *   iOS Settings → Notifications → Glucose Guardian that deep-links into OUR alert preferences screen.
 * - `allowCriticalAlerts` only takes effect once Apple grants the critical-alerts entitlement
 *   (applied for 2026-07-23); until then iOS ignores it and the rest still work.
 */
const IOS_PERMISSION_OPTIONS = {
  allowAlert: true,
  allowSound: true,
  allowBadge: true,
  allowCriticalAlerts: true,
  provideAppNotificationSettings: true,
} as const;

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (isWeb) {
    return {
      granted: false,
      soundEnabled: false,
      criticalAlertsEnabled: false,
      canAskAgain: false,
      appSettingsLinkEnabled: false,
    };
  }
  const perms = await Notifications.getPermissionsAsync();
  const granted = perms.status === "granted";
  const soundEnabled = granted && (perms.ios?.allowsSound !== false);
  const criticalAlertsEnabled = granted && (perms.ios?.allowsCriticalAlerts === true);
  const canAskAgain = perms.canAskAgain;
  const appSettingsLinkEnabled = granted && perms.ios?.providesAppNotificationSettings === true;
  return { granted, soundEnabled, criticalAlertsEnabled, canAskAgain, appSettingsLinkEnabled };
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (isWeb) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync({ ios: { ...IOS_PERMISSION_OPTIONS } });
  return status === "granted";
}

/**
 * This device's Expo push token — the address the BACKEND sends alerts to, which is what makes them
 * arrive with the app closed. Returns null on web, in a simulator, or when permission isn't granted.
 * Needs the EAS projectId, which the push service uses to route to the right app credentials.
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (isWeb) return null;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data ?? null;
  } catch {
    // No credentials (Expo Go / simulator) or offline — the app still works, just without push.
    return null;
  }
}

/**
 * Android needs channels declared before a notification can use them; the ids must match what the
 * server sets in the push payload (`buildExpoMessage` in convex/pushLogic.ts). No-op on iOS.
 */
export async function registerAndroidChannels() {
  if (isWeb || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Alerts",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });
  await Notifications.setNotificationChannelAsync("glucose-urgent", {
    name: "Urgent glucose",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    bypassDnd: true,
  });
}

export async function requestCriticalAlerts(): Promise<boolean> {
  if (isWeb) return false;
  const { status, ios } = await Notifications.requestPermissionsAsync({ ios: { ...IOS_PERMISSION_OPTIONS } });
  if (status !== "granted") return false;
  return ios?.allowsCriticalAlerts === true;
}

export type GlucoseAlertStatus =
  | "critically_low"
  | "low"
  | "high"
  | "critically_high";

export async function scheduleGlucoseAlert(params: {
  childName: string;
  glucose: number;
  status: GlucoseAlertStatus;
  trendLabel: string;
}) {
  if (isWeb) return;
  const { childName, glucose, status, trendLabel } = params;
  const isHigh = status === "high" || status === "critically_high";
  const isCritical = status === "critically_low" || status === "critically_high";

  const title = isCritical
    ? `🚨 ${childName}'s glucose is ${isHigh ? "Critically High" : "Critically Low"}`
    : `⚠️ ${childName}'s glucose is ${isHigh ? "High" : "Low"}`;

  const trendNote =
    trendLabel !== "Stable" ? ` and ${trendLabel.toLowerCase()}` : "";
  const body = isHigh
    ? `${glucose} mg/dL${trendNote} — tap Reply to send instructions.`
    : `${glucose} mg/dL${trendNote} — needs attention now. Tap Reply to respond.`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      categoryIdentifier: "GLUCOSE_ALERT",
      data: { glucose, status, childName },
      sound: true,
    },
    trigger: null,
  });
}

/** Local trend alert (rising/falling fast) — fired per new fast-trending reading while app is open. */
export async function scheduleTrendAlert(params: {
  childName: string;
  glucose: number;
  direction: "rise" | "fall";
}) {
  if (isWeb) return;
  const { childName, glucose, direction } = params;
  const title =
    direction === "rise" ? `📈 ${childName}'s glucose is rising fast` : `📉 ${childName}'s glucose is falling fast`;
  const body =
    direction === "rise"
      ? `${glucose} mg/dL and climbing quickly — keep an eye on it.`
      : `${glucose} mg/dL and dropping quickly — check in soon.`;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: "glucose_trend", glucose, direction }, sound: true },
    trigger: null,
  });
}

export async function scheduleDoctorMessageNotification(params: {
  doctorName?: string;
  count: number;
  preview: string;
}) {
  if (isWeb) return;
  const { doctorName, count, preview } = params;
  const from = doctorName?.trim() ? doctorName.trim() : "your care team";
  const title = count > 1 ? `${count} new messages from ${from}` : `New message from ${from}`;
  const body = preview.trim().length > 0 ? preview.trim() : "Tap to read in Glucose Guardian.";
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: "doctor_message" }, sound: true },
    trigger: null,
  });
}

export async function scheduleTreatmentProposalNotification(params: {
  doctorName?: string;
  summary: string;
}) {
  if (isWeb) return;
  const from = params.doctorName?.trim() ? params.doctorName.trim() : "Your care team";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${from} proposed a treatment change`,
      body: `${params.summary} — review and approve in the app.`,
      data: { kind: "treatment_proposal" },
      sound: true,
    },
    trigger: null,
  });
}

function buildNotificationPrompt(
  data: Record<string, unknown>,
  actionIdentifier: string,
  userText?: string
): string {
  // REPLY action: user typed their own message — prepend notification context
  if (actionIdentifier === "REPLY" && userText?.trim()) {
    return userText.trim();
  }

  // Default tap: build a contextual prompt from the notification data
  const glucose = typeof data?.glucose === "number" ? data.glucose : null;
  const status = typeof data?.status === "string" ? data.status : null;
  const childName = typeof data?.childName === "string" ? data.childName : null;
  const nameStr = childName ? `${childName}'s` : "my";

  if (!glucose || !status) {
    return "I just got a glucose alert. What should I do?";
  }

  switch (status) {
    case "critically_high":
      return `${nameStr} glucose is critically high at ${glucose} mg/dL. This is urgent — what should I do right now?`;
    case "high":
      return `${nameStr} glucose is ${glucose} mg/dL which is high. What's the best way to bring it back into range?`;
    case "critically_low":
      return `${nameStr} glucose just hit ${glucose} mg/dL which is critically low. This needs immediate attention — what do I do?`;
    case "low":
      return `${nameStr} glucose is ${glucose} mg/dL and it's low. What should I eat or do to bring it back up safely?`;
    default:
      return `${nameStr} glucose alert just fired at ${glucose} mg/dL. Can you help me figure out what to do?`;
  }
}

export function handleNotificationResponse(
  response: Notifications.NotificationResponse
) {
  const { actionIdentifier, userText } = response;

  // DISMISS: do nothing
  if (actionIdentifier === "DISMISS") return;

  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const kind = typeof data.kind === "string" ? data.kind : null;

  // Doctor-comms notifications open the relevant screen rather than the AI chat.
  if (kind === "doctor_message") {
    router.push("/(tabs)/chat");
    return;
  }
  if (kind === "treatment_proposal") {
    router.push("/(tabs)/dashboard");
    return;
  }
  // Messages open the Chat page (thread list); care-log activity opens the Glucose page.
  if (kind === "care_message") {
    router.push("/(tabs)/chat");
    return;
  }
  if (kind === "care_log") {
    router.push("/(tabs)");
    return;
  }

  if (
    actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ||
    actionIdentifier === "REPLY"
  ) {
    // Glucose alerts NEVER auto-send to the chat anymore: land on the Glucose page carrying the
    // alert text + a ready-made prompt. The page shows a Dismiss / Send-to-chat popup (gated by
    // the "Send Alerts to Chat on open" toggle, and superseded by a pending wait-window confirm).
    const prompt = buildNotificationPrompt(data, actionIdentifier, userText);
    const body =
      response.notification.request.content.body ??
      response.notification.request.content.title ??
      "Glucose alert";
    router.push({
      pathname: "/(tabs)",
      params: { alertMsg: body, alertPrompt: prompt, alertTs: String(Date.now()) },
    });
  }
}
