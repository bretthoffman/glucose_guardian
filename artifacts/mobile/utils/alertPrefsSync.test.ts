import { describe, expect, it } from "vitest";
import { patchTouchesBackend, rollbackSyncedKeys, SYNCED_ALERT_PREF_KEYS } from "./alertPrefsSync";

const prev = {
  notificationsEnabled: true,
  alertToChatOnOpenEnabled: false,
  emergencyAlertsEnabled: true,
  urgentLowThreshold: 55,
  lowThreshold: 70,
  highThreshold: 180,
  urgentHighThreshold: 250,
  oneTapTextEnabled: false,
  waitWindowEnabled: false,
  waitWindowMinutes: 10,
};

describe("patchTouchesBackend", () => {
  it("is true for a threshold change", () => {
    expect(patchTouchesBackend({ urgentLowThreshold: 60 })).toBe(true);
  });

  it("is FALSE for a device-only toggle, so it never round-trips", () => {
    // The Send-Alerts-to-Chat switch is device-local; a network failure must not revert it.
    expect(patchTouchesBackend({ alertToChatOnOpenEnabled: true })).toBe(false);
    expect(patchTouchesBackend({ notificationsEnabled: false })).toBe(false);
  });

  it("ignores explicitly-undefined values", () => {
    expect(patchTouchesBackend({ lowThreshold: undefined })).toBe(false);
  });
});

describe("rollbackSyncedKeys", () => {
  it("reverts a failed threshold change so the UI matches what the server will alert on", () => {
    const next = { ...prev, urgentLowThreshold: 45 };
    expect(rollbackSyncedKeys(next, prev).urgentLowThreshold).toBe(55);
  });

  it("KEEPS a device-only change made in the same patch", () => {
    const next = { ...prev, urgentLowThreshold: 45, alertToChatOnOpenEnabled: true };
    const rolled = rollbackSyncedKeys(next, prev);
    expect(rolled.urgentLowThreshold).toBe(55); // server rejected it
    expect(rolled.alertToChatOnOpenEnabled).toBe(true); // never needed the server
  });

  it("reverts every synced key it owns", () => {
    const next = { ...prev, emergencyAlertsEnabled: false, waitWindowEnabled: true, waitWindowMinutes: 30 };
    const rolled = rollbackSyncedKeys(next, prev);
    for (const k of SYNCED_ALERT_PREF_KEYS) {
      expect(rolled[k as keyof typeof rolled]).toEqual(prev[k as keyof typeof prev]);
    }
  });

  it("stays in sync with thresholdsToBackend's field list", () => {
    // If a field is added to thresholdsToBackend in AuthContext without being added here, a failed
    // write would leave it applied locally while the server rejected it.
    expect([...SYNCED_ALERT_PREF_KEYS].sort()).toEqual(
      ["emergencyAlertsEnabled", "highThreshold", "lowThreshold", "oneTapTextEnabled",
       "urgentHighThreshold", "urgentLowThreshold", "waitWindowEnabled", "waitWindowMinutes"].sort(),
    );
  });
});
