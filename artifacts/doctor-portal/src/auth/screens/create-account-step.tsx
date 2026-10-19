import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Eye, EyeOff, MailCheck, ShieldAlert } from "lucide-react";
import {
  customFetch,
  useDoctorAuthLogin,
  useDoctorAuthRegister,
  type DoctorProfile,
  type DoctorRegisterRequest,
} from "@doctor-portal/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SPECIALTY_SUGGESTIONS } from "@/components/DoctorProfileDialog";
import { useDoctorSession } from "../mock-session";
import { hashPassword } from "../password";
import { apiErrorInfo, domainList, emailDomainAllowed, type Access } from "../access-code";
import { AuthShell } from "./auth-shell";
import { rememberSignedIn } from "./credentials-step";

const NO_TITLE = "none";
/** New passwords guard patient records, so they're held to a longer minimum. */
const MIN_NEW_PASSWORD = 10;
// Honorific shown to patients as "<title> <last name>" on treatment proposals (e.g. "Dr. Rivera").
const TITLE_OPTIONS = ["Dr.", "NP", "PA", "RN", "PharmD"] as const;
/** Seconds before "Send a new code" is offered again. */
const RESEND_AFTER = 30;

/** What to tell the doctor when creating the account (or sending its email code) is refused. */
function signupErrorMessage(e: unknown, access: Access): string {
  const { status, error, reason, allowedDomains } = apiErrorInfo(e);
  if (status === 429) return error ?? "Too many attempts. Try again in a few minutes.";
  switch (reason) {
    case "domain_not_allowed":
      return `Use your work email (${domainList(allowedDomains ?? [])}).`;
    case "no_seats":
      return "Your organization has used all of its seats. Ask your administrator to add more.";
    case "invalid_license":
      return "That license key isn't valid anymore. Ask your administrator for the current one.";
    case "invalid_email_code":
      return "That code isn't right, or it has expired. Check the email or send a new code.";
    case "email_unavailable":
      return "We couldn't send a verification email right now. Please try again later.";
  }
  if (status === 409) return "An account with this email already exists. Sign in instead.";
  if (status === 403 && access.kind === "invite") {
    return "That invite code isn't valid for this email, or it has expired or already been used. Ask for a new invite.";
  }
  if (status === 503) return "Sign-up isn't available right now. Please try again later.";
  return "Couldn't create your account. Please try again.";
}

/**
 * Create the account. With a license key the organization is already known (shown, not asked)
 * and the work email is confirmed with an emailed code; with an invite the organization was
 * picked on the previous screen and the invite itself is tied to the email.
 */
