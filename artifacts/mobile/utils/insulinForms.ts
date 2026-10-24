/**
 * Pen or vial — which insulins a family takes, and how (pure, unit-tested).
 *
 * The profile keeps three lists of the same chip labels ("Humalog · 100 u/mL"):
 *  - insulinTypes: every insulin they use (the calculator and everything else read only this)
 *  - insulinPens:  the ones they take as a pen
 *  - insulinVials: the ones they take as a vial (drawn up with a syringe)
 * insulinTypes is always the union of the other two once the family has picked pen or vial.
 *
 * Accounts set up before pen/vial existed have no pen/vial lists: each insulin counts as a pen
 * (or as a vial when it only comes as one), which is exactly what the app showed before.
 */
import { findInsulinByChipLabel, type InsulinForm } from "../constants/insulin";

export interface InsulinChoice {
  insulinTypes?: string[];
  insulinPens?: string[];
  insulinVials?: string[];
}

export interface InsulinSupply {
  /** Chip label, e.g. "Humalog · 100 u/mL". */
  label: string;
  form: InsulinForm;
}

/** Forms this insulin is sold as; unknown labels allow both. */
export function formsAvailable(label: string): readonly InsulinForm[] {
  return findInsulinByChipLabel(label)?.forms ?? ["pen", "vial"];
}

function defaultForm(label: string): InsulinForm {
  return formsAvailable(label).includes("pen") ? "pen" : "vial";
}

function hasFormLists(c: InsulinChoice): boolean {
  return Array.isArray(c.insulinPens) || Array.isArray(c.insulinVials);
}

/** How this insulin is taken ([] when it isn't one of theirs). Pens first. */
export function formsTaken(c: InsulinChoice, label: string): InsulinForm[] {
  if (!(c.insulinTypes ?? []).includes(label)) return [];
  if (!hasFormLists(c)) return [defaultForm(label)];
  const out: InsulinForm[] = [];
  if (c.insulinPens?.includes(label)) out.push("pen");
  if (c.insulinVials?.includes(label)) out.push("vial");
  // In insulinTypes but neither list (an older app version added it): treat like before.
  return out.length > 0 ? out : [defaultForm(label)];
}

/** True when this insulin is picked in this form (what the pen/vial chips show). */
export function isTaken(c: InsulinChoice, label: string, form: InsulinForm): boolean {
  return formsTaken(c, label).includes(form);
}

/** Every insulin + form the family uses, in insulinTypes order, pens before vials. */
export function suppliesTaken(c: InsulinChoice): InsulinSupply[] {
  return (c.insulinTypes ?? []).flatMap((label) => formsTaken(c, label).map((form) => ({ label, form })));
}

/**
 * Turn one insulin on or off in one form. Returns all three lists (always written together), with
 * insulinTypes kept in its existing order and new insulins added at the end.
 */
export function toggleInsulinForm(
  c: InsulinChoice,
  label: string,
  form: InsulinForm,
): { insulinTypes: string[]; insulinPens: string[]; insulinVials: string[] } {
  const types = c.insulinTypes ?? [];
  const pens = types.filter((l) => isTaken(c, l, "pen"));
  const vials = types.filter((l) => isTaken(c, l, "vial"));
  const list = form === "pen" ? pens : vials;
  const nextList = list.includes(label) ? list.filter((l) => l !== label) : [...list, label];
  const insulinPens = form === "pen" ? nextList : pens;
  const insulinVials = form === "vial" ? nextList : vials;
  const inUse = (l: string) => insulinPens.includes(l) || insulinVials.includes(l);
  const insulinTypes = [...types.filter(inUse), ...[label].filter((l) => inUse(l) && !types.includes(l))];
  return { insulinTypes, insulinPens, insulinVials };
}

/** "pen" / "vial" (a pen when unknown — every countdown before vials existed was a pen). */
export function formWord(form: InsulinForm | undefined): InsulinForm {
  return form === "vial" ? "vial" : "pen";
}
