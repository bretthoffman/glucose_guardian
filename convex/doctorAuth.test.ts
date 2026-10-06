import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-doctor-api-secret";
const CODE = "ABC234";
const MIN = 60 * 1000;
// scrypt at its real cost runs on every sign-in check, so these tests are slower than most.
const SLOW = { timeout: 60_000 };

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest>;

const invite = (t: T, email: string) => t.action(internal.doctorAuthActions.createInvite, { email });

const register = (t: T, inviteCode: string, email: string, passwordHash = "pw-secret", clientIp?: string) =>
  t.action(api.doctorAuthActions.registerWithInvite, {
    serverSecret: SECRET,
    inviteCode,
    email,
    passwordHash,
    displayName: "Dr. Lee",
    lastName: "Lee",
    ...(clientIp ? { clientIp } : {}),
  });

const login = (t: T, email: string, passwordHash: string, clientIp?: string) =>
  t.action(api.doctorAuthActions.login, {
    serverSecret: SECRET,
    email,
    passwordHash,
    ...(clientIp ? { clientIp } : {}),
  });

const account = (t: T, email: string) =>
  t.run(async (ctx: any) =>
    ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .unique(),
  );

async function legacyDoctor(t: T, email: string, passwordHash: string) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("doctorAccounts", {
      email,
      passwordHash,
      displayName: "Dr. Old",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

describe("sign-up is by invitation only", () => {
  it("an invite works once, only for its email, and the account stores a scrypt digest", async () => {
    const t = convexTest(schema, modules);
    const { inviteCode, email } = await invite(t, "  Dr.Lee@Clinic.org ");
    expect(email).toBe("dr.lee@clinic.org");
    expect(inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Only a hash of the code is stored.
    const stored = await t.run(async (ctx: any) => ctx.db.query("doctorInvites").collect());
    expect(JSON.stringify(stored)).not.toContain(inviteCode.replace(/-/g, ""));

    expect(await register(t, inviteCode, "someone.else@clinic.org")).toEqual({ result: "invalid_invite" });
    expect(await register(t, "ZZZZ-ZZZZ-ZZZZ", "dr.lee@clinic.org")).toEqual({ result: "invalid_invite" });
    // Codes are forgiving about case and dashes; emails about case and spaces.
    const created = await register(t, inviteCode.toLowerCase().replace(/-/g, " "), " DR.LEE@clinic.org");
    expect(created.result).toBe("ok");

    const doctor = await account(t, "dr.lee@clinic.org");
    expect(doctor.passwordHash).toBeUndefined();
    expect(doctor.passwordDigest).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(doctor.passwordDigest).not.toContain("pw-secret");

    expect(await register(t, inviteCode, "dr.lee@clinic.org")).toEqual({ result: "invalid_invite" });
    expect(await t.query(internal.doctorAuth.internal.listInvites, {})).toMatchObject([
      { email: "dr.lee@clinic.org", status: "used" },
    ]);
    await expect(invite(t, "dr.lee@clinic.org")).rejects.toThrow(/already has a doctor account/);
  }, SLOW);

  it("invites expire, a newer invite replaces an older one, and they can be revoked", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const first = await invite(t, "a@clinic.org");
    const second = await invite(t, "a@clinic.org");
    expect(await register(t, first.inviteCode, "a@clinic.org")).toEqual({ result: "invalid_invite" });

    vi.setSystemTime(Date.now() + 14 * 24 * 60 * MIN + 1);
    expect(await register(t, second.inviteCode, "a@clinic.org")).toEqual({ result: "invalid_invite" });

    const third = await invite(t, "b@clinic.org");
    expect(await t.mutation(internal.doctorAuth.internal.revokeInvites, { email: "B@clinic.org" })).toEqual({
      email: "b@clinic.org",
      revoked: 1,
    });
    expect(await register(t, third.inviteCode, "b@clinic.org")).toEqual({ result: "invalid_invite" });
    expect(await account(t, "a@clinic.org")).toBeNull();
  });

  it("wrong invite codes lock the caller's IP after 10 an hour", async () => {
    const t = convexTest(schema, modules);
    const real = await invite(t, "c@clinic.org");
    for (let i = 0; i < 10; i++) {
      expect(await register(t, `BAD${i}-AAAA-AAAA`, "c@clinic.org", "pw", "203.0.113.9")).toEqual({
        result: "invalid_invite",
      });
    }
    const locked = await register(t, real.inviteCode, "c@clinic.org", "pw", "203.0.113.9");
    expect(locked.result).toBe("locked");
    // Someone else (another IP) isn't affected.
    expect((await register(t, real.inviteCode, "c@clinic.org", "pw", "198.51.100.4")).result).toBe("ok");
  }, SLOW);
});

describe("doctor sign-in", () => {
  it("checks the scrypt digest and never returns password material", async () => {
    const t = convexTest(schema, modules);
    const { inviteCode } = await invite(t, "dr.kim@clinic.org");
    await register(t, inviteCode, "dr.kim@clinic.org", "right-secret");

    const ok = await login(t, "Dr.Kim@clinic.org", "right-secret");
    expect(ok).toMatchObject({ result: "ok", doctor: { email: "dr.kim@clinic.org", displayName: "Dr. Lee" } });
    expect(JSON.stringify(ok)).not.toMatch(/scrypt|right-secret|passwordHash|passwordDigest/);
    expect(await login(t, "dr.kim@clinic.org", "wrong-secret")).toEqual({ result: "invalid" });
    expect(await login(t, "nobody@clinic.org", "right-secret")).toEqual({ result: "invalid" });
  }, SLOW);

  it("upgrades a pre-scrypt account at its next sign-in", async () => {
    const t = convexTest(schema, modules);
    await legacyDoctor(t, "old@clinic.org", "6767");

    expect((await login(t, "old@clinic.org", "6767")).result).toBe("ok");
    const upgraded = await account(t, "old@clinic.org");
    expect(upgraded.passwordHash).toBeUndefined();
    expect(upgraded.passwordDigest).toMatch(/^scrypt\$/);
    expect((await login(t, "old@clinic.org", "6767")).result).toBe("ok");
    expect(await login(t, "old@clinic.org", "nope")).toEqual({ result: "invalid" });
    // The legacy check no longer matches an upgraded account.
    expect(
      await t.query(api.doctorAccounts.login, { serverSecret: SECRET, email: "old@clinic.org", passwordHash: "6767" }),
    ).toBeNull();
  }, SLOW);

  it("five wrong passwords lock the account for 15 minutes — even with the right one", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await legacyDoctor(t, "lock@clinic.org", "right");

    for (let i = 0; i < 5; i++) expect(await login(t, "lock@clinic.org", `wrong${i}`)).toEqual({ result: "invalid" });
    const locked = await login(t, "lock@clinic.org", "right");
    expect(locked).toMatchObject({ result: "locked" });
    expect((locked as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(14 * MIN);

    vi.setSystemTime(Date.now() + 15 * MIN + 1);
    expect((await login(t, "lock@clinic.org", "right")).result).toBe("ok");
    // A success clears the account's count.
    for (let i = 0; i < 4; i++) await login(t, "lock@clinic.org", `wrong${i}`);
    expect((await login(t, "lock@clinic.org", "right")).result).toBe("ok");
  }, SLOW);

  it("emails without an account lock the same way, so lockouts don't reveal who has one", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) await login(t, "ghost@clinic.org", `guess${i}`);
    expect(await login(t, "ghost@clinic.org", "guess")).toMatchObject({ result: "locked" });
  }, SLOW);

  it("30 failures from one IP lock that IP for every account", async () => {
    const t = convexTest(schema, modules);
    await legacyDoctor(t, "real@clinic.org", "right");
    // 29 earlier failures across other accounts, then one more.
    await t.run(async (ctx: any) =>
      ctx.db.insert("doctorAuthThrottle", { key: "login:ip:203.0.113.7", failures: 29, windowStart: Date.now() }),
    );
    expect(await login(t, "someone@clinic.org", "guess", "203.0.113.7")).toEqual({ result: "invalid" });
    expect(await login(t, "real@clinic.org", "right", "203.0.113.7")).toMatchObject({ result: "locked" });
    expect((await login(t, "real@clinic.org", "right", "198.51.100.4")).result).toBe("ok");
  }, SLOW);
});

describe("one-time password migration", () => {
  it("gives every remaining pre-scrypt account a digest that the same password still matches", async () => {
    const t = convexTest(schema, modules);
    await legacyDoctor(t, "one@clinic.org", "secret-1");
    await legacyDoctor(t, "two@clinic.org", "secret-2");
    const { inviteCode } = await invite(t, "new@clinic.org");
    await register(t, inviteCode, "new@clinic.org", "secret-3");

    expect(await t.action(internal.doctorAuthActions.migrateLegacyPasswords, {})).toEqual({ migrated: 2 });
    const rows = await t.run(async (ctx: any) => ctx.db.query("doctorAccounts").collect());
    expect(rows.every((r: any) => r.passwordHash === undefined && r.passwordDigest?.startsWith("scrypt$"))).toBe(true);
    expect((await login(t, "one@clinic.org", "secret-1")).result).toBe("ok");
    expect((await login(t, "two@clinic.org", "secret-2")).result).toBe("ok");
    expect(await t.action(internal.doctorAuthActions.migrateLegacyPasswords, {})).toEqual({ migrated: 0 });
  }, SLOW);
});

describe("patient linking limits", () => {
  async function seed(t: T) {
    return await t.run(async (ctx: any) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "p@example.com", createdAt: now, updatedAt: now });
      await ctx.db.insert("patientProfiles", {
        userId,
        childName: "Bella",
        diabetesType: "type1",
        dateOfBirth: "2014-01-01",
        doctorCode: CODE,
        updatedAt: now,
      });
      const doctor = async (email: string) =>
        ctx.db.insert("doctorAccounts", { email, displayName: "Dr. X", createdAt: now, updatedAt: now });
      return { a: await doctor("a@clinic.org"), b: await doctor("b@clinic.org") };
    });
  }
  const link = (t: T, doctorId: any, accessCode: string, clientIp?: string) =>
    t.mutation(api.doctorAccounts.linkPatient, {
      serverSecret: SECRET,
      doctorId,
      accessCode,
      ...(clientIp ? { clientIp } : {}),
    });

  it("10 wrong codes in an hour lock that doctor's linking (the count isn't rolled back)", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await seed(t);
    for (let i = 0; i < 10; i++) {
      expect(await link(t, a, `ZZZ${String(i).padStart(3, "2")}`)).toEqual({ ok: false, reason: "unknown" });
    }
    expect(await link(t, a, CODE)).toMatchObject({ ok: false, reason: "locked" });
    const other = await link(t, b, CODE);
    expect(other).toMatchObject({ ok: true, link: { accessCode: CODE, displayName: "Bella", alreadyLinked: false } });
    expect(await link(t, b, CODE.toLowerCase())).toMatchObject({ ok: true, link: { alreadyLinked: true } });
  });

  it("20 wrong codes from one IP lock that IP for every doctor", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await seed(t);
    await t.run(async (ctx: any) =>
      ctx.db.insert("doctorAuthThrottle", { key: "link:ip:203.0.113.5", failures: 19, windowStart: Date.now() }),
    );
    expect(await link(t, a, "ZZZ222", "203.0.113.5")).toEqual({ ok: false, reason: "unknown" });
    expect(await link(t, b, CODE, "203.0.113.5")).toMatchObject({ ok: false, reason: "locked" });
    expect((await link(t, b, CODE, "198.51.100.4")).ok).toBe(true);
  });
});

