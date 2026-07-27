/**
 * The adult wait-window confirm popup. While an urgent reading holds the caregiver (access-code)
 * emergency alert, the owner's app — opened from the push or normally — shows a native prompt:
 * "Alert them now" releases the caregiver alert immediately; "I am OK" cancels it. If neither is
 * chosen, the server timer fires the alert on its own when the window elapses; the <35 / >350
 * failsafe bypasses all of this server-side. Renders nothing — it only watches and prompts.
 */
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useQuery } from "convex/react";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { useAuth } from "@/context/AuthContext";

export default function EmergencyWaitPrompt() {
  const { account, caregiverSession, viewingPatientId, profile } = useAuth();
  // Waits exist only for ADULT main accounts; never prompt borrowed views or code sessions.
  const active =
    !!account?.convexUserId && !caregiverSession && !viewingPatientId && profile?.accountRole === "adult";
  const pending = useQuery(api.push.pendingEmergencyWait, active ? {} : "skip");
  const shownForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    const id = String(pending.waitId);
    if (shownForRef.current === id) return;
    shownForRef.current = id;
    const resolve = (decision: "ok" | "alertNow") => {
      createConvexAuthClient()
        .mutation(api.push.resolveEmergencyWait, { waitId: pending.waitId, decision })
        .catch(() => {});
    };
    Alert.alert(
      "Confirm you are okay",
      "Confirm you are okay to cancel the caregiver emergency alert.",
      [
        { text: "Alert them now", style: "destructive", onPress: () => resolve("alertNow") },
        { text: "I am OK", onPress: () => resolve("ok") },
      ],
      { cancelable: false },
    );
  }, [pending]);

  return null;
}
