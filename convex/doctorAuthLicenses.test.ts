import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-doctor-api-secret";
// scrypt at its real cost runs on account creation, so these tests are slower than most.
const SLOW = { timeout: 60_000 };

let sentEmails: { to: string; subject: string; html: string }[] = [];

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  sentEmails = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sentEmails.push({ to: body.to[0], subject: body.subject, html: body.html });
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type T = ReturnType<typeof convexTest>;

const createOrg = (t: T, extra: { seats?: number; allowedDomains?: string[] } = {}) =>
  t.action(internal.doctorAuthActions.createOrganization, {
    name: "Riverside Pediatrics",
    location: "Charlotte, NC",
    seats: extra.seats ?? 5,
    ...(extra.allowedDomains ? { allowedDomains: extra.allowedDomains } : {}),
  });

const describeCode = (t: T, code: string, clientIp?: string) =>
  t.action(api.doctorAuthActions.describeAccessCode, {
    serverSecret: SECRET,
    code,
    ...(clientIp ? { clientIp } : {}),
  });

const sendCode = (t: T, licenseKey: string, email: string) =>
  t.action(api.doctorAuthActions.sendLicenseEmailCode, { serverSecret: SECRET, licenseKey, email });

const lastCode = () => sentEmails.at(-1)!.subject.slice(0, 6);

const register = (t: T, licenseKey: string, email: string, emailCode: string, clientIp?: string) =>
  t.action(api.doctorAuthActions.registerWithLicense, {
    serverSecret: SECRET,
    licenseKey,
    email,
    emailCode,
    passwordHash: "pw-secret",
    displayName: "Dr. Alex Lee",
    title: "Dr.",
    firstName: "Alex",
    lastName: "Lee",
    specialty: "Pediatric Endocrinology",
    ...(clientIp ? { clientIp } : {}),
  });

