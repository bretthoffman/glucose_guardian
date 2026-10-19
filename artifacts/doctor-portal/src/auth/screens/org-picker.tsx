import { ArrowLeft } from "lucide-react";
import { useDoctorSession } from "../mock-session";
import { AuthShell } from "./auth-shell";
import { OrgList } from "./org-list";

/**
 * Organization picker — part of the create-account path only (returning doctors sign in
 * directly). Picking an org stores it on the session and advances to the account form.
 */
export function OrgPicker({ onPicked, onBack }: { onPicked: () => void; onBack: () => void }) {
  const { actions } = useDoctorSession();
  return (
    <AuthShell
      title="Find your organization"
      subtitle="Next, search for where you work."
    >
      <OrgList
        onSelect={(org) => {
          actions.chooseOrg(org);
          onPicked();
        }}
      />
      <div className="mt-4 text-sm">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      </div>
    </AuthShell>
  );
}
