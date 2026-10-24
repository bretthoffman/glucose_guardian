import { describe, expect, it } from "vitest";
import {
  activePens,
  addDays,
  daysBetween,
  defaultPenDays,
  endedPens,
  formatPenDate,
  mergePens,
  penBeingReplaced,
  penEndReasonLabel,
  penNeedsAttention,
  penReminders,
  penStatus,
  penTitle,
  toLocalDate,
  type PenLike,
} from "./pens";

const pen = (id: string, extra: object = {}): PenLike & { pendingSync?: boolean } => ({
  id,
  insulinLabel: "Lispro Junior · 100 u/mL",
  openedOn: "2026-10-05",
  goodForDays: 28,
  ...extra,
});

describe("dates", () => {
  it("counts calendar days and adds days across months and DST", () => {
    expect(daysBetween("2026-10-05", "2026-11-02")).toBe(28);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1); // US DST ends Nov 1, 2026
    expect(addDays("2026-10-05", 28)).toBe("2026-11-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(toLocalDate(new Date(2026, 0, 7))).toBe("2026-01-07");
    expect(formatPenDate("2026-10-05")).toBe("Oct 5");
  });
});

describe("defaultPenDays (from the label)", () => {
  it("28 for most, longer or shorter for the exceptions, 28 when unknown", () => {
    expect(defaultPenDays("Lispro Junior · 100 u/mL")).toBe(28);
    expect(defaultPenDays("Lantus · 100 u/mL")).toBe(28);
    expect(defaultPenDays("Toujeo · 300 u/mL")).toBe(56);
    expect(defaultPenDays("Tresiba · 100 u/mL")).toBe(56);
    expect(defaultPenDays("Levemir · 100 u/mL")).toBe(42);
    expect(defaultPenDays("Humulin N · 100 u/mL")).toBe(14);
    expect(defaultPenDays("NovoLog Mix 70/30 · 100 u/mL")).toBe(14);
    expect(defaultPenDays("Humalog Mix 75/25 · 100 u/mL")).toBe(10);
    expect(defaultPenDays("Something New")).toBe(28);
  });
  it("vials use the vial label, which differs for some insulins", () => {
    expect(defaultPenDays("Humalog · 100 u/mL", "vial")).toBe(28);
    expect(defaultPenDays("Humulin N · 100 u/mL", "vial")).toBe(31);
    expect(defaultPenDays("Humulin N · 100 u/mL", "pen")).toBe(14);
    expect(defaultPenDays("Novolin N · 100 u/mL", "vial")).toBe(42);
    expect(defaultPenDays("Novolin R · 100 u/mL", "vial")).toBe(42);
    expect(defaultPenDays("Humulin R · 100 u/mL", "vial")).toBe(31);
    expect(defaultPenDays("Tresiba · 100 u/mL", "vial")).toBe(56);
    expect(defaultPenDays("Humalog Mix 75/25 · 100 u/mL", "vial")).toBe(28);
    expect(defaultPenDays("Something New", "vial")).toBe(28);
  });
});

describe("penStatus", () => {
  it("opened Oct 5, 28 days: 13 left on Oct 20, change by Nov 2", () => {
    expect(penStatus(pen("a"), "2026-10-20")).toMatchObject({ daysLeft: 13, changeBy: "2026-11-02", tone: "ok", label: "13 days left" });
  });
  it("amber in the last 3 days, then today, then past", () => {
    expect(penStatus(pen("a"), "2026-10-30")).toMatchObject({ daysLeft: 3, tone: "soon" });
    expect(penStatus(pen("a"), "2026-11-01")).toMatchObject({ daysLeft: 1, tone: "soon", label: "1 day left" });
    expect(penStatus(pen("a"), "2026-11-02")).toMatchObject({ daysLeft: 0, tone: "today", label: "Change today" });
    expect(penStatus(pen("a"), "2026-11-04")).toMatchObject({ daysLeft: -2, tone: "over", label: "Past 28 days", fraction: 0 });
  });
});

