/**
 * Sanitized CGM provider diagnostics — safe for client exposure.
 *
 * Maps internal failure/read outcomes to user-facing categories and message keys.
 * Never carries credentials, tokens, raw upstream bodies, or patient identifiers.
 */
import type { FailureCategory } from "./core";

/** Client-safe provider connection category (Libre-first; Dexcom maps where applicable). */
export type ProviderDiagnosticCategory =
  | "connected"
  | "connected_no_data"
  | "no_shared_patient"
  | "invalid_credentials"
  | "session_expired"
  | "no_credentials"
  | "rate_limited"
  | "provider_unavailable"
  | "sharing_not_enabled"
  | "unknown_provider_error";

/** Stable message keys for mobile copy — not raw provider text. */
export const DIAGNOSTIC_MESSAGE_KEYS: Record<ProviderDiagnosticCategory, string> = {
  connected: "cgm.diagnostic.connected",
  connected_no_data: "cgm.diagnostic.connected_no_data",
  no_shared_patient: "cgm.diagnostic.no_shared_patient",
  invalid_credentials: "cgm.diagnostic.invalid_credentials",
  session_expired: "cgm.diagnostic.session_expired",
  no_credentials: "cgm.diagnostic.no_credentials",
  rate_limited: "cgm.diagnostic.rate_limited",
  provider_unavailable: "cgm.diagnostic.provider_unavailable",
  sharing_not_enabled: "cgm.diagnostic.sharing_not_enabled",
  unknown_provider_error: "cgm.diagnostic.unknown_provider_error",
};

export function diagnosticMessageKey(category: ProviderDiagnosticCategory): string {
  return DIAGNOSTIC_MESSAGE_KEYS[category];
}

export function reconnectRequiredForDiagnostic(category: ProviderDiagnosticCategory): boolean {
  return (
    category === "invalid_credentials" ||
    category === "session_expired" ||
    category === "no_credentials" ||
    category === "sharing_not_enabled"
  );
}

export function retryableForDiagnostic(category: ProviderDiagnosticCategory): boolean {
  return (
    category === "rate_limited" ||
    category === "provider_unavailable" ||
    category === "unknown_provider_error" ||
    category === "no_shared_patient" ||
    category === "connected_no_data"
  );
}

/** Map an ingestion `FailureCategory` (+ optional Libre context) to a client diagnostic category. */
export function failureCategoryToDiagnostic(
  category: FailureCategory,
  opts?: { sessionExpired?: boolean; inserted?: number },
): ProviderDiagnosticCategory {
  if (category === "none") {
    return (opts?.inserted ?? 0) > 0 ? "connected" : "connected";
  }
  if (category === "connected_no_data") return "connected_no_data";
  if (category === "no_shared_patient") return "no_shared_patient";
  if (category === "sharing_not_enabled") return "sharing_not_enabled";
  if (category === "no_credentials") return "no_credentials";
  if (category === "invalid_credentials") {
    return opts?.sessionExpired ? "session_expired" : "invalid_credentials";
  }
  if (category === "rate_limited") return "rate_limited";
  if (category === "provider_outage" || category === "network_timeout") return "provider_unavailable";
  return "unknown_provider_error";
}

/** Sanitized Libre diagnostic action result — no secrets or PII. */
export interface LibreDiagnosticSummary {
  status: ProviderDiagnosticCategory;
  messageKey: string;
  authenticationSucceeded: boolean;
  regionResolved: boolean;
  /** Resolved regional API host pattern only (e.g. api.eu.libreview.io), never credentials. */
  apiHostLabel?: string;
  connectionCount: number;
  selectedConnectionFound: boolean;
  graphRequestSucceeded: boolean;
  readingCount: number;
  latestReadingTimestamp: string | null;
  reconnectRequired: boolean;
  retryable: boolean;
  multiConnectionDetected: boolean;
}
