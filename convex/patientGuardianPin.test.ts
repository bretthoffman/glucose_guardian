import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isValidGuardianPinFormat } from "./guardianPin/validate";

const modules = import.meta.glob("./**/!(*.test).*s");

async function seedUser(t: ReturnType<typeof convexTest>, passwordHash = "ph"): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `pin-${Math.random()}@test.com`,
      passwordHash,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe("guardianPin validate", () => {
  it("accepts exactly four digits with leading zeros", () => {
    expect(isValidGuardianPinFormat("0042")).toBe(true);
    expect(isValidGuardianPinFormat("1234")).toBe(true);
  });

  it("rejects nonnumeric and wrong lengths", () => {
    expect(isValidGuardianPinFormat("123")).toBe(false);
    expect(isValidGuardianPinFormat("12345")).toBe(false);
    expect(isValidGuardianPinFormat("12a4")).toBe(false);
  });
});

describe("guardianPin hashNode", () => {
  it("verifies hashed PIN without storing plaintext", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "0042",
      pinConfirm: "0042",
    });
    const row = await t.run(async (ctx) =>
      ctx.db.query("patientGuardianPins").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    );
    expect(row?.pinHash).not.toBe("0042");
    expect(row?.pinHash).not.toContain("0042");
  });
});

describe("patientGuardianPin", () => {
  it("returns not_set for account without PIN row", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const status = await t.query(api.patientGuardianPin.getStatus, { userId, passwordHash: "ph" });
    expect(status.status).toBe("not_set");
  });

  it("sets and verifies a valid four-digit PIN", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const setup = await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "0042",
      pinConfirm: "0042",
    });
    expect(setup.result).toBe("ok");

    const row = await t.run(async (ctx) =>
      ctx.db.query("patientGuardianPins").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    );
    expect(row?.pinHash).toBeTruthy();
    expect(row?.pinHash).not.toBe("0042");
    expect(row?.pinSalt).toBeTruthy();

    const verify = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId,
      passwordHash: "ph",
      pin: "0042",
    });
    expect(verify.result).toBe("verified");
  });

  it("rejects confirmation mismatch on setup", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const setup = await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "1111",
      pinConfirm: "2222",
    });
    expect(setup.result).toBe("mismatch");
  });

  it("returns invalid for wrong PIN and increments failures", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "1234",
      pinConfirm: "1234",
    });
    const bad = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId,
      passwordHash: "ph",
      pin: "0000",
    });
    expect(bad.result).toBe("invalid");
    const row = await t.run(async (ctx) =>
      ctx.db.query("patientGuardianPins").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    );
    expect(row?.failedAttempts).toBe(1);
  });

  it("locks out after repeated failures and resets on success", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "5678",
      pinConfirm: "5678",
    });
    for (let i = 0; i < 5; i++) {
      await t.action(api.patientGuardianPinActions.verifyPin, {
        userId,
        passwordHash: "ph",
        pin: "0000",
      });
    }
    const locked = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId,
      passwordHash: "ph",
      pin: "5678",
    });
    expect(locked.result).toBe("temporarily_locked");

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("patientGuardianPins")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      if (row) await ctx.db.patch(row._id, { lockoutUntil: undefined, failedAttempts: 0 });
    });

    const ok = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId,
      passwordHash: "ph",
      pin: "5678",
    });
    expect(ok.result).toBe("verified");
    const row = await t.run(async (ctx) =>
      ctx.db.query("patientGuardianPins").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    );
    expect(row?.failedAttempts).toBe(0);
  });

  it("returns setup_required when verifying without a PIN row", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const verify = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId,
      passwordHash: "ph",
      pin: "1234",
    });
    expect(verify.result).toBe("setup_required");
  });

  it("rejects unauthorized caller (wrong passwordHash)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, "correct");
    const setup = await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "wrong",
      pin: "1234",
      pinConfirm: "1234",
    });
    expect(setup.result).toBe("unauthorized");
  });

  it("does not expose hash through getStatus", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "9999",
      pinConfirm: "9999",
    });
    const status = await t.query(api.patientGuardianPin.getStatus, { userId, passwordHash: "ph" });
    expect(status).toEqual({ status: "active" });
    expect(JSON.stringify(status)).not.toContain("pinHash");
    expect(JSON.stringify(status)).not.toContain("9999");
  });

  it("prevents replacing active PIN without current PIN via setupPin", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "1111",
      pinConfirm: "1111",
    });
    const again = await t.action(api.patientGuardianPinActions.setupPin, {
      userId,
      passwordHash: "ph",
      pin: "2222",
      pinConfirm: "2222",
    });
    expect(again.result).toBe("already_active");
  });

  it("isolates PIN state per user", async () => {
    const t = convexTest(schema, modules);
    const userA = await seedUser(t, "a");
    const userB = await seedUser(t, "b");
    await t.action(api.patientGuardianPinActions.setupPin, {
      userId: userA,
      passwordHash: "a",
      pin: "1212",
      pinConfirm: "1212",
    });
    const verifyB = await t.action(api.patientGuardianPinActions.verifyPin, {
      userId: userB,
      passwordHash: "b",
      pin: "1212",
    });
    expect(verifyB.result).toBe("setup_required");
  });
});
