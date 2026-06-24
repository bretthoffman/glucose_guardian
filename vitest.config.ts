import { defineConfig } from "vitest/config";

// Convex functions run in an edge-like runtime; `convex-test` simulates the backend in-process.
// `@edge-runtime/vm` provides the `edge-runtime` environment. Tests live next to the code under test
// in `convex/**` and never require live provider credentials (all network is mocked).
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    // Convex backend tests + pure, RN-import-free mobile helpers (e.g. the chart color classifier).
    include: ["convex/**/*.test.ts", "artifacts/mobile/**/*.test.ts"],
  },
});
