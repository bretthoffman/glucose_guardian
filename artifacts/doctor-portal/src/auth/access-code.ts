import { ApiError, customFetch } from "@doctor-portal/api-client-react";

/**
 * The code a doctor enters on the home screen: an organization's license key (which fills in
 * the organization) or a personal invite (tied to one email). The server says which.
 */
export type Access =
  | { kind: "invite"; code: string }
  | {
      kind: "license";
      code: string;
      organization: { name: string; location?: string };
      allowedDomains: string[];
    };

/** An invite link (`?invite=CODE`) fills in the code. */
export function inviteFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("invite")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The server's error message and machine-readable reason, when it sent them. */
export function apiErrorInfo(e: unknown): { status: number; error?: string; reason?: string; allowedDomains?: string[] } {
  if (!(e instanceof ApiError)) return { status: 0 };
  const data = (e.data ?? {}) as { error?: string; reason?: string; allowedDomains?: string[] };
  return { status: e.status, ...data };
}

export type DescribeResult =
  | { ok: true; access: Access }
  | { ok: false; message: string };

export async function describeAccessCode(raw: string): Promise<DescribeResult> {
  const code = raw.trim();
  try {
    const r = await customFetch<
      | { kind: "invite" }
      | {
          kind: "license";
          organization: { name: string; location?: string };
          allowedDomains: string[];
          seatsAvailable: boolean;
        }
    >("/api/doctor/auth/access-code", { method: "POST", body: JSON.stringify({ code }) });
    if (r.kind === "invite") return { ok: true, access: { kind: "invite", code } };
    if (!r.seatsAvailable) {
      return {
        ok: false,
        message: `${r.organization.name} has used all of its seats. Ask your administrator to add more.`,
      };
    }
    return {
      ok: true,
      access: { kind: "license", code, organization: r.organization, allowedDomains: r.allowedDomains },
    };
  } catch (e) {
    const { status, error, reason } = apiErrorInfo(e);
    if (reason === "invalid_code") return { ok: false, message: "That code isn't valid. Check it and try again." };
    if (status === 429) return { ok: false, message: error ?? "Too many attempts. Try again later." };
    if (status === 400) return { ok: false, message: "Enter your license key or invite code." };
    // Anything else (offline, server error, check not available): stop here. Nothing past this
    // screen is shown without a code the server has confirmed.
    return { ok: false, message: "We couldn't check that code right now. Please try again in a few minutes." };
  }
}

/** Whether `email` is on one of the organization's allowed domains (or a subdomain). */
export function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export const domainList = (domains: string[]) => domains.map((d) => `@${d}`).join(" or ");
