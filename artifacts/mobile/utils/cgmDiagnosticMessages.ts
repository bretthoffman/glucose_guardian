/**
 * User-facing copy for sanitized CGM diagnostic message keys.
 * Keys originate from `convex/cgm/diagnostics.ts` — never raw provider text.
 *
 * The copy is PROVIDER-AWARE: the same keys are emitted for Dexcom and Libre (the backend runs one
 * generic sync loop over per-provider adapters), so the wording has to be filled in from the
 * connection's own type. Previously every string hardcoded "Libre", which told Dexcom users to
 * "sign in with the stored Libre credentials" — wrong service, and it reads like their data went
 * somewhere it didn't. Only genuinely LibreLinkUp-specific concepts (follower sharing) stay
 * Libre-worded, and those keys are only ever produced by the Libre adapter.
 */
export type CgmProvider = "dexcom" | "libre";

/** How each service is named in user-facing copy. */
function providerName(provider?: CgmProvider | null): string {
  if (provider === "dexcom") return "Dexcom";
  if (provider === "libre") return "Libre";
  return "your CGM";
}

/** Generic keys — `{p}` is replaced with the connected provider's name. */
const MESSAGES: Record<string, string> = {
  "cgm.diagnostic.connected": "Connected and receiving readings.",
  "cgm.diagnostic.connected_no_data": "{p} is connected, but no glucose readings are available yet.",
  "cgm.diagnostic.invalid_credentials":
    "Could not sign in with the stored {p} credentials. Reconnect to try again.",
  "cgm.diagnostic.session_expired": "Your {p} session expired. Reconnect to resume monitoring.",
  "cgm.diagnostic.no_credentials":
    "Background monitoring is not fully enabled. Reconnect your CGM to store credentials securely.",
  "cgm.diagnostic.rate_limited": "{p} is temporarily limiting requests. We'll retry automatically.",
  "cgm.diagnostic.provider_unavailable":
    "Could not reach {p} right now. We'll keep retrying automatically.",
  "cgm.diagnostic.unknown_provider_error":
    "A temporary {p} sync issue occurred. We'll keep retrying automatically.",
  // LibreLinkUp-only concepts (follower accounts / sharing) — emitted only by the Libre adapter.
  "cgm.diagnostic.no_shared_patient":
    "Libre account connected, but no shared patient was found. Use a LibreLinkUp follower account, enable sharing from the sensor wearer's Libre app, and accept the invitation.",
  "cgm.diagnostic.sharing_not_enabled":
    "LibreLinkUp sharing is not enabled for this account. Enable sharing in the LibreLink app, then reconnect.",
};

export function cgmDiagnosticMessage(messageKey: string, provider?: CgmProvider | null): string {
  const template = MESSAGES[messageKey];
  if (!template) return "Sync status updated.";
  return template.replace(/\{p\}/g, providerName(provider));
}

export type CgmSyncBannerKind =
  | "backup_missing"
  | "no_shared_patient"
  | "connected_no_data"
  | "sharing_not_enabled"
  | "reconnect_required"
  | "provider_unavailable"
  | null;

export function bannerKindFromSyncStatus(args: {
  provider: CgmProvider | null;
  diagnosticCategory?: string | null;
  reconnectRequired?: boolean;
  backupMissing?: boolean;
  hasStoredCredentials?: boolean;
}): CgmSyncBannerKind {
  if (args.backupMissing || args.hasStoredCredentials === false) return "backup_missing";
  // Sharing/follower states are LibreLinkUp-only; the rest apply to any provider, so a Dexcom
  // account gets its reconnect + outage banners too instead of silently showing nothing.
  switch (args.diagnosticCategory) {
    case "no_shared_patient":
      return args.provider === "libre" ? "no_shared_patient" : null;
    case "connected_no_data":
      return args.provider === "libre" ? "connected_no_data" : null;
    case "sharing_not_enabled":
      return args.provider === "libre" ? "sharing_not_enabled" : null;
    case "invalid_credentials":
    case "session_expired":
    case "no_credentials":
      return args.reconnectRequired ? "reconnect_required" : null;
    case "rate_limited":
    case "provider_unavailable":
    case "unknown_provider_error":
      return "provider_unavailable";
    default:
      return null;
  }
}