describe("doctor sessions", () => {
  it("end 12 hours after sign-in, even when issued with a longer expiry", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const doctorId = await t.run(async (ctx: any) =>
      ctx.db.insert("doctorAccounts", { email: "s@clinic.org", displayName: "Dr. S", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    await t.mutation(api.doctorAccounts.createSession, {
      serverSecret: SECRET,
      doctorId,
      tokenHash: "h1",
      expiresAt: Date.now() + 30 * 24 * 60 * MIN,
    });
    const check = () => t.query(api.doctorAccounts.validateSession, { serverSecret: SECRET, tokenHash: "h1" });
    expect(await check()).toEqual({ doctorId });
    vi.setSystemTime(Date.now() + 12 * 60 * MIN - 1000);
    expect(await check()).toEqual({ doctorId });
    vi.setSystemTime(Date.now() + 2000);
    expect(await check()).toBeNull();
  });
});

describe("removing a doctor account", () => {
  it("signs it out everywhere and removes its links and alerts, keeping the audit log", async () => {
    const t = convexTest(schema, modules);
    const { inviteCode } = await invite(t, "gone@clinic.org");
    await register(t, inviteCode, "gone@clinic.org", "pw-secret");
    const doctorId = (await account(t, "gone@clinic.org"))._id;
    await t.mutation(api.doctorAccounts.createSession, {
      serverSecret: SECRET,
      doctorId,
      tokenHash: "tok",
      expiresAt: Date.now() + 60 * MIN,
    });
    await t.run(async (ctx: any) => {
      const now = Date.now();
      await ctx.db.insert("doctorPatientLinks", { doctorId, accessCode: CODE, linkedAt: now });
      await ctx.db.insert("doctorAlerts", { doctorId, accessCode: CODE, kind: "stale_data", message: "x", createdAt: now });
      await ctx.db.insert("doctorAccessLogs", { doctorId, accessCode: CODE, action: "viewed", createdAt: now });
    });
    const remove = (email: string, force?: boolean) =>
      t.mutation(internal.doctorAuth.internal.removeDoctorAccount, { email, ...(force ? { force } : {}) });

    // Still has a patient: refused unless forced.
    expect(await remove("gone@clinic.org")).toMatchObject({ removed: false, reason: expect.stringMatching(/has 1 patient/) });
    expect(await remove(" Gone@Clinic.org ", true)).toEqual({
      email: "gone@clinic.org",
      removed: true,
      sessionsEnded: 1,
      patientLinks: 1,
      alerts: 1,
    });

    expect(await account(t, "gone@clinic.org")).toBeNull();
    expect(await t.query(api.doctorAccounts.validateSession, { serverSecret: SECRET, tokenHash: "tok" })).toBeNull();
    expect(await login(t, "gone@clinic.org", "pw-secret")).toEqual({ result: "invalid" });
    const left = await t.run(async (ctx: any) => ({
      links: (await ctx.db.query("doctorPatientLinks").collect()).length,
      alerts: (await ctx.db.query("doctorAlerts").collect()).length,
      accessLogs: (await ctx.db.query("doctorAccessLogs").collect()).length,
    }));
    expect(left).toEqual({ links: 0, alerts: 0, accessLogs: 1 });
    expect(await remove("gone@clinic.org")).toMatchObject({ removed: false, reason: "no such account" });
  }, SLOW);
});
