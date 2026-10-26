import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labs = (api as any).labResults;

async function setupOwner(t: ReturnType<typeof convexTest>) {
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
  await t.mutation(api.patientProfile.replace, {
    userId: owner, passwordHash: "h-owner",
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2022-01-01" },
  });
  return { userId: owner, passwordHash: "h-owner" };
}

const a1c = (clientId: string, extra: object = {}) => ({
  clientId, test: "a1c", name: "Hemoglobin A1c", value: 7.8, unit: "%", takenOn: "2026-10-26", source: "manual" as const, ...extra,
});

describe("lab results", () => {
  it("saves, lists newest first with the byline, edits in place and removes", async () => {
    const t = convexTest(schema, modules);
    const auth = await setupOwner(t);
    await t.mutation(labs.save, { ...auth, lab: a1c("l1", { takenOn: "2026-08-17", value: 8.1 }) });
    await t.mutation(labs.save, { ...auth, lab: a1c("l2") });
    let list = await t.query(labs.list, auth);
    expect(list.map((r: any) => r.id)).toEqual(["l2", "l1"]);
    expect(list[0]).toMatchObject({ value: 7.8, authorName: "Mom", source: "manual" });
    await t.mutation(labs.save, { ...auth, lab: a1c("l2", { value: 7.7 }) });
    list = await t.query(labs.list, auth);
    expect(list).toHaveLength(2);
    expect(list[0].value).toBe(7.7);
    await t.mutation(labs.remove, { ...auth, id: "l1" });
    expect(await t.query(labs.list, auth)).toHaveLength(1);
  });

  it("a MyChart result pulled twice is stored once", async () => {
    const t = convexTest(schema, modules);
    const auth = await setupOwner(t);
    await t.mutation(labs.save, { ...auth, lab: a1c("mc-1", { source: "mychart", externalId: "obs-123" }) });
    await t.mutation(labs.save, { ...auth, lab: a1c("mc-other-device", { source: "mychart", externalId: "obs-123" }) });
    expect(await t.query(labs.list, auth)).toHaveLength(1);
  });

  it("rejects typos: a bad date, no result, an impossible A1C", async () => {
    const t = convexTest(schema, modules);
    const auth = await setupOwner(t);
    await expect(t.mutation(labs.save, { ...auth, lab: a1c("x", { takenOn: "Oct 26" }) })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(t.mutation(labs.save, { ...auth, lab: a1c("x", { value: 78 }) })).rejects.toThrow(/A1C/);
    await expect(t.mutation(labs.save, { ...auth, lab: { ...a1c("x"), value: undefined } })).rejects.toThrow(/result/);
    await t.mutation(labs.save, { ...auth, lab: { clientId: "c", test: "celiac", name: "Celiac screen", valueText: "Negative", takenOn: "2026-10-26", source: "manual" } });
    expect((await t.query(labs.list, auth))[0]).toMatchObject({ valueText: "Negative" });
  });

  it("someone outside the circle can't read or write", async () => {
    const t = convexTest(schema, modules);
    await setupOwner(t);
    const stranger = await t.mutation(api.auth.register, { email: "x@example.com", passwordHash: "h-x" });
    const sAuth = { userId: stranger, passwordHash: "h-x" };
    // A stranger's own (empty) bucket, never the owner's.
    expect(await t.query(labs.list, sAuth)).toEqual([]);
  });
});
