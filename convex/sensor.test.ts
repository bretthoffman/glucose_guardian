import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { libreSensorStartMs } from "./cgm/providers";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sensor = (api as any).sensor;
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: true };
const DAY = 24 * 3_600_000;

async function setup(t: ReturnType<typeof convexTest>) {
  const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
  await t.mutation(api.patientProfile.replace, {
    userId: brian, passwordHash: "h-b",
    profile: { childName: "Bella", parentName: "Brian", diabetesType: "type1", dateOfBirth: "2018-01-01" },
  });
  const wife = await t.mutation(api.auth.register, { email: "wife@example.com", passwordHash: "h-w" });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("careLinks", {
      patientUserId: brian, memberUserId: wife, role: "co_guardian", displayName: "Mom",
      permissions: perms, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "HOLLY001", label: "Holly", kind: "caregiver", permissions: perms,
      access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "GRANDMA1", label: "Grandma", kind: "caregiver", permissions: { ...perms, log: false },
      access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
  });
  return { brian: { userId: brian, passwordHash: "h-b" }, wife: { userId: wife, passwordHash: "h-w" } };
}

afterEach(() => vi.useRealTimers());

describe("sensor countdown", () => {
  it("one parent marks a new sensor; everyone in the circle sees it; the box counts down", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:30:00Z"));
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);
    await t.mutation(sensor.setSupply, { ...brian, sensorsLeft: 3 });
    const startedAt = Date.parse("2026-11-10T12:12:00Z");
    await t.mutation(sensor.start, { ...wife, kind: "g7", startedAt, site: "Left arm", tzOffsetMinutes: -300 });

    const mine = await t.query(sensor.current, brian);
    expect(mine).toMatchObject({ childName: "Bella", canEdit: true, sensorsLeft: 2, recentSites: ["Left arm"] });
    expect(mine.sensor).toMatchObject({ kind: "g7", startedAt, site: "Left arm", setByName: "Mom", source: "manual", endedAt: null });
    expect((await t.query(sensor.current, { code: "HOLLY001" })).sensor.startedAt).toBe(startedAt);

    // Grandma can see it but not change it; Holly (Add logs on) can.
    expect((await t.query(sensor.current, { code: "GRANDMA1" })).canEdit).toBe(false);
    await expect(t.mutation(sensor.endEarly, { code: "GRANDMA1" })).rejects.toThrow();
    await t.mutation(sensor.update, { code: "HOLLY001", kind: "g7_15", tzOffsetMinutes: -300 });
    expect((await t.query(sensor.current, brian)).sensor.kind).toBe("g7_15");

    await t.mutation(sensor.endEarly, brian);
    const ended = await t.query(sensor.current, brian);
    expect(ended.sensor).toMatchObject({ endedEarly: true });
    expect(ended.sensor.endedAt).not.toBeNull();
  });

  it("a scanned sensor keeps its serial and expiration; only people who can change it see the pairing code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:30:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    const startedAt = Date.parse("2026-11-10T12:12:00Z");
    await t.mutation(sensor.start, {
      ...brian, kind: "g7", startedAt, tzOffsetMinutes: -300,
      gtin: "00386270003935", serial: "823366645062", pairingCode: "2165", expiresOn: "2027-10-31",
    });
    expect((await t.query(sensor.current, brian)).sensor).toMatchObject({ serial: "823366645062", pairingCode: "2165", expiresOn: "2027-10-31" });
    expect((await t.query(sensor.current, { code: "HOLLY001" })).sensor.pairingCode).toBe("2165");
    const grandma = (await t.query(sensor.current, { code: "GRANDMA1" })).sensor;
    expect(grandma.serial).toBe("823366645062");
    expect(grandma.pairingCode).toBeNull();
    // Changing the time alone keeps the scanned details.
    await t.mutation(sensor.update, { ...brian, startedAt: startedAt - 60_000, tzOffsetMinutes: -300 });
    expect((await t.query(sensor.current, brian)).sensor.serial).toBe("823366645062");
    // A bad date is dropped rather than stored.
    await t.mutation(sensor.start, { ...brian, kind: "g7", startedAt: Date.now(), tzOffsetMinutes: -300, serial: "X1", expiresOn: "soon" });
    expect((await t.query(sensor.current, brian)).sensor).toMatchObject({ serial: "X1", expiresOn: null });
  });

  it("the evening before, the circle is reminded, with a reorder nudge when the box is nearly empty", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T12:30:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(sensor.setSupply, { ...brian, sensorsLeft: 2 });
    const startedAt = Date.parse("2026-11-08T12:12:00Z"); // Sun 7:12 AM New York
    await t.mutation(sensor.start, { ...brian, kind: "g7", startedAt, tzOffsetMinutes: -300 });
    const sent: { title: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] })));
    const row = await t.run(async (ctx) => (await ctx.db.query("sensorSessions").collect())[0]!);
    const job = await t.run(async (ctx) => (row.reminderId ? await ctx.db.system.get(row.reminderId) : null));
    expect(job?.scheduledTime).toBe(Date.parse("2026-11-18T01:00:00Z")); // Tue Nov 17, 8:00 PM
    // Run the reminder itself and check its words.
    await t.run(async (ctx) => {
      await ctx.db.insert("pushTokens", {
        token: "ExponentPushToken[x]", userId: brian.userId, platform: "ios",
        prefs: { glucoseUrgent: true, careLog: true, messages: true, doctor: true }, createdAt: Date.now(), updatedAt: Date.now(),
      } as never);
    });
    (globalThis.fetch as unknown as { mockImplementation: (f: (u: string, i: RequestInit) => Promise<Response>) => void }).mockImplementation(async (_u, init) => {
      for (const m of JSON.parse(String(init.body))) sent.push({ title: m.title, body: m.body });
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }));
    });
    await t.mutation(internal.sensor.remind, { sessionId: row._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent[0]).toEqual({
      title: "Bella's sensor ends tomorrow",
      body: "It ends at 7:12 AM, with a 12-hour grace period after. Only 1 left in the box, time to reorder.",
    });
  });

  it("Libre sensors count down by themselves from the readings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    const a = Date.parse("2026-11-06T09:00:00Z");
    expect(libreSensorStartMs({ connection: { sensor: { a: a / 1000 } } })).toBe(a);
    expect(libreSensorStartMs({ connection: { sensor: { a: "nope" } } })).toBeUndefined();
    await t.mutation(internal.sensor.recordLibreStart, { userId: brian.userId, startedAt: a });
    await t.mutation(internal.sensor.recordLibreStart, { userId: brian.userId, startedAt: a + 60_000 }); // same sensor
    const rows = await t.run(async (ctx) => await ctx.db.query("sensorSessions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "libre14", source: "libre" });
    // They said it's a Libre Plus: the next sensor keeps that.
    await t.mutation(sensor.update, { ...brian, kind: "libre15", tzOffsetMinutes: -300 });
    await t.mutation(internal.sensor.recordLibreStart, { userId: brian.userId, startedAt: a + 15 * DAY - 3_600_000 * 24 * 11 });
    const cur = await t.query(sensor.current, brian);
    expect(cur.sensor.kind).toBe("libre15");
  });
});
