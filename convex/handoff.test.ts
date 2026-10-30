import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { noteIsFor } from "./handoff";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handoff = (api as any).handoff;
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };

async function setup(t: ReturnType<typeof convexTest>) {
  const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
  await t.mutation(api.patientProfile.replace, {
    userId: brian, passwordHash: "h-b",
    profile: { childName: "Bella", parentName: "Brian", diabetesType: "type1", dateOfBirth: "2022-01-01" },
  });
  const wife = await t.mutation(api.auth.register, { email: "wife@example.com", passwordHash: "h-w" });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("careLinks", {
      patientUserId: brian, memberUserId: wife, role: "co_guardian", displayName: "Mom",
      permissions: perms, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    for (const [code, label] of [["HOLLY001", "Holly"], ["ANDREA01", "Andrea"]] as const) {
      await ctx.db.insert("careAccessCodes", {
        patientUserId: brian, code, label, kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
    }
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "KIDPHONE", label: "Bella's phone", kind: "child", permissions: perms,
      access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
  });
  return { brian: { userId: brian, passwordHash: "h-b" }, wife: { userId: wife, passwordHash: "h-w" } };
}

afterEach(() => vi.useRealTimers());

describe("handoff notes", () => {
  it("a parent's note reaches only the caregivers it's addressed to, and shows who saw it", async () => {
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(handoff.leaveNote, { ...brian, text: "Rough night, extra snack in her backpack", recipientCodes: ["holly001"] });
    const holly = await t.query(handoff.forMe, { code: "HOLLY001" });
    expect(holly.note).toMatchObject({ text: "Rough night, extra snack in her backpack", fromName: "Brian" });
    expect(holly.you).toBe("Holly");
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).note).toBeNull();
    await t.mutation(handoff.markSeen, { code: "HOLLY001", noteId: holly.note.id });
    await t.mutation(handoff.markSeen, { code: "HOLLY001", noteId: holly.note.id });
    const mine = await t.query(handoff.forMe, brian);
    expect(mine.sent.seen.map((s: any) => s.name)).toEqual(["Holly"]);
  });

  it("a caregiver's note goes back to the whole family, co-guardians included", async () => {
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);
    await t.mutation(handoff.leaveNote, { code: "HOLLY001", text: "Ate all her lunch. PE at 1:30, felt fine." });
    expect((await t.query(handoff.forMe, brian)).note).toMatchObject({ fromName: "Holly" });
    expect((await t.query(handoff.forMe, wife)).note).toMatchObject({ text: "Ate all her lunch. PE at 1:30, felt fine." });
    // Caregivers don't see each other's notes to the family.
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).note).toBeNull();
  });

  it("a new note replaces the old one, an empty note clears it, and notes expire after a day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(handoff.leaveNote, { ...brian, text: "First" });
    await t.mutation(handoff.leaveNote, { ...brian, text: "Second" });
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).note.text).toBe("Second");
    vi.setSystemTime(new Date("2026-10-30T12:30:00Z"));
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).note).toBeNull();
    await t.mutation(handoff.leaveNote, { ...brian, text: "Third" });
    await t.mutation(handoff.leaveNote, { ...brian, text: "   " });
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).note).toBeNull();
  });

  it("the child's own phone and unknown codes get nothing", async () => {
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(handoff.leaveNote, { ...brian, text: "Hi" });
    expect(await t.query(handoff.forMe, { code: "KIDPHONE" })).toBeNull();
    expect(await t.query(handoff.forMe, { code: "NOPE0000" })).toBeNull();
    await expect(t.mutation(handoff.leaveNote, { code: "NOPE0000", text: "x" })).rejects.toThrow(/Not signed in/);
  });

  it("the family can turn a caregiver's morning catch-up off and on; the child's phone can't be changed", async () => {
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);
    expect((await t.query(handoff.forMe, brian)).caregivers).toEqual([
      { code: "HOLLY001", name: "Holly", catchUp: true },
      { code: "ANDREA01", name: "Andrea", catchUp: true },
    ]);
    await t.mutation(handoff.setCatchUp, { ...wife, code: "andrea01", on: false });
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).catchUp).toBe(false);
    expect((await t.query(handoff.forMe, { code: "HOLLY001" })).catchUp).toBe(true);
    expect((await t.query(handoff.forMe, brian)).caregivers[1]).toMatchObject({ name: "Andrea", catchUp: false });
    await t.mutation(handoff.setCatchUp, { ...brian, code: "ANDREA01", on: true });
    expect((await t.query(handoff.forMe, { code: "ANDREA01" })).catchUp).toBe(true);
    await expect(t.mutation(handoff.setCatchUp, { ...brian, code: "KIDPHONE", on: false })).rejects.toThrow(/not found/);
  });

  it("a caregiver can't change anyone's catch-up", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await expect(t.mutation(handoff.setCatchUp, { code: "HOLLY001", on: false })).rejects.toThrow();
  });

  it("a personal account (managing their own care) gets no handoff, nor do its codes", async () => {
    const t = convexTest(schema, modules);
    const me = await t.mutation(api.auth.register, { email: "adult@example.com", passwordHash: "h-a" });
    await t.mutation(api.patientProfile.replace, {
      userId: me, passwordHash: "h-a",
      profile: { childName: "John", parentName: "John", accountRole: "adult", diabetesType: "type1", dateOfBirth: "1990-01-01" },
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("careAccessCodes", {
        patientUserId: me, code: "SPOUSE01", label: "Spouse", kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
    });
    expect(await t.query(handoff.forMe, { userId: me, passwordHash: "h-a" })).toBeNull();
    expect(await t.query(handoff.forMe, { code: "SPOUSE01" })).toBeNull();
    await expect(t.mutation(handoff.leaveNote, { userId: me, passwordHash: "h-a", text: "x" })).rejects.toThrow(/Not signed in/);
  });

  it("addresses notes by code, ignoring case and spacing", () => {
    expect(noteIsFor(undefined, "HOLLY001")).toBe(true);
    expect(noteIsFor([], "HOLLY001")).toBe(true);
    expect(noteIsFor(["holly-001"], "HOLLY001")).toBe(true);
    expect(noteIsFor(["ANDREA01"], "HOLLY001")).toBe(false);
  });
});
