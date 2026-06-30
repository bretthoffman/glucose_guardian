import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readingCardPath = join(__dirname, "../components/ReadingCard.tsx");
const recentSectionPath = join(__dirname, "../components/RecentReadingsSection.tsx");

describe("Recent Readings collapsible UI", () => {
  it("removes row-level chevrons from ReadingCard", () => {
    const src = readFileSync(readingCardPath, "utf8");
    expect(src).not.toContain('name="chevron-right"');
  });

  it("uses collapsible header with directional chevrons", () => {
    const src = readFileSync(recentSectionPath, "utf8");
    expect(src).toContain("chevron-down");
    expect(src).toContain("chevron-right");
    expect(src).toContain("HOME_RECENT_READINGS_EXPANDED_STORAGE_KEY");
    expect(src).toContain('name="list"');
  });
});
