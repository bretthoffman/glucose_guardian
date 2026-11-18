import { describe, expect, it } from "vitest";
import { helpCardAtTop } from "./helpPlacement";

describe("helpCardAtTop", () => {
  it("stays docked above the tab bar whenever it fits there", () => {
    expect(helpCardAtTop(200, 500, 220)).toBe(false);
    expect(helpCardAtTop(200, 0, 200)).toBe(false); // exact fit counts
  });

  it("moves above a low spotlight it would otherwise cover", () => {
    // Element near the bottom of the screen: no room below, plenty above.
    expect(helpCardAtTop(220, 420, 60)).toBe(true);
  });

  it("picks the smaller overlap when nothing fits (tall spotlight, long text)", () => {
    // The Dashboard settings-card step that used to bury the element's TOP under the card:
    // ~7pt free above, ~220pt free below, card ~310pt tall. Dock below, covering only the tail.
    expect(helpCardAtTop(310, 7, 220)).toBe(false);
    // Mirrored geometry docks at the top instead.
    expect(helpCardAtTop(310, 220, 7)).toBe(true);
  });
});
