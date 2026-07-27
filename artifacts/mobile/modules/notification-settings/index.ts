// Imported from "expo" (which re-exports expo-modules-core) because pnpm's strict linking doesn't
// expose expo-modules-core as a direct dependency of this package.
import { requireOptionalNativeModule } from "expo";

/**
 * Fires when the user taps "Notification Settings" under iOS Settings → Notifications → the app.
 * See `ios/NotificationSettingsModule.swift` for why this needs a native module at all.
 *
 * Loaded OPTIONALLY on purpose: the module is iOS-only and absent in Expo Go, on Android, on web, and
 * in any build made before it existed. `requireOptionalNativeModule` returns null instead of throwing,
 * so every caller degrades to "the link just opens the app" rather than crashing.
 */
const NativeNotificationSettings = requireOptionalNativeModule<{
  addListener: (event: string, listener: () => void) => { remove: () => void };
}>("NotificationSettings");

export const OPEN_APP_NOTIFICATION_SETTINGS_EVENT = "onOpenAppNotificationSettings";

/** True when this build can deep-link the iOS settings tap (iOS + module compiled in). */
export const canDeepLinkNotificationSettings = NativeNotificationSettings != null;

/**
 * Subscribe to the tap. Returns an unsubscribe function that is always safe to call, even when the
 * native module isn't present.
 */
export function addNotificationSettingsListener(listener: () => void): () => void {
  if (!NativeNotificationSettings) return () => {};
  try {
    const sub = NativeNotificationSettings.addListener(OPEN_APP_NOTIFICATION_SETTINGS_EVENT, listener);
    return () => {
      try {
        sub.remove();
      } catch {
        /* already torn down */
      }
    };
  } catch {
    return () => {};
  }
}
