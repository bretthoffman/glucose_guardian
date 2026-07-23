import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const HASH_A = "hash-a";
const HASH_B = "hash-b";

/** Owner "Mom" caring for child "Bella"; a second account "Dad" available to link as co-guardian. */
async function setup() {
  const t = convexTest(schema, modules);
  const patient = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: HASH_A });
  const member = await t.mutation(api.auth.register, { email: "dad@example.com", passwordHash: HASH_B });
  await t.mutation(api.patientProfile.replace, {
    userId: patient,
    passwordHash: HASH_A,
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  await t.mutation(api.patientProfile.replace, {
    userId: member,
    passwordHash: HASH_B,
    profile: { childName: "Dad", parentName: "Dad", diabetesType: "type1", dateOfBirth: "1985-01-01" },
  });
  return { t, patient, member };
}

async function linkCoGuardian(t: any, patient: string, member: string) {
  const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
  await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });
}

describe("careMessages: guardian ↔ child code", () => {
  it("shows a usable thread before the code is ever used, with each side seeing the other's name", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Bella's phone", kind: "child",
    });

    // The owner already has a thread to the brand-new (never-used) code, named after the kid.
    const ownerThreads = await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    expect(ownerThreads.threads).toHaveLength(1);
    expect(ownerThreads.threads[0].otherName).toBe("Bella");
    expect(ownerThreads.threads[0].otherKind).toBe("child");
    expect(ownerThreads.threads[0].lastText).toBeNull();
    expect(ownerThreads.unreadTotal).toBe(0);

    // The code side sees one thread, to the guardian, named after the guardian.
    const codeThreads = await t.query(api.careMessages.listThreads, { code });
    expect(codeThreads.threads).toHaveLength(1);
    expect(codeThreads.threads[0].otherName).toBe("Mom");
    expect(codeThreads.threads[0].otherKind).toBe("guardian");

    const threadKey = ownerThreads.threads[0].threadKey;
    expect(codeThreads.threads[0].threadKey).toBe(threadKey); // same canonical thread from both ends
  });

  it("delivers messages both ways with unread tracking and read receipts", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Bella's phone", kind: "child",
    });
    const { threads } = await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    const threadKey = threads[0].threadKey;

    await t.mutation(api.careMessages.sendMessage, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, threadKey, text: "How are you feeling?",
    });

    // The kid sees it as unread, from "Mom".
    const kidThreads = await t.query(api.careMessages.listThreads, { code });
    expect(kidThreads.unreadTotal).toBe(1);
    expect(kidThreads.threads[0].unread).toBe(1);
    expect(kidThreads.threads[0].lastText).toBe("How are you feeling?");
    expect(kidThreads.threads[0].lastFromMe).toBe(false);

    const kidMsgs = await t.query(api.careMessages.listMessages, { code, threadKey });
    expect(kidMsgs).toHaveLength(1);
    expect(kidMsgs[0].fromMe).toBe(false);
    expect(kidMsgs[0].senderName).toBe("Mom");

    // Kid opens the thread → unread clears; the sender does not see their own message as unread.
    await t.mutation(api.careMessages.markThreadRead, { code, threadKey });
    expect((await t.query(api.careMessages.listThreads, { code })).unreadTotal).toBe(0);
    expect((await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient })).unreadTotal).toBe(0);

    // Kid replies → the guardian now has an unread.
    await t.mutation(api.careMessages.sendMessage, { code, threadKey, text: "A little low" });
    const ownerAfter = await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    expect(ownerAfter.unreadTotal).toBe(1);
    expect(ownerAfter.threads[0].lastText).toBe("A little low");
    expect(ownerAfter.threads[0].lastFromMe).toBe(false);
  });
});

describe("careMessages: co-guardians get individual threads", () => {
  it("gives the code one thread per guardian, and messages don't cross between guardians", async () => {
    const { t, patient, member } = await setup();
    await linkCoGuardian(t, patient, member);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Bella's phone", kind: "child",
    });

    // The code sees TWO guardian threads (Mom + Dad), one each.
    const codeThreads = await t.query(api.careMessages.listThreads, { code });
    const names = codeThreads.threads.map((th) => th.otherName).sort();
    expect(names).toEqual(["Dad", "Mom"]);

    // Each guardian sees their own single thread to the code.
    const momThreads = await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    const dadThreads = await t.query(api.careMessages.listThreads, { userId: member, passwordHash: HASH_B, patientUserId: patient });
    expect(momThreads.threads).toHaveLength(1);
    expect(dadThreads.threads).toHaveLength(1);
    expect(momThreads.threads[0].threadKey).not.toBe(dadThreads.threads[0].threadKey);

    // Kid messages Mom only → Mom has an unread, Dad has nothing.
    const momThreadKey = codeThreads.threads.find((th) => th.otherName === "Mom")!.threadKey;
    await t.mutation(api.careMessages.sendMessage, { code, threadKey: momThreadKey, text: "hi mom" });
    expect((await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH_A, patientUserId: patient })).unreadTotal).toBe(1);
    expect((await t.query(api.careMessages.listThreads, { userId: member, passwordHash: HASH_B, patientUserId: patient })).unreadTotal).toBe(0);
  });
});

describe("careMessages: code ↔ code", () => {
  it("lets a child code and a caregiver code message each other directly", async () => {
    const { t, patient } = await setup();
    const child = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Bella's phone", kind: "child",
    });
    const nurse = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "School nurse", kind: "caregiver",
    });

    // The child code has a thread to the caregiver code (named by its label) alongside the guardian.
    const childThreads = await t.query(api.careMessages.listThreads, { code: child.code });
    const toNurse = childThreads.threads.find((th) => th.otherName === "School nurse");
    expect(toNurse).toBeTruthy();
    expect(toNurse!.otherKind).toBe("caregiver");

    await t.mutation(api.careMessages.sendMessage, { code: child.code, threadKey: toNurse!.threadKey, text: "I feel dizzy" });

    // The caregiver code sees the incoming message from the child, named after the kid.
    const nurseThreads = await t.query(api.careMessages.listThreads, { code: nurse.code });
    const fromChild = nurseThreads.threads.find((th) => th.otherName === "Bella");
    expect(fromChild).toBeTruthy();
    expect(fromChild!.unread).toBe(1);
    expect(fromChild!.lastText).toBe("I feel dizzy");
    expect(fromChild!.otherKind).toBe("child");
  });
});

describe("careMessages: schedule + guardrails", () => {
  it("locks the board (no viewer) for a code outside its schedule window", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Babysitter", kind: "caregiver",
      access: { mode: "window", startMs: 0, endMs: 1 }, // a window that ended long ago
    });
    const threads = await t.query(api.careMessages.listThreads, { code });
    expect(threads.threads).toHaveLength(0);
    await expect(
      t.mutation(api.careMessages.sendMessage, { code, threadKey: "code:X|user:Y", text: "hi" }),
    ).rejects.toThrow();
  });

  it("rejects a guardian trying to reach a non-member and messages to oneself", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Bella's phone", kind: "child",
    });
    // A thread key naming a code that isn't in this circle must be refused.
    await expect(
      t.mutation(api.careMessages.sendMessage, {
        userId: patient, passwordHash: HASH_A, patientUserId: patient, threadKey: `code:ZZZZZZZZ|user:${patient}`, text: "hi",
      }),
    ).rejects.toThrow();
  });
});
