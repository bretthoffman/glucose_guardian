import * as Notifications from "expo-notifications";
import { router } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerNotificationCategories() {
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
  const perms = await Notifications.getPermissionsAsync();
  const granted = perms.status === "granted";
  const soundEnabled = granted && (perms.ios?.allowsSound !== false);
  const criticalAlertsEnabled = granted && (perms.ios?.allowsCriticalAlerts === true);
  const canAskAgain = perms.canAskAgain;
  return { granted, soundEnabled, criticalAlertsEnabled, canAskAgain };
}

export async function requestNotificationPermissions(): Promise<boolean> {
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

export function handleNotificationResponse(
  response: Notifications.NotificationResponse
) {
  const { actionIdentifier, userText } = response;

  if (
    actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ||
    actionIdentifier === "REPLY"
  ) {
    const params: Record<string, string> = { fromNotification: "true" };
    if (actionIdentifier === "REPLY" && userText?.trim()) {
      params.prompt = userText.trim();
      params.fromParent = "true";
    }
    router.push({ pathname: "/(tabs)/chat", params });
  }
}
