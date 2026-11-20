import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const insulinPath = join(__dirname, "../app/(tabs)/insulin.tsx");

describe("dose screen header", () => {
  it("keeps the header bare: no page title, and no Dose/Log toggle since Logs is its own tab", () => {
    const src = readFileSync(insulinPath, "utf8");
    expect(src).not.toContain("Dose Analytics");
    expect(src).not.toContain("TYPE.pageTitle");
    expect(src).not.toContain("screenToggle");
    expect(src).not.toContain("ScreenTab");
    // The day record renders on app/(tabs)/logs.tsx only — never inside the dose screen again.
    expect(src).not.toContain("LogHistory");
  });
});
