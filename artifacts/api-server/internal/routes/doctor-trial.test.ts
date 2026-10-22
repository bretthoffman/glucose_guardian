// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Convex is mocked: "GG-GOOD-AAA" is an active pass, "GG-USED-AAA" has ended, anything else is unknown.
vi.mock("../convex-doctor-accounts.js", async (importOriginal) => {
  const { getFunctionName } = await import("convex/server");
  const active = (code: unknown) => String(code).toUpperCase().includes("GOOD");
  return {
    ...(await importOriginal<typeof import("../convex-doctor-accounts.js")>()),
    isConvexDoctorAccountsConfigured: () => true,
    getConvexDoctorApiSecret: () => "test-secret",
    createConvexDoctorAccountsClient: () => ({
      mutation: async (ref: never, args: Record<string, unknown>) => {
        if (getFunctionName(ref) !== "portalTrial:redeem") throw new Error("unexpected mutation");
        const code = String(args.code).toUpperCase();
        if (code.includes("GOOD")) return { ok: true, expiresAt: Date.parse("2026-10-23T12:00:00Z"), patientName: "Bella" };
        if (code.includes("USED")) return { ok: false, reason: "expired" };
        return { ok: false, reason: "invalid" };
      },
      query: async (ref: never, args: Record<string, unknown>) => {
        switch (getFunctionName(ref)) {
          case "portalTrial:trialProfile":
            return active(args.code)
              ? { profile: { childName: "Bella", diabetesType: "type1" }, updatedAt: 1, expiresAt: Date.parse("2026-10-23T12:00:00Z") }
              : null;
          case "portalTrial:trialGlucose":
            return active(args.code) ? { readings: [{ value: 140, trend: "Flat", timestamp: "2026-10-22T11:00:00.000Z" }] } : null;
          case "portalTrial:trialLogs":
            return active(args.code) ? { food: [{ id: "f1" }], insulin: [] } : null;
          default:
            throw new Error(`unexpected query ${getFunctionName(ref)}`);
        }
      },
    }),
  };
});

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: trialRouter } = await import("./doctor-trial");
  const app = express();
  app.use(express.json());
  app.use("/api/doctor/trial", trialRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/doctor/trial`;
});
afterAll(() => server?.close());

const open = (code: string) =>
  fetch(`${base}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
const get = (path: string, pass: string) => fetch(`${base}${path}`, { headers: { "X-Portal-Pass": pass } });

describe("Doctor Portal pass routes", () => {
  it("opens a good code and says why a bad one can't be used", async () => {
    const ok = await open("gg-good-aaa");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ patientName: "Bella", accessCode: "PASS", expiresAt: "2026-10-23T12:00:00.000Z" });
    expect((await open("GG-USED-AAA")).status).toBe(410);
    expect((await open("GG-NOPE-AAA")).status).toBe(404);
    expect((await open("")).status).toBe(400);
  });

  it("serves a view-only snapshot only while the pass is active", async () => {
    const res = await get("/patient", "GG-GOOD-AAA");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { glucoseReadings: unknown[]; foodLog: unknown[] };
    expect(body).toMatchObject({ accessCode: "PASS", source: "pass", messages: [], therapyProposal: null });
    expect(body.glucoseReadings).toHaveLength(1);
    expect(body.foodLog).toHaveLength(1);
    expect((await get("/patient", "GG-USED-AAA")).status).toBe(401);
    expect((await get("/patient", "")).status).toBe(401);
  });

  it("reads history and logs with the pass, and checks the range", async () => {
    const q = "?from=2026-10-20T00:00:00Z&to=2026-10-22T00:00:00Z";
    expect((await get(`/readings${q}`, "GG-GOOD-AAA")).status).toBe(200);
    expect((await get(`/logs${q}`, "GG-GOOD-AAA")).status).toBe(200);
    expect((await get(`/readings${q}`, "GG-USED-AAA")).status).toBe(401);
    expect((await get("/readings?from=x&to=y", "GG-GOOD-AAA")).status).toBe(400);
  });
});
