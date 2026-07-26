import { useCallback } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { logConfirmMessage } from "@/utils/careLogConfirm";

/**
 * Guards a log-committing action for caregiver sessions.
 *
 * A caregiver — either an accountless caregiver access-code session or a Caregiver (nurse) account
 * viewing a linked kid — is writing into someone else's medical record, so every commit gets a
 * name-checked confirmation first ("Yes" proceeds, "No" cancels and changes nothing). For every
 * other session (the guardian's own account, co-guardians, kid/child codes) the action runs
 * immediately, exactly as before.
 *
 * Wrap the WHOLE commit handler, not just the log call, so nothing downstream of it (state flips,
 * closing a modal, success haptics) happens unless the caregiver confirms:
 *
 *   const confirmLog = useCareLogConfirm();
 *   <Pressable onPress={() => confirmLog(handleTookDose)} />
 */
export function useCareLogConfirm(): (commit: () => void) => void {
  const { logConfirmPatientName } = useAuth();
  return useCallback(
    (commit: () => void) => {
      if (!logConfirmPatientName) {
        commit();
        return;
      }
      Alert.alert("Confirm log", logConfirmMessage(logConfirmPatientName), [
        { text: "No", style: "cancel" },
        { text: "Yes", onPress: commit },
      ]);
    },
    [logConfirmPatientName],
  );
}
