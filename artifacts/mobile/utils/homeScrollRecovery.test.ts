import { describe, expect, it } from "vitest";
import {
  HOME_SCROLL_REST_OFFSET,
  SCROLL_RETURN_IMPERCEPTIBLE_DRIFT,
  homeScrollNeedsRecovery,
  isHomeScrollAtRest,
  shouldUseAnimatedScrollCorrection,
} from "./homeScrollRecovery";

describe("homeScrollRecovery", () => {
  it("uses y=0 as the resting offset", () => {
    expect(HOME_SCROLL_REST_OFFSET).toBe(0);
    expect(isHomeScrollAtRest(0)).toBe(true);
  });

  it("detects overscroll that needs recovery", () => {
    expect(homeScrollNeedsRecovery(-120)).toBe(true);
    expect(homeScrollNeedsRecovery(0)).toBe(false);
    expect(homeScrollNeedsRecovery(-2)).toBe(true);
  });

  it("treats tiny drift as at rest within tolerance", () => {
    expect(isHomeScrollAtRest(1)).toBe(true);
    expect(isHomeScrollAtRest(-2)).toBe(false);
  });

  it("prefers animated correction for visible displacement", () => {
    expect(shouldUseAnimatedScrollCorrection(-24)).toBe(true);
    expect(shouldUseAnimatedScrollCorrection(SCROLL_RETURN_IMPERCEPTIBLE_DRIFT)).toBe(false);
  });
});
