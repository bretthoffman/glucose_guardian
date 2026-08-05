import { describe, expect, it } from "vitest";
import { splitSharedProfilePatch, OWNER_ONLY_SHARED_FIELDS } from "./sharedProfilePatch";

describe("splitSharedProfilePatch", () => {
  it("keeps a member's allowed edit even when the patch also contains an owner-only field", () => {
    // The bug this prevents: the server rejects the WHOLE patch, so doctorPhone was lost along with
    // the disallowed weightLbs — and the rejection was swallowed, so it looked like it saved.
    const { sendable, blocked } = splitSharedProfilePatch(
      { doctorPhone: "555-0199", weightLbs: 99 },
      false,
    );
    expect(sendable).toEqual({ doctorPhone: "555-0199" });
    expect(blocked).toEqual(["weightLbs"]);
  });

  it("blocks every owner-only field for a member", () => {
    const patch = Object.fromEntries(OWNER_ONLY_SHARED_FIELDS.map((f) => [f, 1]));
    const { sendable, blocked } = splitSharedProfilePatch(patch, false);
    expect(Object.keys(sendable)).toEqual([]);
    expect(blocked.sort()).toEqual([...OWNER_ONLY_SHARED_FIELDS].sort());
  });

  it("filters nothing for the owner", () => {
    const patch = { weightLbs: 70, doctorPhone: "555-0100" };
    const { sendable, blocked } = splitSharedProfilePatch(patch, true);
    expect(sendable).toEqual(patch);
    expect(blocked).toEqual([]);
  });

  it("drops undefined values rather than sending them as deletions", () => {
    const { sendable } = splitSharedProfilePatch({ doctorPhone: undefined, doctorName: "Dr. Who" }, false);
    expect(sendable).toEqual({ doctorName: "Dr. Who" });
  });

  it("stays in sync with the server's owner-only list", () => {
    // If someone edits OWNER_ONLY_PROFILE_FIELDS in convex/careCircle.ts, this is the reminder to
    // mirror it here — otherwise the client starts sending a field the server rejects wholesale.
    expect([...OWNER_ONLY_SHARED_FIELDS].sort()).toEqual(
      ["carbRatio", "correctionFactor", "dateOfBirth", "doseSettingsByTime", "insulinTypes", "targetGlucose", "weightLbs"].sort(),
    );
  });
});
