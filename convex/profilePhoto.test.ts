import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { isValidSharedPhoto, shareablePhoto } from "./profilePhoto";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoApi = (api as any).profilePhoto;

const PHOTO = "data:image/jpeg;base64," + "A".repeat(2000);
const PHOTO_2 = "data:image/jpeg;base64," + "B".repeat(2000);
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };

async function setup(t: ReturnType<typeof convexTest>) {
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
  await t.mutation(api.patientProfile.replace, {
    userId: owner, passwordHash: "h-owner",
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2022-01-01", profilePhotoUri: "file:///var/mobile/abc/profile.jpg" },
  });
  const dad = await t.mutation(api.auth.register, { email: "dad@example.com", passwordHash: "h-dad" });
  await t.mutation(api.patientProfile.replace, {
    userId: dad, passwordHash: "h-dad",
    profile: { childName: "", parentName: "Dad", diabetesType: "type1", dateOfBirth: "" },
  });
  const outsider = await t.mutation(api.auth.register, { email: "out@example.com", passwordHash: "h-out" });
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("careLinks", {
      patientUserId: owner, memberUserId: dad, role: "co_guardian", displayName: "Dad",
      permissions: perms, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("careAccessCodes", {
      patientUserId: owner, code: "GRANDMA1", label: "Grandma", kind: "caregiver",
      permissions: { ...perms, log: false }, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
    });
  });
  return {
    owner: { userId: owner, passwordHash: "h-owner" },
    dad: { userId: dad, passwordHash: "h-dad" },
    outsider: { userId: outsider, passwordHash: "h-out" },
  };
}

describe("shared child photo", () => {
  it("a guardian's photo reaches the co-guardian and an access-code caregiver", async () => {
    const t = convexTest(schema, modules);
    const { owner, dad } = await setup(t);
    // Before: the code session must not get the owner's device file path.
    expect((await t.query(api.careCircle.profileForAccessCode, { code: "GRANDMA1" }))?.profilePhotoUri).toBeUndefined();
    expect(await t.query(photoApi.mine, owner)).toEqual({ photo: null, updatedAt: null });

    await t.mutation(photoApi.set, { ...owner, photo: PHOTO });
    expect((await t.query(photoApi.mine, dad)).photo).toBe(PHOTO);
    expect((await t.query(api.careCircle.profileForAccessCode, { code: "GRANDMA1" }))?.profilePhotoUri).toBe(PHOTO);
    const circle = await t.query(api.careCircle.circleContext, dad);
    expect(circle?.shared?.sharedPhoto).toBe(PHOTO);
  });

  it("a co-guardian can change it for the whole circle", async () => {
    const t = convexTest(schema, modules);
    const { owner, dad } = await setup(t);
    await t.mutation(photoApi.set, { ...owner, photo: PHOTO });
    await t.mutation(photoApi.set, { ...dad, photo: PHOTO_2 });
    expect((await t.query(photoApi.mine, owner)).photo).toBe(PHOTO_2);
  });

  it("a profile save keeps the shared photo", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    await t.mutation(photoApi.set, { ...owner, photo: PHOTO });
    await t.mutation(api.patientProfile.replace, {
      ...owner,
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2022-01-01", weightLbs: 40 },
    });
    expect((await t.query(photoApi.mine, owner)).photo).toBe(PHOTO);
  });

  it("someone outside the circle only changes their own row, never the child's", async () => {
    const t = convexTest(schema, modules);
    const { owner, outsider } = await setup(t);
    await t.mutation(photoApi.set, { ...owner, photo: PHOTO });
    await expect(t.mutation(photoApi.set, { ...outsider, photo: PHOTO_2 })).rejects.toThrow(/profile/);
    expect((await t.query(photoApi.mine, owner)).photo).toBe(PHOTO);
  });

  it("rejects anything that isn't a small image", async () => {
    const t = convexTest(schema, modules);
    const { owner } = await setup(t);
    await expect(t.mutation(photoApi.set, { ...owner, photo: "file:///x.jpg" })).rejects.toThrow(/image/);
    await expect(t.mutation(photoApi.set, { ...owner, photo: "data:image/jpeg;base64," + "A".repeat(400_000) })).rejects.toThrow(/image/);
    expect(isValidSharedPhoto("data:text/html;base64,AAAA")).toBe(false);
  });

  it("only hands out photos another phone can show", () => {
    expect(shareablePhoto(undefined, "file:///var/x.jpg")).toBeUndefined();
    expect(shareablePhoto(undefined, "https://example.com/p.jpg")).toBe("https://example.com/p.jpg");
    expect(shareablePhoto(PHOTO, "file:///var/x.jpg")).toBe(PHOTO);
  });
});
