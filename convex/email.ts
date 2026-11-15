/**
 * Outgoing email (Resend). Sends nothing — and returns false — while RESEND_API_KEY is unset.
 * RESEND_FROM sets the sender, e.g. "Glucose Guardian <no-reply@yourdomain.com>" (a domain
 * verified in Resend); without it, Resend's shared test sender is used.
 */
const RESEND_URL = "https://api.resend.com/emails";
const FROM = () => process.env.RESEND_FROM ?? "Glucose Guardian <onboarding@resend.dev>";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Doctor alert + weekly digest emails are opt-in ON TOP of the key: they send only while the
 * DOCTOR_ALERT_EMAILS env var is exactly "on" (toggle live with `npx convex env set|remove`,
 * no redeploy). Sign-up verification codes need only RESEND_API_KEY and ignore this switch.
 */
export function alertEmailsEnabled(): boolean {
  return process.env.DOCTOR_ALERT_EMAILS === "on" && emailConfigured();
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [to], subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
