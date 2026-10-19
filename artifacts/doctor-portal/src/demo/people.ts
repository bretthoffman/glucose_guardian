import type { CaregiverTitle } from "@/data/caregivers";

/**
 * The demo's sample patients: made-up people across age groups. Their treatment settings and
 * daily habits drive the simulated data (simulate.ts). Nothing here describes a real person.
 */

export type MealSlot = "breakfast" | "lunch" | "snack" | "dinner" | "bedtime";
export type Absorption = "fast" | "medium" | "slow";

export interface DemoFood {
  name: string;
  fat: number;
  protein: number;
  absorption: Absorption;
}

export interface MealPlan {
  slot: MealSlot;
  /** Local time window, in hours (7.5 = 7:30 AM). */
  at: [number, number];
  carbs: [number, number];
  /** Chance the meal happens on a given day (default: always). */
  chance?: number;
  days?: "weekdays" | "weekends";
  foods: DemoFood[];
  /** Name of who logs it (matches a Care Circle member), weekdays / weekends. */
  loggedBy: { weekday: string; weekend: string };
  /** No mealtime insulin for this meal (e.g. type 2 on basal + dinner insulin). */
  noBolus?: boolean;
  /** Share of the calculated dose this meal really needs (<1: the settings overshoot, so lows follow). */
  insulinNeed?: number;
  /** A fixed meal on one weekday (e.g. Friday pizza night). */
  special?: { day: number; food: DemoFood; carbs: number };
}

export interface DemoCircleMember {
  id: string;
  name: string;
  kind: "owner" | "patient" | "co_guardian" | "caregiver_code" | "patient_device";
  accounts?: { name: string; organization?: string }[];
  messaging: "parents" | "nurse" | null;
  title?: CaregiverTitle;
  titleDetail?: string;
}

export interface DemoMessage {
  daysAgo: number;
  hour: number;
  sender: "doctor" | "guardian";
  text: string;
}

export interface DemoPerson {
  /** The patient's Doctor Code in the demo. */
  code: string;
  firstName: string;
  lastName: string;
  age: number;
  birthday: [month: number, day: number];
  diabetesType: "type1" | "type2";
  weightLbs: number;
  parentName?: string;
  rapid: string;
  basal: { insulin: string; units: number; hour: number; loggedBy: string };
  carbRatio: number;
  correctionFactor: number;
  targetGlucose: number;
  doseSettingsByTime?: Record<string, { carbRatio?: number; correctionFactor?: number }>;
  /** Simulation: glucose with nothing going on, overnight rise, and wobble (mg/dL). */
  base: number;
  dawn: number;
  noise: number;
  /** Type 2: share of a meal's carbs the body still handles on its own. */
  ownInsulin?: number;
  meals: MealPlan[];
  habits: { missBolus: number; lateBolus: number; overBolus: number; underBolus: number; adjusts: number };
  activities?: { days: number[]; at: number; hours: number; drop: number; chance?: number }[];
  circle: DemoCircleMember[];
  nurse?: { codeId: string; name: string; account: string };
  labA1c: { value: number; daysAgo: number };
  /** Settings over time; the last entry is the current one. */
  settingsHistory: { daysAgo: number; carbRatio: number; correctionFactor: number; targetGlucose: number }[];
  messages: DemoMessage[];
  nurseMessages?: { daysAgo: number; hour: number; fromDoctor: boolean; text: string }[];
  pendingProposal?: { daysAgo: number; note: string; carbRatio?: number; correctionFactor?: number; targetGlucose?: number };
  lastDecision?: { daysAgo: number; status: "approved" | "declined" };
  /** What the assistant mentions about this patient's pattern. */
  pattern: string;
}

const f = (name: string, fat: number, protein: number, absorption: Absorption): DemoFood => ({
  name,
  fat,
  protein,
  absorption,
});

export const DEMO_DOCTOR = {
  doctorId: "demo-doctor",
  email: "jordan.lee@demo.glucoseguardian.example",
  displayName: "Dr. Jordan Lee",
  title: "Dr.",
  firstName: "Jordan",
  lastName: "Lee",
  specialty: "Endocrinology",
  institution: "Riverside Diabetes Center (demo)",
  hasPin: false,
};

