import Constants from "expo-constants";
import * as Updates from "expo-updates";

/**
 * "1.0.0+a1b2c3d4" — the native app version plus the running OTA bundle (or "embedded" when the
 * binary's built-in bundle is running). Sent with audited writes so a server-side record can say
 * which build made a change.
 */
export function appVersionTag(): string {
  const native = Constants.expoConfig?.version ?? "?";
  const bundle = Updates.updateId ? Updates.updateId.slice(0, 8) : "embedded";
  return `${native}+${bundle}`;
}
