import { describe, expect, it } from "vitest";
import {
  parseHomeRecentReadingsExpanded,
  serializeHomeRecentReadingsExpanded,
} from "./homeRecentReadingsExpanded";

describe("homeRecentReadingsExpanded", () => {
  it("defaults to collapsed when missing or unknown", () => {
    expect(parseHomeRecentReadingsExpanded(null)).toBe(false);
    expect(parseHomeRecentReadingsExpanded(undefined)).toBe(false);
    expect(parseHomeRecentReadingsExpanded("false")).toBe(false);
    expect(parseHomeRecentReadingsExpanded("expanded")).toBe(false);
  });

  it("parses expanded state", () => {
    expect(parseHomeRecentReadingsExpanded("true")).toBe(true);
  });

  it("serializes boolean preference", () => {
    expect(serializeHomeRecentReadingsExpanded(false)).toBe("false");
    expect(serializeHomeRecentReadingsExpanded(true)).toBe("true");
  });
});
