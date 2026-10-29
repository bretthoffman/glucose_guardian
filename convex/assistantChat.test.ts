import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { chatPreview } from "./assistantChat";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chat = (api as any).assistantChat;

const msg = (id: string, role: "user" | "assistant", text: string, at: number) => ({ id, role, text, at });

async function setup(t: ReturnType<typeof convexTest>) {
  const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
  const wife = await t.mutation(api.auth.register, { email: "wife@example.com", passwordHash: "h-w" });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("careAccessCodes", {
      patientUserId: brian, code: "GRANDMA1", label: "Grandma", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: false, useCalculator: false, chat: true },
      access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
  });
  return { brian: { userId: brian, passwordHash: "h-b" }, wife: { userId: wife, passwordHash: "h-w" } };
}

describe("assistant chat history", () => {
  it("saves by day, lists days newest first, and reads a day back in order", async () => {
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await t.mutation(chat.append, { ...brian, day: "2026-10-28", messages: [msg("a", "user", "Is 180 ok after pizza?", 1), msg("b", "assistant", "Yes, it should settle.", 2)] });
    await t.mutation(chat.append, { ...brian, day: "2026-10-29", messages: [msg("c", "user", "She's still dropping", 3)] });
    await t.mutation(chat.append, { ...brian, day: "2026-10-29", messages: [msg("c", "user", "She's still dropping", 3), msg("d", "assistant", "You did the right thing.", 4)] });
    const days = await t.query(chat.days, brian);
    expect(days.map((d: any) => d.day)).toEqual(["2026-10-29", "2026-10-28"]);
    expect(days[0]).toMatchObject({ preview: "She's still dropping", count: 2 });
    const day = await t.query(chat.day, { ...brian, day: "2026-10-29" });
    expect(day.map((m: any) => m.id)).toEqual(["c", "d"]);
  });

  it("is private: a co-guardian or a code session can't see someone else's chats", async () => {
    const t = convexTest(schema, modules);
    const { brian, wife } = await setup(t);
    await t.mutation(chat.append, { ...brian, day: "2026-10-29", messages: [msg("a", "user", "4am low", 1)] });
    await t.mutation(chat.append, { code: "grandma1", day: "2026-10-29", messages: [msg("g", "user", "Can she have a cookie?", 2)] });
    expect(await t.query(chat.days, wife)).toEqual([]);
    expect(await t.query(chat.day, { ...wife, day: "2026-10-29" })).toEqual([]);
    expect((await t.query(chat.day, { code: "GRANDMA1", day: "2026-10-29" })).map((m: any) => m.id)).toEqual(["g"]);
    expect((await t.query(chat.day, { ...brian, day: "2026-10-29" })).map((m: any) => m.id)).toEqual(["a"]);
  });

  it("refuses anonymous or retired-code writes and bad days", async () => {
    const t = convexTest(schema, modules);
    const { brian } = await setup(t);
    await expect(t.mutation(chat.append, { day: "2026-10-29", messages: [msg("x", "user", "hi", 1)] })).rejects.toThrow(/Not signed in/);
    await expect(t.mutation(chat.append, { code: "NOPE0000", day: "2026-10-29", messages: [msg("x", "user", "hi", 1)] })).rejects.toThrow(/Not signed in/);
    await expect(t.mutation(chat.append, { ...brian, day: "Oct 29", messages: [msg("x", "user", "hi", 1)] })).rejects.toThrow(/Bad day/);
  });

  it("previews the first question, trimmed", () => {
    expect(chatPreview([{ role: "assistant", text: "Hi" }, { role: "user", text: "  why   is she high?" }])).toBe("why is she high?");
    expect(chatPreview([{ role: "user", text: "x".repeat(200) }]).length).toBe(90);
  });
});
