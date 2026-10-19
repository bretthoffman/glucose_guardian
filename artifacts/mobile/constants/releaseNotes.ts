/**
 * Release notes shown in "What's new" — bundled with the app, so every over-the-air update carries
 * its own notes. NEWEST FIRST.
 *
 * When you publish an update that users will notice, add an entry at the TOP with a new unique `id`
 * (the publish date works; add a suffix like "2026-10-19b" for a second update the same day). After
 * the update installs, each device shows the newest entry once, then it lives in Dashboard →
 * What's new. Bug-fix-only updates don't need an entry.
 *
 * Write for patients and families: short, plain words, what they can now DO and where to find it.
 */
import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";

export interface ReleaseNoteItem {
  icon: ComponentProps<typeof Feather>["name"];
  title: string;
  body: string;
}

export interface ReleaseNote {
  /** Unique, never reused. */
  id: string;
  /** YYYY-MM-DD, shown as "Oct 19". */
  date: string;
  items: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "2026-10-19",
    date: "2026-10-19",
    items: [
      {
        icon: "droplet",
        title: "Log finger sticks",
        body: "On the Log page, tap Add Entry → Finger Stick. We'll compare it with your Dexcom reading from the same moment.",
      },
      {
        icon: "trending-up",
        title: "See them on your graph",
        body: "Finger sticks show as purple drops on the Log graph, next to the Dexcom reading.",
      },
      {
        icon: "zap",
        title: "Check before dosing",
        body: "When the dose calculator suggests checking with a finger stick, tap Enter finger stick to log it right there.",
      },
      {
        icon: "gift",
        title: "What's new",
        body: "After each update you'll see what changed. Past updates are on the Dashboard.",
      },
    ],
  },
];
