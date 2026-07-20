import { describe, expect, it } from "vitest";
import { entryCreationMs, mergeCloudLogs } from "./careLogsMerge";

const NOW = 1_700_000_000_000;

function entry(id: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return { id, timestamp, ...extra };
}

describe("entryCreationMs", () => {
  it("parses the ms embedded in a log id", () => {
    expect(entryCreationMs(`food_${NOW}_abc`)).toBe(NOW);
    expect(entryCreationMs("garbage")).toBe(0);
  });
});

describe("mergeCloudLogs", () => {
  it("uses cloud as the source of truth, newest-first", () => {
    const cloud = [
      entry("food_2_x", "2026-07-18T10:00:00Z"),
      entry("food_1_x", "2026-07-18T08:00:00Z"),
    ];
    const merged = mergeCloudLogs(cloud, [], 200, NOW);
    expect(merged.map((e) => e.id)).toEqual(["food_2_x", "food_1_x"]);
  });

  it("keeps a very-recent local-only entry (in-flight optimistic write)", () => {
    const cloud = [entry("food_a_x", "2026-07-18T08:00:00Z")];
    const local = [entry(`food_${NOW - 1000}_new`, "2026-07-18T09:00:00Z")];
    const merged = mergeCloudLogs(cloud, local, 200, NOW);
    expect(merged.map((e) => e.id)).toEqual([`food_${NOW - 1000}_new`, "food_a_x"]);
  });

  it("does NOT resurrect a stale local-only entry (respects a remote clear)", () => {
    const cloud: { id: string; timestamp: string }[] = [];
    const local = [entry(`food_${NOW - 5 * 60_000}_old`, "2026-07-18T07:00:00Z")];
    expect(mergeCloudLogs(cloud, local, 200, NOW)).toEqual([]);
  });

  it("deduplicates by id (an optimistic entry now present in the cloud)", () => {
    const shared = entry(`food_${NOW - 1000}_dup`, "2026-07-18T09:00:00Z", { authorName: "Server" });
    const localCopy = entry(`food_${NOW - 1000}_dup`, "2026-07-18T09:00:00Z", { authorName: "Optimistic" });
    const merged = mergeCloudLogs([shared], [localCopy], 200, NOW);
    expect(merged).toHaveLength(1);
    expect((merged[0] as unknown as { authorName: string }).authorName).toBe("Server");
  });

  it("caps the merged result", () => {
    const cloud = Array.from({ length: 250 }, (_, i) =>
      entry(`food_${i}_x`, new Date(NOW - i * 60_000).toISOString()),
    );
    expect(mergeCloudLogs(cloud, [], 200, NOW)).toHaveLength(200);
  });
});
