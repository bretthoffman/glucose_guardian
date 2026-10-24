import { describe, expect, it } from "vitest";
import { formsAvailable, formsTaken, formWord, isTaken, suppliesTaken, toggleInsulinForm } from "./insulinForms";

const HUM = "Humalog · 100 u/mL";
const LAN = "Lantus · 100 u/mL";
const TOU = "Toujeo · 300 u/mL";
const HUR = "Humulin R · 100 u/mL";

describe("formsAvailable", () => {
  it("knows pen-only, vial-only and both", () => {
    expect(formsAvailable(HUM)).toEqual(["pen", "vial"]);
    expect(formsAvailable(TOU)).toEqual(["pen"]);
    expect(formsAvailable("Lispro Junior · 100 u/mL")).toEqual(["pen"]);
    expect(formsAvailable(HUR)).toEqual(["vial"]);
    expect(formsAvailable("Mystery · 100 u/mL")).toEqual(["pen", "vial"]);
  });
});

describe("accounts from before pen/vial", () => {
  it("every insulin counts as a pen (a vial when it only comes as one), like the app showed", () => {
    const old = { insulinTypes: [HUM, LAN, HUR] };
    expect(formsTaken(old, HUM)).toEqual(["pen"]);
    expect(formsTaken(old, HUR)).toEqual(["vial"]);
    expect(formsTaken(old, TOU)).toEqual([]);
    expect(suppliesTaken(old)).toEqual([
      { label: HUM, form: "pen" },
      { label: LAN, form: "pen" },
      { label: HUR, form: "vial" },
    ]);
  });
  it("first pick keeps what they had and adds the new form", () => {
    const next = toggleInsulinForm({ insulinTypes: [HUM, LAN] }, HUM, "vial");
    expect(next).toEqual({ insulinTypes: [HUM, LAN], insulinPens: [HUM, LAN], insulinVials: [HUM] });
  });
});

describe("toggleInsulinForm", () => {
  it("adds a new insulin at the end and keeps insulinTypes the union", () => {
    const c = { insulinTypes: [LAN], insulinPens: [LAN], insulinVials: [] };
    expect(toggleInsulinForm(c, HUM, "vial")).toEqual({ insulinTypes: [LAN, HUM], insulinPens: [LAN], insulinVials: [HUM] });
  });
  it("turning off one form keeps the insulin while the other form is on", () => {
    const c = { insulinTypes: [HUM], insulinPens: [HUM], insulinVials: [HUM] };
    const off = toggleInsulinForm(c, HUM, "pen");
    expect(off).toEqual({ insulinTypes: [HUM], insulinPens: [], insulinVials: [HUM] });
    expect(toggleInsulinForm(off, HUM, "vial")).toEqual({ insulinTypes: [], insulinPens: [], insulinVials: [] });
  });
  it("drops stale list entries for insulins no longer in insulinTypes", () => {
    const c = { insulinTypes: [LAN], insulinPens: [LAN, HUM], insulinVials: [HUM] };
    expect(isTaken(c, HUM, "pen")).toBe(false);
    expect(toggleInsulinForm(c, LAN, "vial")).toEqual({ insulinTypes: [LAN], insulinPens: [LAN], insulinVials: [LAN] });
  });
  it("an insulin added by an older app (in neither list) still shows as before", () => {
    const c = { insulinTypes: [LAN, HUM], insulinPens: [LAN], insulinVials: [] };
    expect(formsTaken(c, HUM)).toEqual(["pen"]);
  });
});

describe("formWord", () => {
  it("missing means pen", () => {
    expect(formWord(undefined)).toBe("pen");
    expect(formWord("vial")).toBe("vial");
  });
});
