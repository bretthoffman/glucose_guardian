// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Convex is mocked: a valid session for "good-token", a doctor↔patient link check, and the photo
// lookup. The storage URL the backend hands back is served by a stubbed fetch.
const state = vi.hoisted(() => ({
  linked: true,
  photo: null as { url: string; contentType: string } | null,
  photoLookups: [] as Record<string, unknown>[],
  notDeployed: false,
  storageStatus: 200,
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
          case "doctorAccounts:getFoodPhoto":
            state.photoLookups.push(args);
            if (state.notDeployed) throw new Error("Could not find public function for 'doctorAccounts:getFoodPhoto'");
            return state.photo;
          default:
            throw new Error(`unexpected query ${getFunctionName(ref)}`);
        }
      },
      mutation: async () => null,
    }),
  };
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const STORAGE_URL = "https://storage.test/api/storage/abc";

let server: Server;
let base = "";
const realFetch = globalThis.fetch;
const storageFetches: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://storage.test/")) return realFetch(input, init);
    storageFetches.push(url);
    return state.storageStatus === 200
      ? new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } })
      : new Response("gone", { status: state.storageStatus });
  });
  const { default: doctorRouter } = await import("./doctor");
  const app = express();
  app.use("/api/doctor", doctorRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/doctor`;
});

afterAll(() => {
  server?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  state.linked = true;
  state.photo = { url: STORAGE_URL, contentType: "image/jpeg" };
  state.photoLookups = [];
  state.notDeployed = false;
  state.storageStatus = 200;
  storageFetches.length = 0;
});

const get = (path: string, token: string | null = "good-token") =>
  realFetch(`${base}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

describe("GET /patient/:accessCode/food-photos/:clientId", () => {
  it("streams the photo from storage, never exposing the storage URL", async () => {
    const res = await get("/patient/abc234/food-photos/meal-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    expect(state.photoLookups).toEqual([{ serverSecret: "test-secret", accessCode: "ABC234", clientId: "meal-1" }]);
    expect(storageFetches).toEqual([STORAGE_URL]);
  });

  it("needs a doctor session and a link to the patient", async () => {
    expect((await get("/patient/ABC234/food-photos/meal-1", null)).status).toBe(401);
    expect((await get("/patient/ABC234/food-photos/meal-1", "stolen")).status).toBe(401);
    state.linked = false;
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(403);
    expect(state.photoLookups).toEqual([]);
    expect(storageFetches).toEqual([]);
  });

  it("404s when the meal has no photo, or its type isn't a displayable raster image", async () => {
    state.photo = null;
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(404);
    state.photo = { url: STORAGE_URL, contentType: "image/svg+xml" };
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(404);
    expect(storageFetches).toEqual([]);
  });

  it("503s until the backend is deployed; 404/502 when storage can't serve the file", async () => {
    state.notDeployed = true;
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(503);
    state.notDeployed = false;
    state.storageStatus = 404;
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(404);
    state.storageStatus = 500;
    expect((await get("/patient/ABC234/food-photos/meal-1")).status).toBe(502);
  });
});
