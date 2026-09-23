import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-doctor-api-secret";
const HASH = "hash-mom";
const DOCTOR_CODE = "DOC234";

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
  // Sends schedule pushes; fake timers let each test run them to completion.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const VIEW = { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false };

/**
 * Mom's account (child Bella) shares doctor code DOC234 with Dr. Rivera, and has three access
 * codes: the school nurse, Grandma, and Bella's own phone. The doctor tags the nurse code
 * "School Nurse" and Grandma "Family Member".
 */
async function setup() {
  const t = convexTest(schema, modules);
  const patient = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: HASH });
  await t.mutation(api.patientProfile.replace, {
    userId: patient,
    passwordHash: HASH,
    profile: {
      childName: "Bella",
      parentName: "Mom",
      diabetesType: "type1",
      dateOfBirth: "2014-01-01",
      doctorCode: DOCTOR_CODE,
    },
  });
  const makeCode = async (label: string, kind: "caregiver" | "child") =>
    (
      await t.mutation(api.careCircle.createAccessCode, {
        userId: patient, passwordHash: HASH, patientUserId: patient, label, kind,
        ...(kind === "caregiver" ? { permissions: VIEW } : {}),
      })
    ).code as string;
  const nurseCode = await makeCode("Lincoln Nurse Office", "caregiver");
  const grandmaCode = await makeCode("Grandma", "caregiver");
  const phoneCode = await makeCode("Bella's phone", "child");

  const { doctorId } = await t.mutation(api.doctorAccounts.register, {
    serverSecret: SECRET, email: "rivera@example.com", passwordHash: "h", displayName: "Alex Rivera",
    title: "Dr.", lastName: "Rivera",
  });
  await t.mutation(api.doctorAccounts.createLink, { serverSecret: SECRET, doctorId, accessCode: DOCTOR_CODE });
  const doctor = { serverSecret: SECRET, doctorId, accessCode: DOCTOR_CODE };
  await t.mutation(api.doctorAccounts.setCaregiverTitle, { ...doctor, name: "Lincoln Nurse Office", title: "school_nurse" });
  await t.mutation(api.doctorAccounts.setCaregiverTitle, { ...doctor, name: "Grandma", title: "family_member" });
  return { t, patient, nurseCode, grandmaCode, phoneCode, doctor };
}

