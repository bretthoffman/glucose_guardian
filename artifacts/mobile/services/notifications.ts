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
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (isWeb) {
    return {
      granted: false,
      soundEnabled: false,
      criticalAlertsEnabled: false,
      canAskAgain: false,
    };
  }
  const perms = await Notifications.getPermissionsAsync();
  const granted = perms.status === "granted";
  const soundEnabled = granted && (perms.ios?.allowsSound !== false);
  const criticalAlertsEnabled = granted && (perms.ios?.allowsCriticalAlerts === true);
  const canAskAgain = perms.canAskAgain;
  return { granted, soundEnabled, criticalAlertsEnabled, canAskAgain };
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (isWeb) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: true,
      allowCriticalAlerts: true,
    },
  });
  return status === "granted";
}

export async function requestCriticalAlerts(): Promise<boolean> {
  if (isWeb) return false;
  const { status, ios } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: true,
      allowCriticalAlerts: true,
    },
  });
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

  if (
    actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ||
    actionIdentifier === "REPLY"
  ) {
    const prompt = buildNotificationPrompt(data, actionIdentifier, userText);
    const params: Record<string, string> = {
      fromNotification: "true",
      prompt,
      fromParent: "true",
    };
    router.push({ pathname: "/(tabs)/chat", params });
  }
}
