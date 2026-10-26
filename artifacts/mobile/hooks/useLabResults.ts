/**
 * Lab results for the signed-in family's circle (convex/labResults): live list plus save / remove.
 * Only signed-in family accounts (owner, co-guardians) use it; access-code and nurse sessions don't
 * see labs, and a doctor session has its own portal.
 */
import { useQuery } from "convex/react";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import type { LabResult } from "@/utils/labs";

export function useLabAccess(): { canSee: boolean; canEdit: boolean } {
  const auth = useAuth();
  const canSee =
    auth.isSignedIn &&
    !!auth.account?.convexUserId &&
    !auth.caregiverSession &&
    !auth.nurseViewCode &&
    !auth.doctorSession &&
    !auth.isCaregiverAccount;
  return { canSee, canEdit: canSee && !auth.isChildMode };
}

export function useLabResults() {
  const { canSee, canEdit } = useLabAccess();
  const rows = useQuery(api.labResults.list, canSee ? {} : "skip");
  const labs: LabResult[] | undefined = rows == null ? (canSee ? undefined : []) : (rows as LabResult[]);
  const save = async (lab: Omit<LabResult, "authorName">) => {
    await createConvexAuthClient().mutation(api.labResults.save, {
      lab: {
        clientId: lab.id,
        test: lab.test,
        name: lab.name,
        ...(lab.value != null ? { value: lab.value } : {}),
        ...(lab.valueText ? { valueText: lab.valueText } : {}),
        ...(lab.unit ? { unit: lab.unit } : {}),
        ...(lab.refRange ? { refRange: lab.refRange } : {}),
        takenOn: lab.takenOn,
        source: lab.source,
        ...(lab.externalId ? { externalId: lab.externalId } : {}),
      },
    });
  };
  const remove = async (id: string) => {
    await createConvexAuthClient().mutation(api.labResults.remove, { id });
  };
  return { labs, canSee, canEdit, save, remove };
}
