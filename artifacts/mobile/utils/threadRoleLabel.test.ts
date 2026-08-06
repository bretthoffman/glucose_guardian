import { describe, expect, it } from "vitest";
import { threadRoleLabel } from "./threadRoleLabel";

describe("threadRoleLabel", () => {
  it("labels guardians, children and caregivers", () => {
    expect(threadRoleLabel("guardian")).toBe("Guardian");
    expect(threadRoleLabel("child")).toBe("Child");
    expect(threadRoleLabel("caregiver")).toBe("Caregiver");
  });

  it("says Co-Guardian once a circle has more than one guardian", () => {
    expect(threadRoleLabel("co-guardian")).toBe("Co-Guardian");
  });

  it("gives an ADULT no qualifier — they're the person the app is about", () => {
    expect(threadRoleLabel("adult")).toBeNull();
  });

  it("falls back to no label for an unrecognised kind rather than printing a raw value", () => {
    expect(threadRoleLabel("something-new" as never)).toBeNull();
  });
});
