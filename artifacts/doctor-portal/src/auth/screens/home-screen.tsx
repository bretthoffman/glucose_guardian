import { useRef, useState } from "react";
import { ArrowRight, FileText, KeyRound, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDoctorSession } from "../mock-session";
import { describeAccessCode, inviteFromUrl, type Access } from "../access-code";
import { AuthShell } from "./auth-shell";
import { openPass } from "@/pass/pass-mode";

/** Keys are 4 groups of 4 (invites 3 groups); longer input is cut off. */
const GROUP = 4;
const MAX_CHARS = 16;

/** Uppercase, drop anything but letters and digits, and put a dash between every group of 4. */
export function formatAccessCode(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_CHARS);
  return chars.match(new RegExp(`.{1,${GROUP}}`, "g"))?.join("-") ?? "";
}

/** A Doctor Portal pass is "GG-" + 7 letters/digits; the field renders the GG- itself. */
const PASS_LEN = 7;

/**
 * The pass's own characters: uppercase letters/digits, at most 7. Only a pasted "GG-" prefix
 * (with its dash, as the PDF prints it) is dropped; a bare leading "GG" can be the code's own
 * first letters, so it stays.
 */
export function passChars(raw: string): string {
  const bare = raw.toUpperCase().replace(/^\s*GG-/, "");
  return bare.replace(/[^A-Z0-9]/g, "").slice(0, PASS_LEN);
}

/** Grouped the way the Visit Summary prints it: XXXX-XXX. */
export function groupPassChars(chars: string): string {
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

/** A link from the PDF can carry the code: ?pass=GG-XXXX-XXX. */
function passFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("pass")?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * The front door: enter a license key (or invite code) to create an account, open a patient with
 * the one-time code from their Visit Summary, try the demo, or go to sign-in.
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
  const [pass, setPass] = useState(() => passChars(passFromUrl()));
  const [passErr, setPassErr] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const passInput = useRef<HTMLInputElement | null>(null);

  async function submitPass(e: React.FormEvent) {
    e.preventDefault();
    setPassErr(null);
    if (pass.length < PASS_LEN) {
      setPassErr(
        "A report code has 7 characters after the GG-. A 6-character code is a Doctor Code from the app, which links a patient to a doctor account instead: sign in, then use Link a patient by Doctor Code on the Patients screen.",
      );
      return;
    }
    setOpening(true);
    const result = await openPass(`GG-${groupPassChars(pass)}`);
    setOpening(false);
    if (result.ok) actions.startPass(result.pass);
    else setPassErr(result.message);
  }

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

      <div className="mt-6 pt-5 border-t border-border/60 space-y-3">
        <form onSubmit={submitPass} className="rounded-xl bg-primary/10 border border-primary/40 p-4">
          <Label htmlFor="passCode" className="text-sm font-medium text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Have a code from a patient's report?
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            The one-time code at the top of a Glucose Guardian Visit Summary opens that patient's live data,
            view only, for 24 hours. No account needed.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <div
              className="flex h-11 w-full cursor-text items-center rounded-xl border-2 border-input bg-background px-4 font-mono text-base tracking-wider transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"
              onClick={() => passInput.current?.focus()}
            >
              <span aria-hidden="true" className="select-none text-foreground">
                GG-
              </span>
              <input
                id="passCode"
                ref={passInput}
                value={groupPassChars(pass)}
                onChange={(e) => {
                  setPass(passChars(e.target.value));
                  setPassErr(null);
                }}
                placeholder="XXXX-XXX"
                className="h-full w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-base tracking-wider text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </div>
            {/* Active from 6 characters so a Doctor Code gets an explanation instead of a dead button. */}
            <Button type="submit" className="h-11 w-full" disabled={opening || pass.length < PASS_LEN - 1}>
              {opening ? "Checking…" : "View for 24 hours"}
            </Button>
          </div>
          {passErr && (
            <div className="mt-3 bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{passErr}</p>
            </div>
          )}
        </form>
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
