import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { formatPassCode, normalizePassCode } from "./portalTrial";

const modules = import.meta.glob("./**/!(*.test).*s");
const SECRET = "test-doctor-api-secret";
const HOUR = 3600_000;
const DAY = 24 * HOUR;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trial = (api as any).portalTrial;

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setupOwner(t: ReturnType<typeof convexTest>) {
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
  await t.mutation(api.patientProfile.replace, {
    userId: owner,
    passwordHash: "h-owner",
    profile: { childName: "Bella", parentName: "Brian", diabetesType: "type1", dateOfBirth: "2022-01-01" },
  });
  await t.mutation(api.patientGlucose.upsertBatch, {
    userId: owner,
    passwordHash: "h-owner",
    entries: [{ glucose: 142, timestamp: "2026-10-22T11:55:00.000Z", anomaly: { warning: false } }],
  });
  return { owner, auth: { userId: owner, passwordHash: "h-owner" } };
}

describe("codes", () => {
  it("normalizes what a doctor types and prints the GG- form", () => {
    expect(normalizePassCode(" gg-7kq4 m2x ")).toBe("7KQ4M2X");
    expect(normalizePassCode("7KQ4-M2X")).toBe("7KQ4M2X");
    expect(formatPassCode("7KQ4M2X")).toBe("GG-7KQ4-M2X");
  });
});

describe("Doctor Portal pass", () => {
  it("prints the same unused code on every report", async () => {
    const t = convexTest(schema, modules);
    const { auth } = await setupOwner(t);
    const a = await t.mutation(trial.passForReport, auth);
    const b = await t.mutation(trial.passForReport, auth);
    expect(a.code).toMatch(/^GG-[A-Z2-9]{4}-[A-Z2-9]{3}$/);
    expect(b.code).toBe(a.code);
    expect(await t.query(trial.passStatus, auth)).toMatchObject({ state: "ready", code: a.code });
  });

  it("opens view-only data for 24 hours from first use, logs it, and never makes another code", async () => {
    const t = convexTest(schema, modules);
    const { auth } = await setupOwner(t);
    const { code } = await t.mutation(trial.passForReport, auth);

    vi.setSystemTime(new Date("2026-10-25T09:00:00Z")); // the doctor reads the PDF days later
    const r = await t.mutation(trial.redeem, { serverSecret: SECRET, code: code.toLowerCase() });
    expect(r).toMatchObject({ ok: true, patientName: "Bella", expiresAt: Date.parse("2026-10-26T09:00:00Z") });

    const prof = await t.query(trial.trialProfile, { serverSecret: SECRET, code });
    expect(prof?.profile.childName).toBe("Bella");
    const g = await t.query(trial.trialGlucose, { serverSecret: SECRET, code, fromTimestamp: "2026-10-22T00:00:00Z", toTimestamp: "2026-10-23T00:00:00Z" });
    expect(g?.readings).toHaveLength(1);

    const profile = await t.query(api.patientProfile.get, auth);
    expect(profile?.accessLog?.at(-1)?.action).toMatch(/opened the Doctor Portal pass/);

    // A second visit inside the window works and doesn't restart the clock.
    vi.setSystemTime(new Date("2026-10-26T08:00:00Z"));
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code })).toMatchObject({ ok: true, expiresAt: Date.parse("2026-10-26T09:00:00Z") });

    vi.setSystemTime(new Date("2026-10-26T09:00:01Z"));
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code })).toEqual({ ok: false, reason: "expired" });
    expect(await t.query(trial.trialProfile, { serverSecret: SECRET, code })).toBeNull();

    // Used once: later reports carry no code.
    expect(await t.mutation(trial.passForReport, auth)).toEqual({ code: null });
    expect(await t.query(trial.passStatus, auth)).toMatchObject({ state: "used" });
  });

  it("replaces an unused code after 30 days", async () => {
    const t = convexTest(schema, modules);
    const { auth } = await setupOwner(t);
    const first = await t.mutation(trial.passForReport, auth);
    vi.setSystemTime(new Date(Date.parse("2026-10-22T12:00:00Z") + 31 * DAY));
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code: first.code })).toEqual({ ok: false, reason: "expired" });
    const second = await t.mutation(trial.passForReport, auth);
    expect(second.code).not.toBe(first.code);
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code: second.code })).toMatchObject({ ok: true });
  });

  it("the family can turn it off, and then it never works or comes back", async () => {
    const t = convexTest(schema, modules);
    const { auth } = await setupOwner(t);
    const { code } = await t.mutation(trial.passForReport, auth);
    await t.mutation(trial.redeem, { serverSecret: SECRET, code });
    await t.mutation(trial.turnOffPass, auth);
    expect(await t.query(trial.trialProfile, { serverSecret: SECRET, code })).toBeNull();
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code })).toEqual({ ok: false, reason: "invalid" });
    expect(await t.mutation(trial.passForReport, auth)).toEqual({ code: null });
  });

  it("turning it off before any report means no code is ever printed", async () => {
    const t = convexTest(schema, modules);
    const { auth } = await setupOwner(t);
    await t.mutation(trial.turnOffPass, auth);
    expect(await t.mutation(trial.passForReport, auth)).toEqual({ code: null });
    expect(await t.query(trial.passStatus, auth)).toEqual({ state: "off" });
  });

  it("rejects wrong codes and the wrong server secret", async () => {
    const t = convexTest(schema, modules);
    await setupOwner(t);
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code: "GG-AAAA-AAA" })).toEqual({ ok: false, reason: "invalid" });
    expect(await t.mutation(trial.redeem, { serverSecret: SECRET, code: "nope" })).toEqual({ ok: false, reason: "invalid" });
    await expect(t.mutation(trial.redeem, { serverSecret: "wrong", code: "GG-AAAA-AAA" })).rejects.toThrow();
  });
});
