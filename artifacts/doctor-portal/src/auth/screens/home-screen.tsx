import { useState } from "react";
import { ArrowRight, KeyRound, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDoctorSession } from "../mock-session";
import { describeAccessCode, inviteFromUrl, type Access } from "../access-code";
import { AuthShell } from "./auth-shell";

/** Keys are 4 groups of 4 (invites 3 groups); longer input is cut off. */
const GROUP = 4;
const MAX_CHARS = 16;

/** Uppercase, drop anything but letters and digits, and put a dash between every group of 4. */
export function formatAccessCode(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_CHARS);
  return chars.match(new RegExp(`.{1,${GROUP}}`, "g"))?.join("-") ?? "";
}

/**
 * The front door: enter a license key (or invite code) to create an account, try the demo, or
 * go to sign-in.
 */
export function HomeScreen({
  onAccess,
  onSignIn,
}: {
  onAccess: (access: Access) => void;
  onSignIn: () => void;
}) {
  const { actions } = useDoctorSession();
  const [code, setCode] = useState(() => formatAccessCode(inviteFromUrl()));
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!code.trim()) {
      setErr("Enter your license key or invite code.");
      return;
    }
    setChecking(true);
    const result = await describeAccessCode(code);
    setChecking(false);
    if (result.ok) onAccess(result.access);
    else setErr(result.message);
  }

  return (
    <AuthShell
      logoClassName="w-36 h-36 sm:w-44 sm:h-44"
      title="Glucose Guardian for clinicians" subtitle="Your patients' glucose, insulin and meals in one place.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="accessCode" className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> License key or invite code
          </Label>
          <Input
            id="accessCode"
            value={code}
            onChange={(e) => setCode(formatAccessCode(e.target.value))}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="mt-1.5 h-12 font-mono tracking-wider text-base"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your organization's administrator gives you this. A license key sets up your organization for
            you.
          </p>
        </div>

        {err && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{err}</p>
          </div>
        )}

        <Button type="submit" className="w-full h-12" disabled={checking}>
          {checking ? "Checking…" : "Continue"}
          {!checking && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      </form>

      <div className="mt-6 pt-5 border-t border-border/60">
        <div className="rounded-xl bg-primary/5 border border-primary/15 p-4">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Just looking?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Explore the portal with five sample patients. No account needed, and nothing is saved.
          </p>
          <Button type="button" variant="outline" className="w-full mt-3" onClick={() => actions.startDemo()}>
            Try the demo
          </Button>
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button type="button" onClick={onSignIn} className="text-primary font-medium hover:underline">
          Sign in
        </button>
      </p>
    </AuthShell>
  );
}
