import { describe, it, expect } from "vitest";
import {
  diagnosticMessageKey,
  failureCategoryToDiagnostic,
  reconnectRequiredForDiagnostic,
  retryableForDiagnostic,
} from "./diagnostics";

describe("cgm diagnostics", () => {
  it("maps failure categories to client-safe diagnostic categories", () => {
    expect(failureCategoryToDiagnostic("none", { inserted: 3 })).toBe("connected");
    expect(failureCategoryToDiagnostic("connected_no_data")).toBe("connected_no_data");
    expect(failureCategoryToDiagnostic("no_shared_patient")).toBe("no_shared_patient");
    expect(failureCategoryToDiagnostic("sharing_not_enabled")).toBe("sharing_not_enabled");
    expect(failureCategoryToDiagnostic("invalid_credentials")).toBe("invalid_credentials");
    expect(failureCategoryToDiagnostic("rate_limited")).toBe("rate_limited");
    expect(failureCategoryToDiagnostic("provider_outage")).toBe("provider_unavailable");
  });

  it("exposes stable message keys", () => {
    expect(diagnosticMessageKey("no_shared_patient")).toBe("cgm.diagnostic.no_shared_patient");
    expect(diagnosticMessageKey("connected_no_data")).toBe("cgm.diagnostic.connected_no_data");
  });

  it("classifies reconnect and retry semantics", () => {
    expect(reconnectRequiredForDiagnostic("no_shared_patient")).toBe(false);
    expect(reconnectRequiredForDiagnostic("connected_no_data")).toBe(false);
    expect(reconnectRequiredForDiagnostic("sharing_not_enabled")).toBe(true);
    expect(retryableForDiagnostic("no_shared_patient")).toBe(true);
    expect(retryableForDiagnostic("connected_no_data")).toBe(true);
  });
});
