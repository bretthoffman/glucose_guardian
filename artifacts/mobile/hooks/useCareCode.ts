/**
 * Who is looking, for the Care Plan and the Day Recap:
 * - a caregiver code (the school nurse, grandma; an access-code session or a nurse account viewing a
 *   child through its code) → that code
 * - a family account (the owner or a co-guardian, signed in) → {} (the server knows them)
 * - anything else (a kid code, the doctor, guardian-device child mode) → null
 */
import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";

export function useCareCode(): string | null {
  const auth = useAuth();
  if (auth.doctorSession) return null;
  if (auth.caregiverSession) {
    return auth.accessCodeRole === "caregiver" && auth.caregiverCodeKind === "access" ? auth.caregiverCloudCode ?? null : null;
  }
  if (auth.isCaregiverAccount) return auth.nurseViewCode ?? null;
  return null;
}

export function useCarePlanArgs(): { code?: string } | null {
  const auth = useAuth();
  const code = useCareCode();
  return useMemo(() => {
    if (code) return { code };
    if (auth.doctorSession || auth.caregiverSession || auth.isCaregiverAccount || auth.isChildMode) return null;
    if (!auth.isSignedIn || !auth.account?.convexUserId) return null;
    return {};
  }, [code, auth.doctorSession, auth.caregiverSession, auth.isCaregiverAccount, auth.isChildMode, auth.isSignedIn, auth.account?.convexUserId]);
}