describe("doctor ↔ school nurse chat (Care Circle messaging)", () => {
  it("gives only the codes the doctor tagged School Nurse a chat with the doctor", async () => {
    const { t, patient, nurseCode, grandmaCode, phoneCode } = await setup();

    const nurse = await t.query(api.careMessages.listThreads, { code: nurseCode });
    const doctorThread = nurse.threads.find((th) => th.otherKind === "doctor");
    expect(doctorThread?.otherName).toBe("Dr. Rivera");

    for (const code of [grandmaCode, phoneCode]) {
      const other = await t.query(api.careMessages.listThreads, { code });
      expect(other.threads.some((th) => th.otherKind === "doctor")).toBe(false);
    }
    // Parents keep the portal's guardian thread, not a Care Circle doctor chat.
    const owner = await t.query(api.careMessages.listThreads, { userId: patient, passwordHash: HASH, patientUserId: patient });
    expect(owner.threads.some((th) => th.otherKind === "doctor")).toBe(false);
  });

  it("delivers doctor → nurse and nurse → doctor, with read state and a portal alert", async () => {
    const { t, nurseCode, doctor } = await setup();
    const { threads: [thread] } = await t.query(api.careMessages.doctorNurseThreads, doctor);
    expect(thread.name).toBe("Lincoln Nurse Office");
    expect(thread.messages).toEqual([]);

    await t.mutation(api.careMessages.doctorSendNurseMessage, { ...doctor, codeId: thread.codeId, text: "Please check her 2pm reading." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const nurseThreads = await t.query(api.careMessages.listThreads, { code: nurseCode });
    const threadKey = nurseThreads.threads.find((th) => th.otherKind === "doctor")!.threadKey;
    const seen = await t.query(api.careMessages.listMessages, { code: nurseCode, threadKey });
    expect(seen).toMatchObject([{ text: "Please check her 2pm reading.", senderName: "Dr. Rivera", fromMe: false }]);

    await t.mutation(api.careMessages.sendMessage, { code: nurseCode, threadKey, text: "Will do — 142 at 2pm." });
    const after = (await t.query(api.careMessages.doctorNurseThreads, doctor)).threads[0];
    expect(after.messages.map((m) => [m.fromDoctor, m.text])).toEqual([
      [true, "Please check her 2pm reading."],
      [false, "Will do — 142 at 2pm."],
    ]);
    expect(after.unread).toBe(1);

    const alerts = await t.run(async (ctx: any) => await ctx.db.query("doctorAlerts").collect());
    expect(alerts).toMatchObject([{ kind: "nurse_message", accessCode: DOCTOR_CODE, message: "New message from Lincoln Nurse Office" }]);

    await t.mutation(api.careMessages.doctorMarkNurseThreadRead, { ...doctor, codeId: thread.codeId });
    expect((await t.query(api.careMessages.doctorNurseThreads, doctor)).threads[0].unread).toBe(0);
  });

  it("refuses chats with anyone not tagged School Nurse, from either side", async () => {
    const { t, grandmaCode, doctor } = await setup();
    const circle = await t.query(api.careMessages.doctorCareCircle, doctor);
    const grandma = circle.members.find((m) => m.name === "Grandma")!;
    await expect(
      t.mutation(api.careMessages.doctorSendNurseMessage, {
        ...doctor, codeId: grandma.id.slice("code:".length) as any, text: "hi",
      }),
    ).rejects.toThrow(/School Nurse/);

    const forged = [`code:${grandmaCode}`, `doctor:${doctor.doctorId}`].sort().join("|");
    await expect(
      t.mutation(api.careMessages.sendMessage, { code: grandmaCode, threadKey: forged, text: "hi doctor" }),
    ).rejects.toThrow(/isn’t available/);
  });

  it("lists the circle for the portal without exposing any access code", async () => {
    const { t, nurseCode, grandmaCode, phoneCode, doctor } = await setup();
    const { members } = await t.query(api.careMessages.doctorCareCircle, doctor);
    expect(members.map((m) => [m.name, m.kind, m.messaging])).toEqual([
      ["Mom", "owner", "parents"],
      ["Lincoln Nurse Office", "caregiver_code", "nurse"],
      ["Grandma", "caregiver_code", null],
      ["Bella", "patient_device", null],
    ]);
    const json = JSON.stringify(members);
    for (const code of [nurseCode, grandmaCode, phoneCode]) expect(json).not.toContain(code);
  });

  it("counts a nurse account using the code: tagging the nurse's own name also works", async () => {
    const { t, grandmaCode, doctor } = await setup();
    const holly = await t.mutation(api.auth.register, { email: "holly@example.com", passwordHash: "hh" });
    await t.mutation(api.patientProfile.replace, {
      userId: holly,
      passwordHash: "hh",
      profile: {
        childName: "Holly", diabetesType: "other", dateOfBirth: "1990-01-01",
        accountRole: "caregiver", organization: "Lincoln Elementary",
      },
    });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: holly, passwordHash: "hh", code: grandmaCode });
    await t.mutation(api.doctorAccounts.setCaregiverTitle, { ...doctor, name: "Holly", title: "school_nurse" });

    const { members } = await t.query(api.careMessages.doctorCareCircle, doctor);
    const viaCode = members.find((m) => m.name === "Grandma")!;
    expect(viaCode.accounts).toEqual([{ name: "Holly", organization: "Lincoln Elementary" }]);
    expect(viaCode.messaging).toBe("nurse");
  });
});
