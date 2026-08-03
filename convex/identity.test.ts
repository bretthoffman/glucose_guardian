import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

/** A signed-in Clerk identity, as convex-test injects it into `ctx.auth.getUserIdentity()`. */
const MOM = { subject: "clerk_mom", email: "mom@example.com" };
const DAD = { subject: "clerk_dad", email: "dad@example.com" };

describe("Clerk identity path (the post-migration auth)", () => {
  it("provisions a users row from the Clerk identity and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const asMom = t.withIdentity(MOM);

    const first = await asMom.mutation(api.identity.ensureUser, {});
    expect(first.email).toBe("mom@example.com");

    // Calling again returns the SAME row — no duplicate account.
    const again = await asMom.mutation(api.identity.ensureUser, {});
    expect(again.userId).toBe(first.userId);

    const rows = await t.run(async (ctx: any) => await ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].clerkId).toBe("clerk_mom");
    expect(rows[0].passwordHash).toBeUndefined(); // Clerk accounts carry NO local password
  });

  it("lets migrated functions work with NO userId/passwordHash — identity comes from the token", async () => {
    const t = convexTest(schema, modules);
    const asMom = t.withIdentity(MOM);
    await asMom.mutation(api.identity.ensureUser, {});

    // profileFor`replace`/`get` were migrated to userCompat: no credentials passed at all.
    await asMom.mutation(api.patientProfile.replace, {
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const profile = await asMom.query(api.patientProfile.get, {});
    expect(profile?.childName).toBe("Bella");

    // A log write also resolves the author from the identity.
    await asMom.mutation(api.careLogs.addInsulinLog, {
      patientUserId: (await asMom.mutation(api.identity.ensureUser, {})).userId,
      entry: { clientId: "i1", timestamp: new Date().toISOString(), units: 2, type: "bolus" },
    });
    const logs = await asMom.query(api.careLogs.listLogs, {
      patientUserId: (await asMom.mutation(api.identity.ensureUser, {})).userId,
    });
    expect(logs?.insulinLog).toHaveLength(1);
    expect(logs?.insulinLog[0].authorName).toBe("Mom");
  });

  it("isolates identities — one Clerk user cannot read another's profile", async () => {
    const t = convexTest(schema, modules);
    const asMom = t.withIdentity(MOM);
    const asDad = t.withIdentity(DAD);
    await asMom.mutation(api.identity.ensureUser, {});
    await asDad.mutation(api.identity.ensureUser, {});

    await asMom.mutation(api.patientProfile.replace, {
      profile: { childName: "Bella", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });

    // Dad has his own (empty) profile; he sees his, never Mom's.
    expect(await asDad.query(api.patientProfile.get, {})).toBeNull();
    expect((await asMom.query(api.patientProfile.get, {}))?.childName).toBe("Bella");

    // Two distinct rows exist.
    const rows = await t.run(async (ctx: any) => await ctx.db.query("users").collect());
    expect(rows).toHaveLength(2);
  });

  it("an unauthenticated request cannot provision or read", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.identity.ensureUser, {})).rejects.toThrow();
    // A migrated query with no identity + no legacy creds resolves to no user → null/empty.
    expect(await t.query(api.patientProfile.get, {})).toBeNull();
  });

  it("links a pre-Clerk row by email on first sign-in (preserves its data if we ever keep accounts)", async () => {
    const t = convexTest(schema, modules);
    // Simulate a legacy row: same email, has a passwordHash, no clerkId.
    const legacyId = await t.run(async (ctx: any) =>
      await ctx.db.insert("users", {
        email: "mom@example.com",
        passwordHash: "legacy-hash",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const res = await t.withIdentity(MOM).mutation(api.identity.ensureUser, {});
    expect(res.userId).toBe(legacyId); // attached, not duplicated

    const rows = await t.run(async (ctx: any) => await ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].clerkId).toBe("clerk_mom");
  });
});

describe("abandoning an unfinished sign-up", () => {
  it("deletes the account when setup never finished, freeing the email to sign up again", async () => {
    const t = convexTest(schema, modules);
    const asMom = t.withIdentity(MOM);
    await asMom.mutation(api.identity.ensureUser, {});
    expect(await t.run(async (ctx: any) => (await ctx.db.query("users").collect()).length)).toBe(1);

    const res = await asMom.mutation(api.identity.discardUnfinishedAccount, {});
    expect(res.deleted).toBe(true);
    expect(await t.run(async (ctx: any) => await ctx.db.query("users").collect())).toEqual([]);

    // The SAME email signs up cleanly afterwards — a brand-new row, no leftovers.
    const fresh = await t.withIdentity({ subject: "clerk_mom_2", email: "mom@example.com" })
      .mutation(api.identity.ensureUser, {});
    expect(fresh.email).toBe("mom@example.com");
    const rows = await t.run(async (ctx: any) => await ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].clerkId).toBe("clerk_mom_2");
  });

  it("REFUSES to delete once setup completed — a finished account can never be dropped this way", async () => {
    const t = convexTest(schema, modules);
    const asMom = t.withIdentity(MOM);
    await asMom.mutation(api.identity.ensureUser, {});
    await asMom.mutation(api.patientProfile.replace, {
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });

    const res = await asMom.mutation(api.identity.discardUnfinishedAccount, {});
    expect(res).toEqual({ deleted: false, reason: "setup_complete" });
    expect(await t.run(async (ctx: any) => (await ctx.db.query("users").collect()).length)).toBe(1);
  });

  it("only ever touches the caller's own account", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(MOM).mutation(api.identity.ensureUser, {});
    await t.withIdentity(DAD).mutation(api.identity.ensureUser, {});

    await t.withIdentity(DAD).mutation(api.identity.discardUnfinishedAccount, {});
    const rows = await t.run(async (ctx: any) => await ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].clerkId).toBe("clerk_mom");
  });

  it("does nothing when nobody is signed in", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.identity.discardUnfinishedAccount, {});
    expect(res).toEqual({ deleted: false, reason: "not_signed_in" });
  });
});
