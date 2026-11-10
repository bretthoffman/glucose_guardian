import { describe, expect, it } from "vitest";
import { clockAt, longLeft, newSensorGap, parseSensorLabel, reminderAt, SENSOR_GTINS, sensorBadge, sensorStatus, shortLeft, startFromGap } from "./sensorLogic";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Sun Nov 8 2026, 7:12 AM in New York (UTC-5).
const start = Date.UTC(2026, 10, 8, 12, 12);
const ny = -300;

describe("sensor countdown", () => {
  it("walks a G7 through warm-up, its days, the last day, the 12-hour grace period, and the end", () => {
    expect(sensorStatus("g7", start, start + 10 * 60_000, false)).toMatchObject({ phase: "warmup", msLeft: 15 * 60_000 });
    expect(sensorStatus("g7", start, start + 10 * 60_000, true).phase).toBe("active"); // warmed up early
    const s = sensorStatus("g7", start, start + 2 * DAY + 13 * 60_000, true);
    expect(s.phase).toBe("active");
    expect(longLeft(s.msLeft)).toBe("7 days 23 hours");
    expect(shortLeft(s.msLeft)).toBe("7d 23h");
    expect(sensorStatus("g7", start, start + 10 * DAY - 5 * HOUR, true)).toMatchObject({ phase: "lastDay", msLeft: 5 * HOUR });
    expect(sensorStatus("g7", start, start + 10 * DAY + 3 * HOUR, true)).toMatchObject({ phase: "grace", msLeft: 9 * HOUR });
    expect(sensorStatus("g7", start, start + 10 * DAY + 13 * HOUR, true).phase).toBe("expired");
  });

  it("G6 and Libre have no grace period; the G7 15 Day has 15 days plus 12 hours", () => {
    expect(sensorStatus("g6", start, start + 10 * DAY + HOUR, true).phase).toBe("expired");
    expect(sensorStatus("libre14", start, start + 14 * DAY + HOUR, true).phase).toBe("expired");
    expect(sensorStatus("libre15", start, start + 14 * DAY + HOUR, true).phase).toBe("lastDay");
    expect(sensorStatus("g7_15", start, start + 15 * DAY + 6 * HOUR, true).phase).toBe("grace");
    expect(sensorStatus("g7_15", start, start + 30 * 60_000, false).phase).toBe("warmup"); // 60-minute warm-up
  });

  it("reminds at 8 PM the evening before the day it ends, on the family's clock", () => {
    const endsAt = start + 10 * DAY; // Wed Nov 18, 7:12 AM
    expect(reminderAt(endsAt, ny, start)).toBe(Date.UTC(2026, 10, 18, 1, 0)); // Tue Nov 17, 8:00 PM
    const eveningEnd = Date.UTC(2026, 10, 18, 2, 30); // Tue Nov 17, 9:30 PM: reminded Mon Nov 16, 8:00 PM
    expect(reminderAt(eveningEnd, ny, start)).toBe(Date.UTC(2026, 10, 17, 1, 0));
    expect(reminderAt(endsAt, ny, endsAt)).toBeNull();
    expect(clockAt(endsAt, ny)).toBe("7:12 AM");
  });

  it("spots the gap a sensor change leaves, but not signal loss mid-sensor", () => {
    const now = start + 10 * DAY + HOUR; // in the grace period
    const readings = [now - 3 * HOUR, now - 2.95 * HOUR, now - 2.9 * HOUR, now - 2.4 * HOUR, now - 2.35 * HOUR];
    const gap = newSensorGap(readings, { kind: "g7", startedAt: start }, now);
    expect(gap).toEqual({ stoppedAt: now - 2.9 * HOUR, resumedAt: now - 2.4 * HOUR });
    expect(startFromGap("g7", gap!)).toBe(now - 2.4 * HOUR - 25 * 60_000);
    // The same gap halfway through the sensor: probably lost signal, don't ask.
    const mid = start + 5 * DAY;
    expect(newSensorGap(readings.map((t) => t - (now - mid)), { kind: "g7", startedAt: start }, mid)).toBeNull();
    // No countdown yet: ask.
    expect(newSensorGap(readings, null, now)).not.toBeNull();
    // Already marked: the gap belongs to the new sensor.
    expect(newSensorGap(readings, { kind: "g7", startedAt: now - 2.6 * HOUR }, now)).toBeNull();
    // Short dropouts aren't sensor changes.
    expect(newSensorGap([now - 30 * 60_000, now - 20 * 60_000, now - 5 * 60_000], null, now)).toBeNull();
  });

  it("words the small line under Dexcom for each stage", () => {
    const at = (ms: number, read = true) => sensorBadge(sensorStatus("g7", start, start + ms, read));
    expect(at(3 * 60_000, false)).toEqual({ text: "Warming up · 22m left", tone: "muted" });
    expect(at(2 * DAY + 13 * 60_000)).toEqual({ text: "Sensor · 7d 23h left", tone: "muted" });
    expect(at(10 * DAY - 5 * HOUR)).toEqual({ text: "Sensor ends in 5h", tone: "warn" });
    expect(at(10 * DAY + 3 * HOUR)).toEqual({ text: "Grace period · 9h left", tone: "danger" });
    expect(at(11 * DAY)).toEqual({ text: "Sensor ended", tone: "danger" });
    expect(sensorBadge(null)).toBeNull();
  });
});

describe("sensor barcode", () => {
  // Brian's G7 applicator, Nov 10 2026.
  const want = { gtin: "00386270003935", serial: "823366645062", madeOn: "2026-05-01", expiresOn: "2027-10-31", pairingCode: "2165" };

  it("reads it written out", () => {
    expect(parseSensorLabel("(01)00386270003935(21)823366645062(11)260501(17)271031(240)2165")).toEqual(want);
  });

  it("reads it raw, the way a phone camera hands it over", () => {
    const GS = "\u001d";
    expect(parseSensorLabel(`]d201003862700039352182336664506${"2"}${GS}1126050117271031240${"2165"}`)).toEqual(want);
    expect(parseSensorLabel(`0100386270003935218233666450622${GS}10LOT42${GS}17271031`)).toMatchObject({ serial: "8233666450622", lot: "LOT42", expiresOn: "2027-10-31" });
  });

  it("ignores codes that aren't sensor labels", () => {
    expect(parseSensorLabel("HOLLY001")).toBeNull();
    expect(parseSensorLabel("https://example.com")).toBeNull();
    expect(SENSOR_GTINS["00386270003935"]).toBe("g7");
  });
});
