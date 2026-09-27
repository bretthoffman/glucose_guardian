/**
 * The Help Mode walkthrough scripts — pure data, no React Native imports (unit-tested in the root
 * vitest run). One script per tab page; each step names an ANCHOR the page registers via
 * `useHelpAnchor`, and the overlay spotlights that element with the step's explanation.
 *
 * Steps whose anchor is not currently rendered (conditional UI — notices, on-board bars) are
 * skipped automatically, so scripts can cover everything a page CAN show.
 *
 * `effects` are declarative flags a page may react to while that step is active — e.g. the Insulin
 * page shows its Log tab for the steps tagged "insulin.logTab". Pages must treat them as VIEW state
 * only: help mode never writes data.
 */
export type HelpStep = {
  id: string;
  anchor: string;
  title: string;
  text: string;
  effects?: readonly string[];
};

export type HelpPageId = "home" | "insulin" | "food" | "chat";

/** Every effect a script may carry — pages switch on these; the test pins the set. */
export const HELP_EFFECTS = ["insulin.logTab"] as const;

const home: HelpStep[] = [
  {
    id: "home.gauge",
    anchor: "home.gauge",
    title: "Your glucose reading",
    text:
      "The big number is the latest reading, in mg/dL. The circle's color follows where the reading sits: green in range, amber above your high line, red when it's low or very high. The soft outer ring pulses at the speed glucose is changing — a slow, calm ripple means steady; a quick red pulse means it's moving fast. Tapping the circle opens a list of the most recent readings with their times.",
  },
  {
    id: "home.trend",
    anchor: "home.trend",
    title: "Direction and movement",
    text:
      "The arrow shows which way glucose is heading: → steady, ↗ or ↘ drifting slowly, a straight up or down arrow moving fast, and a double arrow very fast. The pill under it names the movement, colored by urgency — green when calm, amber when drifting, red when fast. \"Updated\" tells you how fresh the reading is. Tapping here opens the movement details.",
  },
  {
    id: "home.cgmChip",
    anchor: "home.cgmChip",
    title: "Your CGM connection",
    text:
      "This chip is the sensor link — Dexcom or Libre. Green means connected, and it shows how many new readings arrived and when. If it ever says attention is needed, tapping it opens the connection screen where you can sign in again or switch devices.",
  },
  {
    id: "home.logsBtn",
    anchor: "home.logsBtn",
    title: "Logs shortcut",
    text: "A quick jump to the day's Event Log — every insulin dose and meal, on the Insulin page's Log tab.",
  },
  {
    id: "home.rangeToggle",
    anchor: "home.rangeToggle",
    title: "Time window",
    text: "Choose how much history the graph shows — the last 3, 6, 12, or 24 hours. The highlighted one is what's on screen.",
  },
  {
    id: "home.chart",
    anchor: "home.chart",
    title: "The glucose graph",
    text:
      "The line is colored by zone — green in range, amber above your high line, red when very high or low — and the shading between the line and the purple target line fills in the same colors. Dashed lines are your alert thresholds. Small icons along the target line are logged insulin and meals; tap one to open that entry. Tap the graph to switch to a dotted per-reading view, and press-and-hold to open the slicer — drag it to read the exact value at any time.",
  },
  {
    id: "home.notices",
    anchor: "home.notices",
    title: "Notices",
    text:
      "When something needs attention it appears here, colored by urgency — a sensor issue, a fast rise or fall, an unusual pattern, or an emergency alert. Each one explains itself and goes away when it's resolved.",
  },
];

