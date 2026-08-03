import { describe, expect, it } from "vitest";
import { bannerKindFromSyncStatus, cgmDiagnosticMessage } from "./cgmDiagnosticMessages";

describe("cgmDiagnosticMessage — provider-correct copy", () => {
  it("names DEXCOM for a Dexcom connection (never 'Libre')", () => {
    // The bug: a Dexcom user was told to re-enter their "stored Libre credentials".
    const msg = cgmDiagnosticMessage("cgm.diagnostic.invalid_credentials", "dexcom");
    expect(msg).toContain("Dexcom");
    expect(msg).not.toContain("Libre");

    for (const key of [
      "cgm.diagnostic.session_expired",
      "cgm.diagnostic.rate_limited",
      "cgm.diagnostic.provider_unavailable",
      "cgm.diagnostic.unknown_provider_error",
      "cgm.diagnostic.connected_no_data",
    ]) {
      expect(cgmDiagnosticMessage(key, "dexcom")).not.toContain("Libre");
    }
  });

  it("still names Libre for a Libre connection", () => {
    expect(cgmDiagnosticMessage("cgm.diagnostic.invalid_credentials", "libre")).toContain("Libre");
    expect(cgmDiagnosticMessage("cgm.diagnostic.session_expired", "libre")).toContain("Libre");
  });

  it("keeps LibreLinkUp-only guidance Libre-worded (those keys only come from the Libre adapter)", () => {
    expect(cgmDiagnosticMessage("cgm.diagnostic.no_shared_patient", "libre")).toContain("LibreLinkUp");
    expect(cgmDiagnosticMessage("cgm.diagnostic.sharing_not_enabled", "libre")).toContain("LibreLinkUp");
  });

  it("degrades to a neutral name when the provider is unknown, and to a generic line for unknown keys", () => {
    const msg = cgmDiagnosticMessage("cgm.diagnostic.invalid_credentials", null);
    expect(msg).toContain("your CGM");
    expect(msg).not.toContain("Libre");
    expect(cgmDiagnosticMessage("cgm.diagnostic.made_up", "dexcom")).toBe("Sync status updated.");
  });

  it("leaves credential-free copy alone", () => {
    expect(cgmDiagnosticMessage("cgm.diagnostic.connected", "dexcom")).toBe("Connected and receiving readings.");
  });
});

describe("bannerKindFromSyncStatus — which provider sees which banner", () => {
  const base = { reconnectRequired: true } as const;

  it("shows reconnect + outage banners for DEXCOM too (previously suppressed entirely)", () => {
    expect(bannerKindFromSyncStatus({ ...base, provider: "dexcom", diagnosticCategory: "invalid_credentials" }))
      .toBe("reconnect_required");
    expect(bannerKindFromSyncStatus({ provider: "dexcom", diagnosticCategory: "provider_unavailable" }))
      .toBe("provider_unavailable");
  });

  it("keeps sharing/follower banners Libre-only", () => {
    for (const category of ["no_shared_patient", "connected_no_data", "sharing_not_enabled"]) {
      expect(bannerKindFromSyncStatus({ provider: "libre", diagnosticCategory: category })).toBe(category);
      expect(bannerKindFromSyncStatus({ provider: "dexcom", diagnosticCategory: category })).toBeNull();
    }
  });

  it("missing stored credentials outranks everything, for either provider", () => {
    expect(bannerKindFromSyncStatus({ provider: "dexcom", hasStoredCredentials: false })).toBe("backup_missing");
    expect(bannerKindFromSyncStatus({ provider: "libre", backupMissing: true })).toBe("backup_missing");
  });

  it("stays quiet when a reconnect isn't actually required", () => {
    expect(bannerKindFromSyncStatus({ provider: "dexcom", diagnosticCategory: "session_expired", reconnectRequired: false }))
      .toBeNull();
  });
});
