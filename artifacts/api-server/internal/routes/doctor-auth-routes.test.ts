// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Convex is mocked per function; `calls` records what the routes asked for, and a function set to
// MISSING behaves as if it weren't deployed yet.
const MISSING = Symbol("missing");
const state = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  calls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock("../convex-doctor-accounts.js", async (importOriginal) => {
  const { createHash } = await import("node:crypto");
  const { getFunctionName } = await import("convex/server");
  const goodHash = createHash("sha256").update("good-token").digest("hex");
  const run = async (ref: never, args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    if (name === "doctorAccounts:validateSession") {
      return args.tokenHash === goodHash ? { doctorId: "doc1" } : null;
    }
    state.calls.push({ name, args });
    const result = state.results[name];
    // Production Convex reports a function that isn't deployed only as a generic error.
    if (result === MISSING) throw new Error("[Request ID: 0123abcd] Server Error");
    return result;
  };
  return {
    ...(await importOriginal<typeof import("../convex-doctor-accounts.js")>()),
    isConvexDoctorAccountsConfigured: () => true,
    getConvexDoctorApiSecret: () => "test-secret",
    createConvexDoctorAccountsClient: () => ({ query: run, mutation: run, action: run }),
  };
});

const profile = { doctorId: "doc1", email: "dr@clinic.org", displayName: "Dr. Lee", hasPin: true };

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: doctorRouter } = await import("./doctor");
  const app = express();
  app.use(express.json());
  app.use("/api/doctor", doctorRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/doctor`;
});
afterAll(() => {
  server?.close();
});
beforeEach(() => {
  state.results = {};
  state.calls = [];
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  });
const called = (name: string) => state.calls.filter((c) => c.name === name);

describe("POST /auth/register — invitation only", () => {
  const body = { email: "dr@clinic.org", passwordHash: "pw", displayName: "Dr. Lee", inviteCode: "ABCD-EFGH-JKMN" };

  it("needs an invite code, and passes it with the caller's IP", async () => {
    expect((await post("/auth/register", { ...body, inviteCode: undefined })).status).toBe(403);
    expect(state.calls).toEqual([]);

    state.results["doctorAuthActions:registerWithInvite"] = { result: "ok", doctorId: "doc9" };
    const res = await post("/auth/register", body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ doctorId: "doc9" });
    expect(called("doctorAuthActions:registerWithInvite")[0]!.args).toMatchObject({
      inviteCode: "ABCD-EFGH-JKMN",
      email: "dr@clinic.org",
      clientIp: "203.0.113.9",
    });
  });

  it("maps a bad invite to 403, a taken email to 409 and a lockout to 429", async () => {
    state.results["doctorAuthActions:registerWithInvite"] = { result: "invalid_invite" };
    expect((await post("/auth/register", body)).status).toBe(403);
    state.results["doctorAuthActions:registerWithInvite"] = { result: "email_taken" };
    expect((await post("/auth/register", body)).status).toBe(409);
    state.results["doctorAuthActions:registerWithInvite"] = { result: "locked", retryAfterMs: 90_000 };
    const locked = await post("/auth/register", body);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("90");
  });

  it("fails closed until the backend is deployed — never the old open sign-up", async () => {
    state.results["doctorAuthActions:registerWithInvite"] = MISSING;
    expect((await post("/auth/register", body)).status).toBe(503);
    expect(called("doctorAccounts:register")).toEqual([]);
  });
});

describe("license-key sign-up", () => {
  const license = {
    kind: "license",
    organization: { name: "Riverside Pediatrics", location: "Charlotte, NC" },
    allowedDomains: ["riverside.org"],
    seatsAvailable: true,
  };

  it("POST /auth/access-code describes a code: license, invite, unknown, locked", async () => {
    state.results["doctorAuthActions:describeAccessCode"] = license;
    let res = await post("/auth/access-code", { code: "AAAA-BBBB-CCCC-DDDD" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(license);
    expect(called("doctorAuthActions:describeAccessCode")[0]!.args).toMatchObject({ clientIp: "203.0.113.9" });

    state.results["doctorAuthActions:describeAccessCode"] = { kind: "invite" };
    expect(await (await post("/auth/access-code", { code: "X" })).json()).toEqual({ kind: "invite" });
    state.results["doctorAuthActions:describeAccessCode"] = { kind: "invalid" };
    res = await post("/auth/access-code", { code: "X" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "invalid_code" });
    state.results["doctorAuthActions:describeAccessCode"] = { result: "locked", retryAfterMs: 60_000 };
    expect((await post("/auth/access-code", { code: "X" })).status).toBe(429);
    expect((await post("/auth/access-code", {})).status).toBe(400);
  });

  it("503 until the backend is deployed (the portal falls back to invites)", async () => {
    state.results["doctorAuthActions:describeAccessCode"] = MISSING;
    expect((await post("/auth/access-code", { code: "X" })).status).toBe(503);
    state.results["doctorAuthActions:sendLicenseEmailCode"] = MISSING;
    expect((await post("/auth/email-code", { licenseKey: "K", email: "a@riverside.org" })).status).toBe(503);
  });

  it("POST /auth/email-code sends, or says why not", async () => {
    const body = { licenseKey: "K", email: "a@riverside.org" };
    expect((await post("/auth/email-code", { licenseKey: "K", email: "nope" })).status).toBe(400);
    state.results["doctorAuthActions:sendLicenseEmailCode"] = { result: "sent", organizationName: "R" };
    expect(await (await post("/auth/email-code", body)).json()).toEqual({ sent: true });

    state.results["doctorAuthActions:sendLicenseEmailCode"] = {
      result: "domain_not_allowed",
      allowedDomains: ["riverside.org"],
    };
    let res = await post("/auth/email-code", body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "domain_not_allowed", allowedDomains: ["riverside.org"] });
    for (const [result, status, reason] of [
      ["no_seats", 403, "no_seats"],
      ["invalid_license", 403, "invalid_license"],
      ["email_taken", 409, "email_taken"],
      ["email_unavailable", 503, "email_unavailable"],
    ] as const) {
      state.results["doctorAuthActions:sendLicenseEmailCode"] = { result };
      res = await post("/auth/email-code", body);
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ reason });
    }
  });

  it("POST /auth/register with a licenseKey uses the license action, not the invite one", async () => {
    const body = {
      licenseKey: "AAAA-BBBB-CCCC-DDDD",
      emailCode: "123456",
      email: "a@riverside.org",
      passwordHash: "pw",
      displayName: "Dr. Lee",
      specialty: "Endocrinologist",
    };
    expect((await post("/auth/register", { ...body, emailCode: undefined })).status).toBe(400);
    state.results["doctorAuthActions:registerWithLicense"] = { result: "ok", doctorId: "doc7" };
    const res = await post("/auth/register", body);
    expect(res.status).toBe(201);
    expect(called("doctorAuthActions:registerWithInvite")).toEqual([]);
    expect(called("doctorAuthActions:registerWithLicense")[0]!.args).toMatchObject({
      licenseKey: "AAAA-BBBB-CCCC-DDDD",
      emailCode: "123456",
      specialty: "Endocrinologist",
      clientIp: "203.0.113.9",
    });
    state.results["doctorAuthActions:registerWithLicense"] = { result: "invalid_email_code" };
    expect(await (await post("/auth/register", body)).json()).toMatchObject({ reason: "invalid_email_code" });
    state.results["doctorAuthActions:registerWithLicense"] = MISSING;
    expect((await post("/auth/register", body)).status).toBe(503);
  });
});

describe("POST /auth/login", () => {
  const body = { email: "dr@clinic.org", passwordHash: "pw" };

  it("signs in through the scrypt action and issues a 12-hour session", async () => {
    state.results["doctorAuthActions:login"] = { result: "ok", doctor: profile };
    state.results["doctorAccounts:createSession"] = { ok: true };
    const before = Date.now();
    const res = await post("/auth/login", body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string; expiresAt: number; doctor: unknown };
    expect(json.doctor).toEqual(profile);
    expect(json.expiresAt - before).toBeGreaterThanOrEqual(12 * 3600_000 - 1000);
    expect(json.expiresAt - before).toBeLessThanOrEqual(12 * 3600_000 + 5000);
    expect(called("doctorAuthActions:login")[0]!.args).toMatchObject({ clientIp: "203.0.113.9" });
    expect(called("doctorAccounts:createSession")).toHaveLength(1);
  });

  it("401 for a wrong password, 429 with Retry-After when locked", async () => {
    state.results["doctorAuthActions:login"] = { result: "invalid" };
    expect((await post("/auth/login", body)).status).toBe(401);
    state.results["doctorAuthActions:login"] = { result: "locked", retryAfterMs: 15 * 60_000 };
    const locked = await post("/auth/login", body);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBe("900");
    expect(called("doctorAccounts:createSession")).toEqual([]);
  });

  it("fails closed if the sign-in check is unavailable — never the old unlimited check", async () => {
    state.results["doctorAuthActions:login"] = MISSING;
    state.results["doctorAccounts:login"] = profile;
    expect((await post("/auth/login", body)).status).toBe(500);
    expect(called("doctorAccounts:login")).toEqual([]);
    expect(called("doctorAccounts:createSession")).toEqual([]);
  });
});

describe("POST /me/patients/link", () => {
  const auth = { authorization: "Bearer good-token" };
  const link = { accessCode: "ABC234", displayName: "Bella", alreadyLinked: false };

  it("links through the limited mutation, with the doctor and IP", async () => {
    state.results["doctorAccounts:linkPatient"] = { ok: true, link };
    const res = await post("/me/patients/link", { accessCode: "abc234" }, auth);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(link);
    expect(called("doctorAccounts:linkPatient")[0]!.args).toMatchObject({
      doctorId: "doc1",
      clientIp: "203.0.113.9",
    });
  });

  it("404 for an unknown code, 429 once locked", async () => {
    state.results["doctorAccounts:linkPatient"] = { ok: false, reason: "unknown" };
    expect((await post("/me/patients/link", { accessCode: "ZZZ999" }, auth)).status).toBe(404);
    state.results["doctorAccounts:linkPatient"] = { ok: false, reason: "locked", retryAfterMs: 3600_000 };
    expect((await post("/me/patients/link", { accessCode: "ZZZ999" }, auth)).status).toBe(429);
  });

  it("fails closed if the limited linking is unavailable — never unlimited linking", async () => {
    state.results["doctorAccounts:linkPatient"] = MISSING;
    state.results["doctorAccounts:createLink"] = link;
    expect((await post("/me/patients/link", { accessCode: "ABC234" }, auth)).status).toBe(400);
    expect(called("doctorAccounts:createLink")).toEqual([]);
  });
});

describe("POST /login (code-only sign-in)", () => {
  it("is retired", async () => {
    const res = await post("/login", { accessCode: "ABC234" });
    expect(res.status).toBe(410);
    expect(state.calls).toEqual([]);
  });
});