const insulin: HelpStep[] = [
  {
    id: "insulin.tabs",
    anchor: "insulin.tabs",
    title: "Dose and Log",
    text: "Two tabs: Dose is the calculator, Log is the day-by-day record of insulin and meals. We'll tour both.",
  },
  {
    id: "insulin.glucosePill",
    anchor: "insulin.glucosePill",
    title: "Live reading",
    text: "The current glucose and status ride along at the top of this page (and Food and Chat), so you never dose blind.",
  },
  {
    id: "insulin.selector",
    anchor: "insulin.selector",
    title: "Which insulin",
    text:
      "Pick the insulin you're dosing. A rapid (mealtime) insulin shows the carb calculator below; a long-acting one switches this page to the once-a-day basal view instead.",
  },
  {
    id: "insulin.inputs",
    anchor: "insulin.inputs",
    title: "The inputs",
    text:
      "Carbs you're about to eat — tap to type them. Current BG fills in live from the sensor (the LIVE tag); you can tap it to override with a meter reading. Guidance notes appear right below when they matter, like \"below target — consider a snack instead\".",
  },
  {
    id: "insulin.onBoard",
    anchor: "insulin.onBoard",
    title: "Still active",
    text:
      "After you log a dose or a meal, these bars show what's still working — insulin and carbs on board. They drain over the absorption window (the small \"6H\"), and the calculator automatically subtracts active insulin so doses never stack.",
  },
  {
    id: "insulin.calc",
    anchor: "insulin.calc",
    title: "How your dose is calculated",
    text:
      "The four pieces of the math: a correction for your current BG, the dose for the carbs, carbs still active, minus insulin still active. Tap any piece to see its exact numbers and the settings behind it.",
  },
  {
    id: "insulin.suggest",
    anchor: "insulin.suggest",
    title: "Suggested dose",
    text:
      "The result. The purple badge is the suggested amount — tap it to adjust before logging; an adjusted dose is marked so the record stays honest.",
  },
  {
    id: "insulin.predict",
    anchor: "insulin.predict",
    title: "Predict",
    text:
      "Draws an AI projection of the next few hours from your own history with similar meals and doses. It only runs when you tap it, and it never changes the suggested dose.",
  },
  {
    id: "insulin.tookDose",
    anchor: "insulin.tookDose",
    title: "I Just Took This Dose",
    text:
      "Logs the shown dose with one tap — it lands in the Log tab, counts as insulin on board, and syncs to your care circle and doctor. The button turns green once it's recorded.",
  },
  {
    id: "insulin.disclaimer",
    anchor: "insulin.disclaimer",
    title: "A reminder",
    text: "The calculator estimates — your care team's instructions always come first.",
  },
  {
    id: "insulin.log.calendar",
    anchor: "insulin.log.calendar",
    title: "The Log tab",
    text: "This is the day record. The calendar button jumps straight to any date.",
    effects: HELP_EFFECTS.filter((e) => e === "insulin.logTab"),
  },
  {
    id: "insulin.log.dayNav",
    anchor: "insulin.log.dayNav",
    title: "Day by day",
    text: "Step between days with the arrows — Today, Yesterday, and back as far as your history goes.",
    effects: ["insulin.logTab"],
  },
  {
    id: "insulin.log.chart",
    anchor: "insulin.log.chart",
    title: "The day's graph",
    text:
      "The full day, midnight to midnight, with the same zone colors as the Glucose page. Icons on the target line are that day's doses and meals — tap one to open it. Pinch to zoom into a slice of the day.",
    effects: ["insulin.logTab"],
  },
  {
    id: "insulin.log.events",
    anchor: "insulin.log.events",
    title: "Event Log",
    text:
      "Every entry for the day — insulin and meals together, newest first. Tap an entry to see its details, and to edit or delete it if your role allows.",
    effects: ["insulin.logTab"],
  },
  {
    id: "insulin.log.add",
    anchor: "insulin.log.add",
    title: "Add Entry",
    text: "Log something after the fact — an insulin dose or a meal — onto whichever day you're viewing.",
    effects: ["insulin.logTab"],
  },
];

const food: HelpStep[] = [
  {
    id: "food.trend",
    anchor: "food.trend",
    title: "Trend at a glance",
    text: "The same movement status as the Glucose page, so you can sanity-check before a meal.",
  },
  {
    id: "food.scan",
    anchor: "food.scan",
    title: "Scan or take a photo",
    text:
      "The fastest way to log a meal. The camera has two modes on its bottom toggle: Food takes a photo and the AI identifies what's on the plate and estimates the carbs; Barcode shows a purple frame — hold a package's barcode inside it and the label's nutrition is pulled automatically, with a servings picker for multi-serving packages.",
  },
  {
    id: "food.search",
    anchor: "food.search",
    title: "Search by name",
    text:
      "Type any food to estimate its carbs. The button on the right opens your photo library instead, for a picture you already took.",
  },
  {
    id: "food.estimate",
    anchor: "food.estimate",
    title: "Estimate Carbs",
    text:
      "Runs the lookup for what you typed. The result card shows the carbs (tap the number to correct it), a spike forecast, and buttons to calculate insulin for it or log it as a meal.",
  },
  {
    id: "food.quick",
    anchor: "food.quick",
    title: "Quick Lookup",
    text:
      "Your saved foods — one tap re-runs the lookup with its carbs shown on the right. After any result, \"Save to Quick Lookup\" adds it here for next time.",
  },
  {
    id: "food.seeAll",
    anchor: "food.seeAll",
    title: "See All",
    text:
      "The full saved list. Swipe a row left to delete it; press and drag the ≡ handle to reorder — the first eight are the ones that show on this page.",
  },
];

const chat: HelpStep[] = [
  {
    id: "chat.messages",
    anchor: "chat.messages",
    title: "Messages",
    text:
      "Real people live here — your doctor thread and everyone in the care circle, iMessage-style. The badge counts unread messages.",
  },
  {
    id: "chat.thread",
    anchor: "chat.thread",
    title: "The assistant",
    text:
      "This chat is the AI assistant. It already knows the current reading, the trend, and your settings, so you can ask things like \"why am I high?\" or \"can I have a snack?\" It explains — it never changes doses, and it isn't medical advice.",
  },
  {
    id: "chat.suggestions",
    anchor: "chat.suggestions",
    title: "Ready-made questions",
    text: "Common questions, one tap to ask. They change with the situation.",
  },
  {
    id: "chat.input",
    anchor: "chat.input",
    title: "Ask anything",
    text: "Or type your own question and send. Answers arrive right in the thread.",
  },
];

export const HELP_SCRIPTS: Record<HelpPageId, HelpStep[]> = { home, insulin, food, chat };

/** Route pathname → script page (expo-router tabs). The Dashboard deliberately has NO script yet. */
export const HELP_PAGE_FOR_PATH: Record<string, HelpPageId> = {
  "/": "home",
  "/index": "home",
  "/insulin": "insulin",
  "/food": "food",
  "/chat": "chat",
};
