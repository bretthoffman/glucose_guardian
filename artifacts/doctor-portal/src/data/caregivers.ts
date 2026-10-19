/**
 * Doctor-assigned labels for the Care Circle members who log for a patient ("Holly" → Mother).
 * Entries only carry the logger's display name, so the doctor can tag who each person is. Labels
 * are saved per doctor per patient on the backend and are only visible to that doctor.
 */

export type CaregiverTitle = "mother" | "father" | "family_member" | "school_nurse" | "organization";

export const CAREGIVER_TITLE_OPTIONS: {
  value: CaregiverTitle;
  label: string;
  /** Placeholder for the optional specifics field. */
  detailHint: string;
}[] = [
  { value: "mother", label: "Mother", detailHint: "Optional note" },
  { value: "father", label: "Father", detailHint: "Optional note" },
  { value: "family_member", label: "Family Member", detailHint: "e.g. Grandmother, Aunt" },
  { value: "school_nurse", label: "School Nurse", detailHint: "e.g. Lincoln Elementary" },
  { value: "organization", label: "Organization", detailHint: "e.g. Church, Daycare, Camp" },
];

export interface CaregiverTitleEntry {
  name: string;
  title: CaregiverTitle;
  detail?: string;
  updatedAt: number;
}

/** Names match case- and spacing-insensitively, the same rule the backend uses. */
export function caregiverKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Mother", "Organization · Grace Church". */
export function titleLabel(entry: Pick<CaregiverTitleEntry, "title" | "detail">): string {
  const base = CAREGIVER_TITLE_OPTIONS.find((o) => o.value === entry.title)?.label ?? entry.title;
  return entry.detail ? `${base} · ${entry.detail}` : base;
}
