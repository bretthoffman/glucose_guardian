// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Convex is mocked: a valid session for "good-token", the doctor↔patient link check, and the
// meal-high lookup.
const state = vi.hoisted(() => ({
  linked: true,
  result: null as Record<string, unknown> | null,
  lookups: [] as Record<string, unknown>[],
  notDeployed: false,
}));

vi.mock("../convex-doctor-accounts.js", async (importOriginal) => {
  const { createHash } = await import("node:crypto");
  const { getFunctionName } = await import("convex/server");
  const goodHash = createHash("sha256").update("good-token").digest("hex");
  return {
    ...(await importOriginal<typeof import("../convex-doctor-accounts.js")>()),
    isConvexDoctorAccountsConfigured: () => true,
    getConvexDoctorApiSecret: () => "test-secret",
    createConvexDoctorAccountsClient: () => ({
      query: async (ref: never, args: Record<string, unknown>) => {
        switch (getFunctionName(ref)) {
          case "doctorAccounts:validateSession":
            return args.tokenHash === goodHash ? { doctorId: "doc1" } : null;
          case "doctorAccounts:assertCanAccess":
            return { allowed: state.linked, accessCode: String(args.accessCode).toUpperCase() };
          case "mealHigh:forDoctor":
            state.lookups.push(args);
            if (state.notDeployed) throw new Error("Could not find public function for 'mealHigh:forDoctor'");
            return state.result;
          default:
            throw new Error(`unexpected query ${getFunctionName(ref)}`);
        }
      },
      mutation: async () => null,
    }),
  };
});

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: doctorRouter } = await import("./doctor");
  const app = express();
  app.use("/api/doctor", doctorRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/doctor`;
});

afterAll(() => server?.close());

beforeEach(() => {
  state.linked = true;
  state.result = { enabled: true, high: 250, lookbackDays: 45, patterns: [{ foodName: "Pancakes", stayedHigh: 2 }] };
  state.lookups = [];
  state.notDeployed = false;
});

const get = (path: string, token: string | null = "good-token") =>
  fetch(`${base}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

describe("GET /patient/:accessCode/meal-highs", () => {
  it("returns the patient's meals that stayed high", async () => {
    const res = await get("/patient/abc234/meal-highs");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ accessCode: "ABC234", high: 250, patterns: [{ foodName: "Pancakes" }] });
    expect(state.lookups).toEqual([{ serverSecret: "test-secret", accessCode: "ABC234" }]);
  });

  it("needs a doctor session and a link to the patient", async () => {
    expect((await get("/patient/ABC234/meal-highs", null)).status).toBe(401);
    state.linked = false;
    expect((await get("/patient/ABC234/meal-highs")).status).toBe(403);
    expect(state.lookups).toEqual([]);
  });

  it("404 for no patient, 503 until the backend is deployed", async () => {
    state.result = null;
    expect((await get("/patient/ABC234/meal-highs")).status).toBe(404);
    state.notDeployed = true;
    expect((await get("/patient/ABC234/meal-highs")).status).toBe(503);
  });
});
