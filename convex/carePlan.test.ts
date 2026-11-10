import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const carePlan = (api as any).carePlan;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recap = (api as any).schoolRecap;
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: true };

async function setup(t: ReturnType<typeof convexTest>) {
  const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
  await t.mutation(api.patientProfile.replace, {
    userId: brian, passwordHash: "h-b",
    profile: { childName: "Bella", parentName: "Brian", diabetesType: "type1", dateOfBirth: "2018-01-01" },
  });
  const wife = await t.mutation(api.auth.register, { email: "wife@example.com", passwordHash: "h-w" });
  await t.mutation(api.patientProfile.replace, {
    userId: wife, passwordHash: "h-w",
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2018-01-01" },
  });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("careLinks", {
      patientUserId: brian, memberUserId: wife, role: "co_guardian", displayName: "Mom",
      permissions: perms, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "HOLLY001", label: "Holly (school nurse)", kind: "caregiver", permissions: perms,
      // School hours, Mon to Fri, 7:45 AM to 2:50 PM New York time.
      access: { mode: "weekly", days: [1, 2, 3, 4, 5], startMinute: 465, endMinute: 890, tzOffsetMinutes: -300 },
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "KIDPHONE", label: "Bella's phone", kind: "child", permissions: perms,
      access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careShared", {
      patientUserId: brian,
      emergencyContacts: [
        { id: "c1", name: "Dad", phone: "555-0101", relation: "Father" },
        { id: "c2", name: "Mom", phone: "555-0100", relation: "Mother", primary: true },
      ],
      updatedAt: now,
    });
  });
  return { brian: { userId: brian, passwordHash: "h-b" }, wife: { userId: wife, passwordHash: "h-w" } };
}

afterEach(() => vi.useRealTimers());

const plan = { low: "1. Give 15g fast sugar\n2. Recheck in 15 minutes", high: "Water and a bathroom pass", supplies: "Nurse's office, top drawer", notes: "" };

describe("care plan", () => {
  it("a co-guardian writes it; the school nurse reads it during school hours, with who to call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z")); // Monday 10:00 AM in New York
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);
    expect((await t.query(carePlan.get, brian)).plan).toBeNull();
    await t.mutation(carePlan.save, { ...wife, ...plan, recheckMinutes: 20 });

    const mine = await t.query(carePlan.get, brian);
    expect(mine).toMatchObject({ canEdit: true, childName: "Bella", recheckMinutes: 20, plan: { ...plan, updatedByName: "Mom" } });

    const holly = await t.query(carePlan.get, { code: "holly001" });
    expect(holly).toMatchObject({ canEdit: false, childName: "Bella", recheckMinutes: 20, plan: { low: plan.low } });
    expect(holly.contacts.map((c: { name: string }) => c.name)).toEqual(["Mom", "Dad"]);
  });

  it("caregivers can't change it; kid codes and after-hours codes can't see it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(carePlan.save, { ...brian, ...plan });
    await expect(t.mutation(carePlan.save, { code: "HOLLY001", ...plan, low: "changed" })).rejects.toThrow();
    expect(await t.query(carePlan.get, { code: "KIDPHONE" })).toBeNull();
    vi.setSystemTime(new Date("2026-11-10T02:00:00Z")); // 9:00 PM: outside school hours
    expect(await t.query(carePlan.get, { code: "HOLLY001" })).toBeNull();
  });
});

describe("day recap", () => {
  it("the nurse schedules it for when school ends; it goes to the parents, who see it once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T18:00:00Z")); // 1:00 PM in New York
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);

    const before = await t.query(recap.forCaregiver, { code: "HOLLY001", tzOffsetMinutes: -300 });
    expect(before.window).toEqual({ startMs: Date.parse("2026-11-09T12:45:00Z"), endMs: Date.parse("2026-11-09T19:50:00Z") });
    expect(before.latest).toBeNull();

    const sent = await t.mutation(recap.send, { code: "HOLLY001", tzOffsetMinutes: -300, note: "Low before PE. Please send more tabs.", sendNow: false });
    expect(sent.sendAt).toBe(Date.parse("2026-11-09T19:50:00Z"));
    expect(await t.query(recap.forFamily, brian)).toBeNull(); // not out yet

    vi.setSystemTime(new Date("2026-11-09T19:51:00Z"));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const mom = await t.query(recap.forFamily, wife);
    expect(mom).toMatchObject({ fromName: "Holly (school nurse)", note: "Low before PE. Please send more tabs.", seenByMe: false });
    await t.mutation(recap.markSeen, { ...wife, id: mom.id });
    expect((await t.query(recap.forFamily, wife)).seenByMe).toBe(true);
    expect((await t.query(recap.forFamily, brian)).seenByMe).toBe(false);

    // School's out, so the nurse's code is closed now; the record shows it went out and who saw it.
    expect(await t.query(recap.forCaregiver, { code: "HOLLY001", tzOffsetMinutes: -300 })).toBeNull();
    const row = await t.run(async (ctx) => (await ctx.db.query("schoolRecaps").collect())[0]!);
    expect(row.sentAt).toBeGreaterThanOrEqual(Date.parse("2026-11-09T19:50:00Z"));
    expect(row.seen.map((s) => s.name)).toEqual(["Mom"]);
  });

  it("a waiting recap can be taken back or replaced; kid codes can't send one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T18:00:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    const first = await t.mutation(recap.send, { code: "HOLLY001", tzOffsetMinutes: -300, note: "first", sendNow: false });
    await t.mutation(recap.send, { code: "HOLLY001", tzOffsetMinutes: -300, note: "second", sendNow: false });
    const waiting = await t.query(recap.forCaregiver, { code: "HOLLY001", tzOffsetMinutes: -300 });
    expect(waiting.latest.note).toBe("second");
    expect(waiting.latest.id).not.toBe(first.id);
    expect(await t.mutation(recap.cancel, { code: "HOLLY001", id: waiting.latest.id })).toBe(true);
    expect((await t.query(recap.forCaregiver, { code: "HOLLY001", tzOffsetMinutes: -300 })).latest).toBeNull();
    await expect(t.mutation(recap.send, { code: "KIDPHONE", tzOffsetMinutes: -300, note: "", sendNow: true })).rejects.toThrow();
    expect(await t.query(recap.forFamily, brian)).toBeNull();
  });
});
