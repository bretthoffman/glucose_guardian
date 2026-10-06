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
    if (result === MISSING) throw new Error(`Could not find public function for '${name}'`);
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

  it("falls back to the previous check until the backend is deployed", async () => {
    state.results["doctorAuthActions:login"] = MISSING;
    state.results["doctorAccounts:login"] = profile;
    state.results["doctorAccounts:createSession"] = { ok: true };
    expect((await post("/auth/login", body)).status).toBe(200);
    state.results["doctorAccounts:login"] = null;
    expect((await post("/auth/login", body)).status).toBe(401);
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

  it("falls back to unlimited linking until the backend is deployed", async () => {
    state.results["doctorAccounts:linkPatient"] = MISSING;
    state.results["doctorAccounts:createLink"] = { ...link, alreadyLinked: true };
    expect((await post("/me/patients/link", { accessCode: "ABC234" }, auth)).status).toBe(200);
  });
});

describe("POST /login (code-only sign-in)", () => {
  it("is retired", async () => {
    const res = await post("/login", { accessCode: "ABC234" });
    expect(res.status).toBe(410);
    expect(state.calls).toEqual([]);
  });
});
