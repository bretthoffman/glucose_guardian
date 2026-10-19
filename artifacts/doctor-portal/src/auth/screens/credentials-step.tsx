import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { ApiError, useDoctorAuthLogin } from "@doctor-portal/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDoctorSession } from "../mock-session";
import { hashPassword } from "../password";
import { AuthShell } from "./auth-shell";

/** Set once this browser has signed in, so it opens on sign-in rather than the key screen. */
const SIGNED_IN_BEFORE_KEY = "gg_signed_in_before";

export function hasSignedInBefore(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_BEFORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSignedIn(): void {
  try {
    localStorage.setItem(SIGNED_IN_BEFORE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** What to tell the doctor when sign-in is refused. */
function signInErrorMessage(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  const serverMessage = e instanceof ApiError ? (e.data as { error?: string } | null)?.error : undefined;
  if (status === 429) return serverMessage ?? "Too many attempts. Try again in a few minutes.";
  return status === 401 ? "Invalid email or password." : "Couldn't sign in right now. Please try again.";
}

/** Email + password sign-in for returning doctors. */
export function CredentialsStep({ onBack }: { onBack: () => void }) {
  const { actions } = useDoctorSession();
  const login = useDoctorAuthLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const at = email.trim().toLowerCase();
    if (!at || !at.includes("@")) {
      setErr("Enter your work email.");
      return;
    }
    if (!password) {
      setErr("Enter your password.");
      return;
    }
    try {
      const res = await login.mutateAsync({ data: { email: at, passwordHash: hashPassword(password) } });
      rememberSignedIn();
      actions.authenticate(res.doctor, res.token, res.expiresAt);
    } catch (e) {
      setErr(signInErrorMessage(e));
    }
  }

  const busy = login.isPending;

  return (
    <AuthShell title="Sign in" subtitle="Welcome back — use your work email.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@hospital.org"
            className="mt-1.5"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative mt-1.5">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {err && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{err}</p>
          </div>
        )}

        <Button type="submit" className="w-full h-12" disabled={busy}>
          {busy ? "Please wait…" : "Sign in"}
          {!busy && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      </form>

      <div className="mt-4 text-sm">
        <button
          type="button"
          onClick={() => {
            setErr(null);
            onBack();
          }}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> New here? Enter your license key
        </button>
      </div>
    </AuthShell>
  );
}
