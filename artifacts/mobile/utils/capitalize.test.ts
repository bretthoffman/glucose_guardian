import { describe, expect, it } from "vitest";
import { capFirst, capLogEntries, capWords } from "./capitalize";

describe("capFirst", () => {
  it("capitalizes the first letter and each new line", () => {
    expect(capFirst("pizza")).toBe("Pizza");
    expect(capFirst("  rice")).toBe("  Rice");
    expect(capFirst("washed hands\nfelt shaky")).toBe("Washed hands\nFelt shaky");
  });
  it("leaves everything else alone", () => {
    expect(capFirst("")).toBe("");
    expect(capFirst("Pizza")).toBe("Pizza");
    expect(capFirst("2 slices of pizza")).toBe("2 slices of pizza");
    expect(capFirst("mac and cheese, iPhone")).toBe("Mac and cheese, iPhone");
    expect(capFirst("élan")).toBe("Élan");
  });
});

describe("capWords", () => {
  it("capitalizes each word of a name", () => {
    expect(capWords("mary ann")).toBe("Mary Ann");
    expect(capWords("anne-marie")).toBe("Anne-Marie");
    expect(capWords("McDonald")).toBe("McDonald");
    expect(capWords("")).toBe("");
  });
});

describe("capLogEntries", () => {
  it("capitalizes food names and notes and keeps tidy entries as-is", () => {
    const tidy = { id: "a", foodName: "Pizza" };
    const list = [tidy, { id: "b", foodName: "rice", note: "after soccer" }, { id: "c", note: "felt low" }];
    const out = capLogEntries(list);
    expect(out[0]).toBe(tidy);
    expect(out[1]).toEqual({ id: "b", foodName: "Rice", note: "After soccer" });
    expect(out[2]).toEqual({ id: "c", note: "Felt low" });
    expect(list[1].foodName).toBe("rice"); // saved data untouched
    const allTidy = [tidy];
    expect(capLogEntries(allTidy)).toBe(allTidy);
  });
});
