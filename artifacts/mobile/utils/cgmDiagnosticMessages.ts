/**
 * User-facing copy for sanitized CGM diagnostic message keys.
 * Keys originate from `convex/cgm/diagnostics.ts` — never raw provider text.
 */
const MESSAGES: Record<string, string> = {
  "cgm.diagnostic.connected": "Connected and receiving readings.",
  "cgm.diagnostic.connected_no_data":
    "Libre is connected, but no glucose readings are available yet.",
  "cgm.diagnostic.no_shared_patient":
    "Libre account connected, but no shared patient was found. Use a LibreLinkUp follower account, enable sharing from the sensor wearer's Libre app, and accept the invitation.",
  "cgm.diagnostic.invalid_credentials":
    "Could not sign in with the stored Libre credentials. Reconnect to try again.",
  "cgm.diagnostic.session_expired":
    "Your Libre session expired. Reconnect to resume monitoring.",
  "cgm.diagnostic.no_credentials":
    "Background monitoring is not fully enabled. Reconnect your CGM to store credentials securely.",
  "cgm.diagnostic.rate_limited":
    "Libre is temporarily limiting requests. We'll retry automatically.",
  "cgm.diagnostic.provider_unavailable":
    "Could not reach Libre right now. We'll keep retrying automatically.",
  "cgm.diagnostic.sharing_not_enabled":
    "LibreLinkUp sharing is not enabled for this account. Enable sharing in the LibreLink app, then reconnect.",
  "cgm.diagnostic.unknown_provider_error":
    "A temporary Libre sync issue occurred. We'll keep retrying automatically.",
};

export function cgmDiagnosticMessage(messageKey: string, provider?: "dexcom" | "libre" | null): string {
  if (messageKey === "cgm.diagnostic.no_shared_patient" && provider === "libre") {
    return MESSAGES[messageKey]!;
  }
  if (messageKey === "cgm.diagnostic.connected_no_data" && provider === "libre") {
    return MESSAGES[messageKey]!;
  }
  if (messageKey === "cgm.diagnostic.sharing_not_enabled") {
    return MESSAGES[messageKey]!;
  }
  return MESSAGES[messageKey] ?? "Sync status updated.";
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
  provider: "dexcom" | "libre" | null;
  diagnosticCategory?: string | null;
  reconnectRequired?: boolean;
  backupMissing?: boolean;
  hasStoredCredentials?: boolean;
}): CgmSyncBannerKind {
  if (args.backupMissing || args.hasStoredCredentials === false) return "backup_missing";
  if (args.provider !== "libre") return null;
  switch (args.diagnosticCategory) {
    case "no_shared_patient":
      return "no_shared_patient";
    case "connected_no_data":
      return "connected_no_data";
    case "sharing_not_enabled":
      return "sharing_not_enabled";
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