export function CreateAccountStep({
  access,
  onBack,
  onSignIn,
  onChangeOrg,
}: {
  access: Access;
  /** Back to the home screen (a different key or code). */
  onBack: () => void;
  onSignIn: () => void;
  /** Invite path: pick a different organization. */
  onChangeOrg?: () => void;
}) {
  const { org, actions } = useDoctorSession();
  const register = useDoctorAuthRegister();
  const login = useDoctorAuthLogin();
  const [title, setTitle] = useState("Dr.");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // License path: set once the email code has been sent.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const license = access.kind === "license" ? access : null;
  const titleOut = title === NO_TITLE ? "" : title.trim();
  const at = email.trim().toLowerCase();

  function validate(): string | null {
    if (!firstName.trim() || !lastName.trim()) return "Enter your first and last name.";
    if (!jobTitle.trim()) return "Enter your job title or role.";
    if (!at || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(at)) return "Enter your work email.";
    if (license && !emailDomainAllowed(at, license.allowedDomains)) {
      return `Use your work email (${domainList(license.allowedDomains)}).`;
    }
    if (password.length < MIN_NEW_PASSWORD) return `Use at least ${MIN_NEW_PASSWORD} characters for your password.`;
    if (password !== confirm) return "Passwords don't match.";
    return null;
  }

  async function sendCode() {
    await customFetch("/api/doctor/auth/email-code", {
      method: "POST",
      body: JSON.stringify({ licenseKey: access.code, email: at }),
    });
    setCodeSentTo(at);
    setEmailCode("");
    setResendIn(RESEND_AFTER);
  }

  /** Create the account, sign in, and (invite path) save the job title on the profile. */
  async function createAndSignIn(code?: string) {
    const passwordHash = hashPassword(password);
    const first = firstName.trim();
    const last = lastName.trim();
    const data: DoctorRegisterRequest & Record<string, string | undefined> = {
      email: at,
      passwordHash,
      displayName: [titleOut, first, last].filter(Boolean).join(" "),
      title: titleOut || undefined,
      firstName: first,
      lastName: last,
      ...(license
        ? { licenseKey: license.code, emailCode: code, specialty: jobTitle.trim() }
        : { inviteCode: access.code, institution: org?.name }),
    };
    await register.mutateAsync({ data });
    // Brand-new account: queue the one-time guided tour (sign-ins never auto-run it).
    try {
      sessionStorage.setItem("gg_tour_pending", "1");
    } catch {
      /* ignore */
    }
    const res = await login.mutateAsync({ data: { email: at, passwordHash } });
    let doctor: DoctorProfile = res.doctor;
    if (!license && jobTitle.trim()) {
      // Invites don't carry the job title, so it's saved as a profile update (best-effort).
      try {
        doctor = await customFetch<DoctorProfile>("/api/doctor/me", {
          method: "PATCH",
          body: JSON.stringify({ specialty: jobTitle.trim() }),
          headers: { Authorization: `Bearer ${res.token}` },
        });
      } catch {
        /* they can add it later in their profile */
      }
    }
    rememberSignedIn();
    actions.authenticate(doctor, res.token, res.expiresAt);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const problem = validate();
    if (problem) {
      setErr(problem);
      return;
    }
    setBusy(true);
    try {
      if (license) await sendCode();
      else await createAndSignIn();
    } catch (e) {
      setErr(signupErrorMessage(e, access));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (emailCode.length !== 6) {
      setErr("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    try {
      await createAndSignIn(emailCode);
    } catch (e) {
      setErr(signupErrorMessage(e, access));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null);
    setBusy(true);
    try {
      await sendCode();
    } catch (e) {
      setErr(signupErrorMessage(e, access));
    } finally {
      setBusy(false);
    }
  }

  const errorBox = err && (
    <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-start gap-2">
      <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <p className="text-sm text-destructive">{err}</p>
    </div>
  );

  if (license && codeSentTo) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a 6-digit code to ${codeSentTo}.`}>
        <form onSubmit={submitCode} className="space-y-4">
          <div className="flex justify-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <MailCheck className="w-6 h-6 text-primary" />
            </div>
          </div>
          <div>
            <Label htmlFor="emailCode">Verification code</Label>
            <Input
              id="emailCode"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-1.5 h-12 text-center font-mono text-xl tracking-[0.5em]"
              autoFocus
            />
            <p className="mt-1.5 text-xs text-muted-foreground">It expires in 15 minutes.</p>
          </div>
          {errorBox}
          <Button type="submit" className="w-full h-12" disabled={busy}>
            {busy ? "Please wait…" : "Verify and create account"}
            {!busy && <ArrowRight className="w-4 h-4 ml-2" />}
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setCodeSentTo(null);
            }}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Change email
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={busy || resendIn > 0}
            className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {resendIn > 0 ? `Send a new code (${resendIn}s)` : "Send a new code"}
          </button>
        </div>
      </AuthShell>
    );
  }

  const exampleDomain = license?.allowedDomains[0];

  return (
    <AuthShell
      title="Create your account"
      subtitle={license ? undefined : org ? `${org.name} · work email` : undefined}
    >
      {license && (
        <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Joining</p>
            <p className="font-semibold text-foreground truncate">{license.organization.name}</p>
            {license.organization.location && (
              <p className="text-xs text-muted-foreground">{license.organization.location}</p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submitForm} className="space-y-4">
        <div className="grid grid-cols-[5.5rem_1fr] gap-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Select value={title} onValueChange={setTitle}>
              <SelectTrigger id="title" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TITLE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
                <SelectItem value={NO_TITLE}>No title</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex"
                className="mt-1.5"
                autoComplete="given-name"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Rivera"
                className="mt-1.5"
                autoComplete="family-name"
              />
            </div>
          </div>
        </div>

        {lastName.trim() && (
          <p className="-mt-1 text-xs text-muted-foreground">
            Patients will see{" "}
            <span className="font-medium text-foreground">
              {[titleOut, lastName.trim()].filter(Boolean).join(" ")}
            </span>{" "}
            on treatment changes.
          </p>
        )}

        <div>
          <Label htmlFor="jobTitle">Job title or role</Label>
          <Input
            id="jobTitle"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="e.g. Pediatric Endocrinology"
            className="mt-1.5"
            autoComplete="organization-title"
            list="signup-specialty-suggestions"
          />
          <datalist id="signup-specialty-suggestions">
            {SPECIALTY_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={exampleDomain ? `name@${exampleDomain}` : "name@hospital.org"}
            className="mt-1.5"
            autoComplete="email"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {license
              ? license.allowedDomains.length
                ? `Use your ${domainList(license.allowedDomains)} email. We'll send it a code to confirm it's yours.`
                : "We'll send it a code to confirm it's yours."
              : "Use the email your invite was sent to."}
          </p>
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
              autoComplete="new-password"
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
          <p className="mt-1.5 text-xs text-muted-foreground">At least {MIN_NEW_PASSWORD} characters.</p>
        </div>

        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5"
            autoComplete="new-password"
          />
        </div>

        {errorBox}

        <Button type="submit" className="w-full h-12" disabled={busy}>
          {busy ? "Please wait…" : license ? "Continue" : "Create account"}
          {!busy && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {license ? "Different key" : "Back"}
        </button>
        {license ? (
          <button type="button" onClick={onSignIn} className="text-primary hover:underline">
            Already have an account? Sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onChangeOrg?.()}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Building2 className="w-3.5 h-3.5" /> Change org
          </button>
        )}
      </div>
    </AuthShell>
  );
}
