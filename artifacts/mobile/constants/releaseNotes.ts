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
    id: "2026-10-22d",
    date: "2026-10-22",
    items: [
      {
        icon: "check-square",
        title: "Choose what goes in the PDF",
        body: "In Doctor Office, tap the sections you want: daily pattern, each day, food log, insulin log, lows, finger sticks, and more. Your picks are remembered.",
      },
      {
        icon: "eye",
        title: "Preview before you send",
        body: "Tap Preview to flip through every page of the PDF first, then Download PDF to save or send it.",
      },
      {
        icon: "activity",
        title: "A glucose graph for every day",
        body: "The food log now shows each day's glucose with every meal marked on it, so the doctor can see what happened after each meal.",
      },
    ],
  },
  {
    id: "2026-10-22c",
    date: "2026-10-22",
    items: [
      {
        icon: "file-text",
        title: "Visit Summary PDF for the doctor",
        body: "Dashboard → Doctor Office. Pick 7, 14, 30, or 90 days and tap Download PDF. It shows time in range, the daily pattern, lows, insulin, and every meal with the glucose before and 2 hours after.",
      },
      {
        icon: "send",
        title: "Send it your way",
        body: "Save the PDF to Files, or send it to the doctor by email, text, or your patient portal like MyChart.",
      },
    ],
  },
  {
    id: "2026-10-22b",
    date: "2026-10-22",
    items: [
      {
        icon: "star",
        title: "A fresh new look",
        body: "The app now uses the Glucose Guardian logo colors, and our logo greets you while the app opens.",
      },
      {
        icon: "x-circle",
        title: "Easier to close",
        body: "The X on every popup and card is now bigger and easier to see.",
      },
      {
        icon: "help-circle",
        title: "Help guide updated",
        body: "Tap Help at the top of the Dashboard for a walk through the newest features.",
      },
    ],
  },
  {
    id: "2026-10-22",
    date: "2026-10-22",
    items: [
      {
        icon: "camera",
        title: "Enter your own carbs on a photo",
        body: "If we can't figure out the carbs from a food photo, the photo stays. Type each food and its carbs, and we'll add them up. The photo is saved with the meal.",
      },
      {
        icon: "plus-circle",
        title: "Add a food it missed",
        body: "On a photo result, tap Add a food it missed to add anything that wasn't counted, like a side or a drink.",
      },
    ],
  },
  {
    id: "2026-10-20b",
    date: "2026-10-20",
    items: [
      {
        icon: "clock",
        title: "Pen countdown",
        body: "On the Insulin page, start a pen when you open it and we'll count down the days until it's time to change it.",
      },
      {
        icon: "bell",
        title: "Pen reminders",
        body: "You'll get a reminder 3 days before, the day before, and the day to change the pen.",
      },
      {
        icon: "alert-triangle",
        title: "Insulin stacking reminder",
        body: "If insulin was logged in the last 2 hours, you'll see how much is still working before you log more.",
      },
    ],
  },
  {
    id: "2026-10-20",
    date: "2026-10-20",
    items: [
      {
        icon: "clock",
        title: "Recent and Favorites",
        body: "Quick Lookup on the Food page now has two tabs: foods you logged lately, and the ones you saved.",
      },
      {
        icon: "heart",
        title: "Edit or favorite in one tap",
        body: "Tap the pencil to fix a log or a favorite's carbs. Tap the heart to add or remove a favorite.",
      },
      {
        icon: "check-circle",
        title: "Your carbs stick",
        body: "When you correct a food's carbs, that's the number it starts from next time.",
      },
    ],
  },
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
        body: "Finger sticks show as blue drops on the Log graph, next to the Dexcom reading.",
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