describe("lists", () => {
  const pens = [
    pen("home", { name: "Home" }),
    pen("school", { name: "School", openedOn: "2026-09-24" }),
    pen("old", { endedOn: "2026-10-05", endReason: "used_up" }),
    pen("older", { endedOn: "2026-09-20", endReason: "reached_limit" }),
  ];
  it("open pens sorted most urgent first; ended newest first", () => {
    expect(activePens(pens, "2026-10-20").map((p) => p.id)).toEqual(["school", "home"]);
    expect(endedPens(pens).map((p) => p.id)).toEqual(["old", "older"]);
  });
  it("the tab dot shows only when an open pen is close or overdue", () => {
    expect(penNeedsAttention(pens, "2026-10-20")).toBe(true); // School: 2 days left
    expect(penNeedsAttention([pens[0]!], "2026-10-20")).toBe(false);
    expect(penNeedsAttention([pens[2]!], "2026-12-01")).toBe(false); // ended pens never count
  });
  it("a new pen replaces the open one with the same insulin and name only", () => {
    expect(penBeingReplaced(pens, "Lispro Junior · 100 u/mL", "home")?.id).toBe("home");
    expect(penBeingReplaced(pens, "Lispro Junior · 100 u/mL", "Backpack")).toBeNull();
    expect(penBeingReplaced(pens, "Lantus · 100 u/mL", "Home")).toBeNull();
    expect(penBeingReplaced([pen("x")], "Lispro Junior · 100 u/mL", undefined)?.id).toBe("x");
  });
  it("a vial never replaces a pen of the same insulin (and the other way round)", () => {
    const both = [pen("p", { insulinLabel: "Humalog · 100 u/mL" }), pen("v", { insulinLabel: "Humalog · 100 u/mL", form: "vial" })];
    expect(penBeingReplaced(both, "Humalog · 100 u/mL", undefined, "vial")?.id).toBe("v");
    expect(penBeingReplaced(both, "Humalog · 100 u/mL", undefined, "pen")?.id).toBe("p");
    expect(penBeingReplaced(both, "Humalog · 100 u/mL", undefined)?.id).toBe("p");
    expect(penBeingReplaced([both[0]!], "Humalog · 100 u/mL", undefined, "vial")).toBeNull();
  });
  it("titles and reasons", () => {
    expect(penTitle(pen("a", { name: "Home" }))).toBe("Lispro Junior pen · Home");
    expect(penTitle(pen("a"))).toBe("Lispro Junior pen");
    expect(penTitle(pen("a", { insulinLabel: "Humalog · 100 u/mL", form: "vial", name: "School" }))).toBe("Humalog vial · School");
    expect(penEndReasonLabel("lost", 28)).toBe("Lost or left somewhere");
    expect(penEndReasonLabel("reached_limit", 28)).toBe("Reached 28 days");
  });
});

describe("penReminders", () => {
  it("3 days before, the day before, and the change-by day", () => {
    const r = penReminders(pen("p", { name: "School" }), "2026-10-20", 8);
    expect(r.map((x) => x.date)).toEqual(["2026-10-30", "2026-11-01", "2026-11-02"]);
    expect(r[0]!.title).toBe("Lispro Junior pen · School: 3 days left");
    expect(r[0]!.body).toBe("Plan a new pen by Nov 2.");
    expect(r[2]!.title).toBe("Time to change the Lispro Junior pen · School");
    const v = penReminders(pen("v", { insulinLabel: "Humalog · 100 u/mL", form: "vial" }), "2026-10-20", 8);
    expect(v[0]!.title).toBe("Humalog vial: 3 days left");
    expect(v[1]!.body).toBe("Have a new vial ready.");
  });
  it("skips reminders already passed, including today's after 9 AM; none for ended pens", () => {
    expect(penReminders(pen("p"), "2026-11-01", 8).map((x) => x.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(penReminders(pen("p"), "2026-11-01", 10).map((x) => x.date)).toEqual(["2026-11-02"]);
    expect(penReminders(pen("p", { endedOn: "2026-10-20" }), "2026-10-20", 8)).toEqual([]);
  });
});

describe("mergePens", () => {
  const NOW = 1_800_000_000_000;
  it("cloud wins, except a local pen still waiting to sync", () => {
    const cloud = [pen("pen_1_a", { name: "Home" }), pen("pen_2_b")];
    const local = [{ ...pen("pen_1_a", { name: "School" }), pendingSync: true }, pen("pen_2_b", { name: "stale" })];
    const merged = mergePens(cloud, local, NOW);
    expect(merged.find((p) => p.id === "pen_1_a")?.name).toBe("School");
    expect(merged.find((p) => p.id === "pen_2_b")?.name).toBeUndefined();
  });
  it("keeps a brand-new local pen; drops an old one the cloud deleted", () => {
    const fresh = { ...pen(`pen_${NOW - 1000}_x`) };
    const deletedElsewhere = pen(`pen_${NOW - 10 * 60 * 1000}_y`);
    const pending = { ...pen(`pen_${NOW - 60 * 60 * 1000}_z`), pendingSync: true };
    expect(mergePens([], [fresh, deletedElsewhere, pending], NOW).map((p) => p.id)).toEqual([fresh.id, pending.id]);
  });
});