export const DEMO_PEOPLE: DemoPerson[] = [
  {
    code: "DEMO01",
    firstName: "Ava",
    lastName: "Martinez",
    age: 7,
    birthday: [3, 14],
    diabetesType: "type1",
    weightLbs: 52,
    parentName: "Elena Martinez",
    rapid: "Humalog · 100 u/mL",
    basal: { insulin: "Lantus · 100 u/mL", units: 6, hour: 20, loggedBy: "Elena Martinez" },
    carbRatio: 28,
    correctionFactor: 110,
    targetGlucose: 125,
    doseSettingsByTime: { breakfast: { carbRatio: 22 } },
    base: 132,
    dawn: 0,
    noise: 14,
    meals: [
      {
        slot: "breakfast",
        at: [7, 7.5],
        carbs: [30, 42],
        foods: [
          f("Pancakes with syrup", 8, 6, "medium"),
          f("Cheerios with milk", 4, 7, "fast"),
          f("Waffle with strawberries", 7, 5, "medium"),
          f("Yogurt and granola", 5, 9, "medium"),
        ],
        loggedBy: { weekday: "Elena Martinez", weekend: "Carlos Martinez" },
      },
      {
        slot: "lunch",
        at: [11.6, 12],
        carbs: [35, 50],
        days: "weekdays",
        insulinNeed: 0.72,
        foods: [
          f("Turkey sandwich and apple slices", 9, 14, "medium"),
          f("Mac and cheese with carrots", 14, 12, "medium"),
          f("Chicken nuggets and fruit cup", 12, 15, "medium"),
          f("Cheese pizza slice and milk", 12, 13, "slow"),
        ],
        loggedBy: { weekday: "Lincoln Elementary Nurse", weekend: "Elena Martinez" },
      },
      {
        slot: "lunch",
        at: [12, 12.8],
        carbs: [35, 48],
        days: "weekends",
        foods: [f("Quesadilla and grapes", 14, 13, "medium"), f("PB&J and milk", 12, 11, "medium")],
        loggedBy: { weekday: "Elena Martinez", weekend: "Elena Martinez" },
      },
      {
        slot: "snack",
        at: [15.3, 15.8],
        carbs: [14, 20],
        chance: 0.75,
        foods: [
          f("Goldfish crackers", 5, 3, "fast"),
          f("Apple with peanut butter", 8, 4, "slow"),
          f("Granola bar", 5, 2, "medium"),
        ],
        loggedBy: { weekday: "Grandma Rosa", weekend: "Carlos Martinez" },
      },
      {
        slot: "dinner",
        at: [17.8, 18.5],
        carbs: [40, 55],
        foods: [
          f("Spaghetti and meatballs", 16, 18, "medium"),
          f("Chicken tacos", 14, 20, "medium"),
          f("Grilled cheese and tomato soup", 18, 14, "medium"),
          f("Rice, beans and chicken", 10, 22, "slow"),
        ],
        loggedBy: { weekday: "Elena Martinez", weekend: "Carlos Martinez" },
      },
    ],
    habits: { missBolus: 0.02, lateBolus: 0.1, overBolus: 0.1, underBolus: 0.1, adjusts: 0.15 },
    activities: [{ days: [1, 2, 3, 4, 5], at: 12.75, hours: 0.5, drop: 78, chance: 0.85 }],
    circle: [
      { id: "user:elena", name: "Elena Martinez", kind: "owner", messaging: "parents", title: "mother" },
      { id: "user:carlos", name: "Carlos Martinez", kind: "co_guardian", messaging: "parents", title: "father" },
      {
        id: "code:nurse-ava",
        name: "Lincoln Elementary Nurse",
        kind: "caregiver_code",
        accounts: [{ name: "Karen Wells, RN", organization: "Lincoln Elementary" }],
        messaging: "nurse",
        title: "school_nurse",
      },
      { id: "code:rosa", name: "Grandma Rosa", kind: "caregiver_code", messaging: null, title: "family_member", titleDetail: "Grandmother" },
    ],
    nurse: { codeId: "nurse-ava", name: "Lincoln Elementary Nurse", account: "Karen Wells, RN" },
    labA1c: { value: 7.4, daysAgo: 58 },
    settingsHistory: [
      { daysAgo: 120, carbRatio: 30, correctionFactor: 120, targetGlucose: 125 },
      { daysAgo: 34, carbRatio: 28, correctionFactor: 110, targetGlucose: 125 },
    ],
    messages: [
      {
        daysAgo: 6,
        hour: 16.2,
        sender: "guardian",
        text: "Hi Dr. Lee, Ava has been dropping after recess most school days. Nurse Wells gives her a snack, but she still gets into the 60s. Should we lower her lunch dose?",
      },
      {
        daysAgo: 5,
        hour: 9.4,
        sender: "doctor",
        text: "Thanks for flagging this. I see the lows between 1 and 2 PM on school days. I'll send a small change through the app for you to review.",
      },
      { daysAgo: 2, hour: 19.1, sender: "guardian", text: "Got it, thank you! We'll watch it this week." },
    ],
    nurseMessages: [
      { daysAgo: 4, hour: 13.4, fromDoctor: false, text: "Ava was 64 after recess today. Gave 15 g juice, back to 112 by 1:50." },
      { daysAgo: 4, hour: 15.1, fromDoctor: true, text: "Thank you, Karen. That's exactly right. Please keep checking her before recess this week." },
    ],
    pendingProposal: {
      daysAgo: 2,
      note: "Less lunch insulin on school days to prevent the lows after recess.",
      carbRatio: 32,
    },
    pattern: "Most of her lows happen between 1 and 2 PM on school days, right after recess.",
  },
  {
    code: "DEMO02",
    firstName: "Noah",
    lastName: "Williams",
    age: 12,
    birthday: [8, 2],
    diabetesType: "type1",
    weightLbs: 92,
    parentName: "Jessica Williams",
    rapid: "NovoLog · 100 u/mL",
    basal: { insulin: "Tresiba · 100 u/mL", units: 14, hour: 21, loggedBy: "Jessica Williams" },
    carbRatio: 15,
    correctionFactor: 70,
    targetGlucose: 120,
    base: 128,
    dawn: 10,
    noise: 16,
    meals: [
      {
        slot: "breakfast",
        at: [7, 7.4],
        carbs: [40, 55],
        foods: [
          f("Bagel with cream cheese", 10, 11, "medium"),
          f("Scrambled eggs and toast", 14, 18, "medium"),
          f("Cereal with banana", 4, 8, "fast"),
          f("Breakfast burrito", 16, 17, "slow"),
        ],
        loggedBy: { weekday: "Jessica Williams", weekend: "Mike Williams" },
      },
      {
        slot: "lunch",
        at: [11.4, 11.8],
        carbs: [55, 70],
        days: "weekdays",
        foods: [
          f("Pizza slice and salad", 16, 15, "slow"),
          f("Chicken sandwich and chips", 18, 24, "medium"),
          f("Pasta salad with fruit", 10, 12, "medium"),
        ],
        loggedBy: { weekday: "Westview Middle Nurse", weekend: "Jessica Williams" },
      },
      {
        slot: "lunch",
        at: [12.2, 13],
        carbs: [50, 65],
        days: "weekends",
        foods: [f("Burger and fries", 26, 25, "slow"), f("Turkey club wrap", 14, 22, "medium")],
        loggedBy: { weekday: "Mike Williams", weekend: "Mike Williams" },
      },
      {
        slot: "snack",
        at: [15.6, 16],
        carbs: [20, 30],
        chance: 0.8,
        foods: [
          f("Banana and sports drink", 0, 1, "fast"),
          f("Granola bar and juice", 5, 3, "fast"),
          f("Crackers and cheese", 9, 7, "medium"),
        ],
        loggedBy: { weekday: "Noah", weekend: "Noah" },
      },
      {
        slot: "dinner",
        at: [18.5, 19.3],
        carbs: [60, 80],
        foods: [
          f("Chicken stir-fry with rice", 12, 30, "medium"),
          f("Lasagna", 22, 26, "slow"),
          f("Tacos (3)", 20, 24, "medium"),
          f("Spaghetti and garlic bread", 14, 18, "medium"),
        ],
        loggedBy: { weekday: "Jessica Williams", weekend: "Mike Williams" },
      },
    ],
    habits: { missBolus: 0.03, lateBolus: 0.1, overBolus: 0.05, underBolus: 0.1, adjusts: 0.2 },
    activities: [
      { days: [2, 4], at: 16.5, hours: 1.5, drop: 105 },
      { days: [6], at: 10, hours: 1.5, drop: 60, chance: 0.8 },
    ],
    circle: [
      { id: "user:jessica", name: "Jessica Williams", kind: "owner", messaging: "parents", title: "mother" },
      { id: "user:mike", name: "Mike Williams", kind: "co_guardian", messaging: "parents", title: "father" },
      {
        id: "code:nurse-noah",
        name: "Westview Middle Nurse",
        kind: "caregiver_code",
        accounts: [{ name: "James Ortiz, RN", organization: "Westview Middle School" }],
        messaging: "nurse",
        title: "school_nurse",
      },
      { id: "device:noah", name: "Noah's phone", kind: "patient_device", messaging: null },
    ],
    nurse: { codeId: "nurse-noah", name: "Westview Middle Nurse", account: "James Ortiz, RN" },
    labA1c: { value: 7.0, daysAgo: 85 },
    settingsHistory: [
      { daysAgo: 150, carbRatio: 16, correctionFactor: 80, targetGlucose: 120 },
      { daysAgo: 41, carbRatio: 15, correctionFactor: 70, targetGlucose: 120 },
    ],
    messages: [
      {
        daysAgo: 9,
        hour: 20.3,
        sender: "guardian",
        text: "Noah went low (58) during soccer practice again on Thursday. He had his snack beforehand. Anything else we should try?",
      },
      {
        daysAgo: 8,
        hour: 10.2,
        sender: "doctor",
        text: "On practice days, have him take about 25% less insulin with his afternoon snack and keep fast sugar on the sideline. Let's review after two weeks of practices.",
      },
      { daysAgo: 8, hour: 18.7, sender: "guardian", text: "Will do. Thanks!" },
    ],
    nurseMessages: [
      { daysAgo: 3, hour: 11.9, fromDoctor: false, text: "Noah forgot to log lunch today. I helped him enter it at 12:10." },
    ],
    lastDecision: { daysAgo: 41, status: "approved" },
    pattern: "Lows cluster on Tuesday and Thursday evenings, during and after soccer practice.",
  },
  {
    code: "DEMO03",
    firstName: "Sophia",
    lastName: "Chen",
    age: 16,
    birthday: [11, 21],
    diabetesType: "type1",
    weightLbs: 125,
    parentName: "Mei Chen",
    rapid: "Humalog · 100 u/mL",
    basal: { insulin: "Lantus · 100 u/mL", units: 22, hour: 22, loggedBy: "Sophia" },
    carbRatio: 10,
    correctionFactor: 45,
    targetGlucose: 110,
    doseSettingsByTime: { dinner: { carbRatio: 9 } },
    base: 150,
    dawn: 30,
    noise: 18,
    meals: [
      {
        slot: "breakfast",
        at: [7.2, 7.6],
        carbs: [30, 45],
        chance: 0.6,
        foods: [f("Toast with peanut butter", 12, 9, "medium"), f("Fruit smoothie", 3, 6, "fast"), f("Granola bar", 5, 3, "medium")],
        loggedBy: { weekday: "Sophia", weekend: "Sophia" },
      },
      {
        slot: "lunch",
        at: [12, 12.5],
        carbs: [55, 75],
        foods: [
          f("Burrito bowl", 18, 28, "slow"),
          f("Sushi rolls", 6, 18, "medium"),
          f("Pizza (2 slices)", 22, 22, "slow"),
          f("Chicken wrap and chips", 18, 24, "medium"),
        ],
        loggedBy: { weekday: "Sophia", weekend: "Sophia" },
      },
      {
        slot: "snack",
        at: [16, 17],
        carbs: [25, 40],
        chance: 0.6,
        foods: [f("Chips", 10, 2, "medium"), f("Iced coffee drink", 6, 4, "fast"), f("Cookies", 9, 2, "fast")],
        loggedBy: { weekday: "Sophia", weekend: "Sophia" },
      },
      {
        slot: "dinner",
        at: [19, 20],
        carbs: [60, 85],
        foods: [
          f("Pasta alfredo", 28, 20, "slow"),
          f("Beef and broccoli with rice", 14, 26, "medium"),
          f("Chicken teriyaki and rice", 10, 30, "medium"),
          f("Ramen", 16, 14, "medium"),
        ],
        loggedBy: { weekday: "Mei Chen", weekend: "Sophia" },
      },
      {
        slot: "bedtime",
        at: [22.3, 23.3],
        carbs: [30, 45],
        chance: 0.35,
        foods: [f("Ice cream", 14, 4, "slow"), f("Cereal", 3, 5, "fast"), f("Popcorn", 8, 3, "medium")],
        loggedBy: { weekday: "Sophia", weekend: "Sophia" },
      },
    ],
    habits: { missBolus: 0.17, lateBolus: 0.25, overBolus: 0.04, underBolus: 0.17, adjusts: 0.3 },
    circle: [
      { id: "user:mei", name: "Mei Chen", kind: "owner", messaging: "parents", title: "mother" },
      { id: "user:david", name: "David Chen", kind: "co_guardian", messaging: "parents", title: "father" },
      { id: "device:sophia", name: "Sophia's phone", kind: "patient_device", messaging: null },
    ],
    labA1c: { value: 8.6, daysAgo: 33 },
    settingsHistory: [
      { daysAgo: 95, carbRatio: 12, correctionFactor: 50, targetGlucose: 110 },
      { daysAgo: 30, carbRatio: 10, correctionFactor: 45, targetGlucose: 110 },
    ],
    messages: [
      {
        daysAgo: 12,
        hour: 21.4,
        sender: "guardian",
        text: "Sophia's numbers have been high at night. I think she's forgetting to bolus for late snacks.",
      },
      {
        daysAgo: 11,
        hour: 9.1,
        sender: "doctor",
        text: "I see several missed doses after dinner and late snacks. Let's set a phone reminder for after dinner, and I'd like to see her in clinic next month.",
      },
      { daysAgo: 4, hour: 20.6, sender: "guardian", text: "Reminder is set. Better this week so far!" },
    ],
    pattern: "Most highs follow dinner and late-night snacks, often with no dose logged; missed boluses are the main driver.",
  },
  {
    code: "DEMO04",
    firstName: "Marcus",
    lastName: "Johnson",
    age: 34,
    birthday: [5, 9],
    diabetesType: "type1",
    weightLbs: 182,
    rapid: "FIASP · 100 u/mL",
    basal: { insulin: "Tresiba · 100 u/mL", units: 24, hour: 8, loggedBy: "Marcus Johnson" },
    carbRatio: 9,
    correctionFactor: 38,
    targetGlucose: 105,
    base: 112,
    dawn: 8,
    noise: 12,
    meals: [
      {
        slot: "breakfast",
        at: [6.8, 7.3],
        carbs: [30, 45],
        foods: [
          f("Oatmeal with berries", 6, 10, "medium"),
          f("Eggs and avocado toast", 18, 20, "slow"),
          f("Greek yogurt with granola", 6, 20, "medium"),
        ],
        loggedBy: { weekday: "Marcus Johnson", weekend: "Marcus Johnson" },
      },
      {
        slot: "lunch",
        at: [12, 13],
        carbs: [50, 65],
        foods: [
          f("Chicken salad sandwich", 16, 28, "medium"),
          f("Turkey wrap", 12, 26, "medium"),
          f("Poke bowl", 10, 30, "medium"),
        ],
        loggedBy: { weekday: "Marcus Johnson", weekend: "Marcus Johnson" },
      },
      {
        slot: "dinner",
        at: [18.5, 19.5],
        carbs: [55, 75],
        foods: [
          f("Grilled salmon with rice", 16, 34, "medium"),
          f("Steak and potatoes", 24, 40, "slow"),
          f("Chicken curry with naan", 22, 30, "slow"),
          f("Spaghetti bolognese", 18, 28, "medium"),
        ],
        special: { day: 5, food: f("Pizza night (3 slices)", 36, 33, "slow"), carbs: 95 },
        loggedBy: { weekday: "Marcus Johnson", weekend: "Tasha Johnson" },
      },
    ],
    habits: { missBolus: 0.02, lateBolus: 0.05, overBolus: 0.03, underBolus: 0.05, adjusts: 0.1 },
    activities: [{ days: [1, 3, 5], at: 6, hours: 0.9, drop: 38 }],
    circle: [
      { id: "user:marcus", name: "Marcus Johnson", kind: "patient", messaging: "parents" },
      { id: "code:tasha", name: "Tasha Johnson", kind: "caregiver_code", messaging: null, title: "family_member", titleDetail: "Spouse" },
    ],
    labA1c: { value: 6.6, daysAgo: 61 },
    settingsHistory: [{ daysAgo: 200, carbRatio: 9, correctionFactor: 38, targetGlucose: 105 }],
    messages: [
      {
        daysAgo: 15,
        hour: 7.9,
        sender: "guardian",
        text: "Pizza nights still spike me late. I pre-bolus 15 minutes ahead. Worth splitting the dose?",
      },
      {
        daysAgo: 14,
        hour: 12.3,
        sender: "doctor",
        text: "Yes. For high-fat meals, try 60% before eating and the rest 90 minutes later. Let me know how it goes for a few Fridays.",
      },
    ],
    pattern: "He's in range most of the day; the main exception is a late rise after Friday pizza nights.",
  },
  {
    code: "DEMO05",
    firstName: "Linda",
    lastName: "Garcia",
    age: 67,
    birthday: [1, 30],
    diabetesType: "type2",
    weightLbs: 165,
    rapid: "NovoLog · 100 u/mL",
    basal: { insulin: "Basaglar · 100 u/mL", units: 26, hour: 21, loggedBy: "Linda Garcia" },
    carbRatio: 12,
    correctionFactor: 40,
    targetGlucose: 120,
    base: 148,
    dawn: 32,
    noise: 12,
    ownInsulin: 0.6,
    meals: [
      {
        slot: "breakfast",
        at: [8, 8.6],
        carbs: [30, 45],
        noBolus: true,
        foods: [
          f("Oatmeal with cinnamon", 5, 8, "medium"),
          f("Toast and scrambled eggs", 14, 16, "medium"),
          f("Bran flakes with milk", 3, 9, "medium"),
        ],
        loggedBy: { weekday: "Linda Garcia", weekend: "Linda Garcia" },
      },
      {
        slot: "lunch",
        at: [12.5, 13.2],
        carbs: [40, 55],
        noBolus: true,
        foods: [
          f("Soup and half sandwich", 10, 16, "medium"),
          f("Chicken salad", 14, 26, "slow"),
          f("Bean burrito", 12, 18, "slow"),
        ],
        loggedBy: { weekday: "Linda Garcia", weekend: "Maria Garcia" },
      },
      {
        slot: "dinner",
        at: [17.5, 18.3],
        carbs: [55, 75],
        foods: [
          f("Chicken and rice", 10, 30, "medium"),
          f("Enchiladas", 20, 24, "slow"),
          f("Pot roast with potatoes", 18, 34, "slow"),
          f("Fish tacos", 14, 26, "medium"),
        ],
        loggedBy: { weekday: "Linda Garcia", weekend: "Maria Garcia" },
      },
    ],
    habits: { missBolus: 0.05, lateBolus: 0.05, overBolus: 0.02, underBolus: 0.1, adjusts: 0.1 },
    activities: [{ days: [0, 1, 2, 3, 4, 5, 6], at: 9.2, hours: 0.6, drop: 15, chance: 0.6 }],
    circle: [
      { id: "user:linda", name: "Linda Garcia", kind: "patient", messaging: "parents" },
      { id: "user:maria", name: "Maria Garcia", kind: "co_guardian", messaging: "parents", title: "family_member", titleDetail: "Daughter" },
    ],
    labA1c: { value: 7.8, daysAgo: 29 },
    settingsHistory: [
      { daysAgo: 180, carbRatio: 12, correctionFactor: 45, targetGlucose: 120 },
      { daysAgo: 70, carbRatio: 12, correctionFactor: 40, targetGlucose: 120 },
    ],
    messages: [
      {
        daysAgo: 7,
        hour: 9.5,
        sender: "guardian",
        text: "This is Maria, Linda's daughter. Mom's morning numbers are usually 180 to 200 before breakfast. Is that something to worry about?",
      },
      {
        daysAgo: 6,
        hour: 14.2,
        sender: "doctor",
        text: "Thanks, Maria. That's the dawn effect. Her overnight numbers are otherwise steady, so we may raise her evening Basaglar a little. Let's look together at her visit next week.",
      },
    ],
    pattern: "Her highest numbers are early morning (the dawn effect) and after breakfast; overnight is steady and lows are rare.",
  },
];

export function demoPerson(code: string): DemoPerson | undefined {
  return DEMO_PEOPLE.find((p) => p.code === code.toUpperCase());
}