describe("organization license keys", () => {
  it("a key names its organization; invites and unknown codes say only what they are", async () => {
    const t = convexTest(schema, modules);
    const { licenseKey } = await createOrg(t, { allowedDomains: ["@Riverside.org "] });
    expect(licenseKey).toMatch(/^([A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
    const stored = await t.run(async (ctx: any) => ctx.db.query("doctorLicenseKeys").collect());
    expect(JSON.stringify(stored)).not.toContain(licenseKey.replace(/-/g, ""));

    expect(await describeCode(t, licenseKey.toLowerCase())).toEqual({
      kind: "license",
      organization: { name: "Riverside Pediatrics", location: "Charlotte, NC" },
      allowedDomains: ["riverside.org"],
      seatsAvailable: true,
    });
    const { inviteCode } = await t.action(internal.doctorAuthActions.createInvite, { email: "x@y.org" });
    expect(await describeCode(t, inviteCode)).toEqual({ kind: "invite" });
    expect(await describeCode(t, "ZZZZ-ZZZZ-ZZZZ")).toEqual({ kind: "invalid" });
  });

  it("emails a code, then creates the account in the organization", SLOW, async () => {
    const t = convexTest(schema, modules);
    const { licenseKey, organizationId } = await createOrg(t, { allowedDomains: ["riverside.org"] });

    expect(await sendCode(t, licenseKey, " Alex.Lee@Peds.Riverside.org")).toEqual({
      result: "sent",
      organizationName: "Riverside Pediatrics",
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("alex.lee@peds.riverside.org");
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(sentEmails[0]!.html).toContain(code);

    const created = await register(t, licenseKey, "alex.lee@peds.riverside.org", code);
    expect(created.result).toBe("ok");
    const account = await t.run(async (ctx: any) =>
      ctx.db
        .query("doctorAccounts")
        .withIndex("by_email", (q: any) => q.eq("email", "alex.lee@peds.riverside.org"))
        .unique(),
    );
    expect(account).toMatchObject({
      organizationId,
      institution: "Riverside Pediatrics",
      specialty: "Pediatric Endocrinology",
      displayName: "Dr. Alex Lee",
    });
    expect(account.passwordDigest).toMatch(/^scrypt\$/);

    // The code is single-use, and the account can sign in.
    expect((await register(t, licenseKey, "alex.lee@peds.riverside.org", code)).result).toBe("invalid_email_code");
    const login = await t.action(api.doctorAuthActions.login, {
      serverSecret: SECRET,
      email: "alex.lee@peds.riverside.org",
      passwordHash: "pw-secret",
    });
    expect(login.result).toBe("ok");
  });

  it("refuses other domains, taken emails and full organizations before sending anything", SLOW, async () => {
    const t = convexTest(schema, modules);
    const { licenseKey } = await createOrg(t, { seats: 1, allowedDomains: ["riverside.org"] });

    expect(await sendCode(t, licenseKey, "someone@gmail.com")).toEqual({
      result: "domain_not_allowed",
      allowedDomains: ["riverside.org"],
    });
    expect(await sendCode(t, licenseKey, "someone@notriverside.org")).toMatchObject({ result: "domain_not_allowed" });
    expect(await sendCode(t, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", "a@riverside.org")).toEqual({ result: "invalid_license" });
    expect(sentEmails).toHaveLength(0);

    await sendCode(t, licenseKey, "a@riverside.org");
    expect((await register(t, licenseKey, "a@riverside.org", lastCode())).result).toBe("ok");
    expect(await sendCode(t, licenseKey, "a@riverside.org")).toEqual({ result: "email_taken" });
    expect(await sendCode(t, licenseKey, "b@riverside.org")).toEqual({ result: "no_seats" });
    expect(await describeCode(t, licenseKey)).toMatchObject({ seatsAvailable: false });

    await t.mutation(internal.doctorAuth.licenses.updateOrganization, {
      organization: "Riverside Pediatrics",
      seats: 2,
    });
    expect(await sendCode(t, licenseKey, "b@riverside.org")).toMatchObject({ result: "sent" });
  });

  it("a code allows five guesses, and only for the email it was sent to", async () => {
    const t = convexTest(schema, modules);
    const { licenseKey } = await createOrg(t);
    await sendCode(t, licenseKey, "a@clinic.org");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    expect((await register(t, licenseKey, "b@clinic.org", code)).result).toBe("invalid_email_code");
    for (let i = 0; i < 5; i++) {
      expect((await register(t, licenseKey, "a@clinic.org", wrong)).result).toBe("invalid_email_code");
    }
    // Used up: even the right code no longer works.
    expect((await register(t, licenseKey, "a@clinic.org", code)).result).toBe("invalid_email_code");
  });

  it("a replaced or revoked key stops working; accounts stay", SLOW, async () => {
    const t = convexTest(schema, modules);
    const { licenseKey: first } = await createOrg(t);
    const { licenseKey: second } = await t.action(internal.doctorAuthActions.issueLicenseKey, {
      organization: "Riverside Pediatrics",
    });
    expect(await describeCode(t, first)).toEqual({ kind: "invalid" });
    expect(await describeCode(t, second)).toMatchObject({ kind: "license" });

    await sendCode(t, second, "a@clinic.org");
    const code = lastCode();
    await t.mutation(internal.doctorAuth.licenses.revokeLicenseKey, { organization: "Riverside Pediatrics" });
    expect(await describeCode(t, second)).toEqual({ kind: "invalid" });
    expect(await register(t, second, "a@clinic.org", code)).toEqual({ result: "invalid_license" });

    const orgs = await t.query(internal.doctorAuth.licenses.listOrganizations, {});
    expect(orgs[0]).toMatchObject({ seats: "0 of 5 used", licenseKey: "none (revoked or never issued)" });
  });

  it("says email is unavailable (and sends nothing) while Resend isn't configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const t = convexTest(schema, modules);
    const { licenseKey } = await createOrg(t);
    expect(await sendCode(t, licenseKey, "a@clinic.org")).toEqual({ result: "email_unavailable" });
    expect(sentEmails).toHaveLength(0);
  });

  it("limits verification emails to five an hour per address", async () => {
    const t = convexTest(schema, modules);
    const { licenseKey } = await createOrg(t);
    for (let i = 0; i < 5; i++) expect((await sendCode(t, licenseKey, "a@clinic.org")).result).toBe("sent");
    expect(await sendCode(t, licenseKey, "a@clinic.org")).toMatchObject({ result: "locked" });
  });

  it("bad codes from one IP lock it out", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 10; i++) await describeCode(t, `BAD${i}-AAAA-AAAA`, "9.9.9.9");
    expect(await describeCode(t, "BADX-AAAA-AAAA", "9.9.9.9")).toMatchObject({ result: "locked" });
  });
});
