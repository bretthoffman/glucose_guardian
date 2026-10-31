import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { cleanShortcutIds } from "./shortcuts";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shortcuts = (api as any).shortcuts;
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };

describe("shortcuts", () => {
  it("each person keeps their own list, accounts and codes alike", async () => {
    const t = convexTest(schema, modules);
    const mom = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: "h-m" });
    const dad = await t.mutation(api.auth.register, { email: "dad@example.com", passwordHash: "h-d" });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("careAccessCodes", {
        patientUserId: dad, code: "HOLLY001", label: "Holly", kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
    });
    const momArgs = { userId: mom, passwordHash: "h-m" };
    expect(await t.query(shortcuts.mine, momArgs)).toBeNull();
    await t.mutation(shortcuts.set, { ...momArgs, ids: ["doctor", "logs", "messages"] });
    expect(await t.query(shortcuts.mine, momArgs)).toEqual(["doctor", "logs", "messages"]);
    expect(await t.query(shortcuts.mine, { userId: dad, passwordHash: "h-d" })).toBeNull();
    await t.mutation(shortcuts.set, { code: "holly001", ids: ["logs"] });
    expect(await t.query(shortcuts.mine, { code: "HOLLY001" })).toEqual(["logs"]);
    await t.mutation(shortcuts.set, { ...momArgs, ids: [] });
    expect(await t.query(shortcuts.mine, momArgs)).toEqual([]);
    expect(await t.query(shortcuts.mine, { code: "NOPE0000" })).toBeNull();
  });

  it("drops junk and duplicates and caps the list at 8", () => {
    expect(cleanShortcutIds(["logs", "logs", "bad id", "", "doctor"])).toEqual(["logs", "doctor"]);
    expect(cleanShortcutIds(["a", "b", "c", "d", "e", "f", "g", "h", "i"]).length).toBe(8);
  });
});
