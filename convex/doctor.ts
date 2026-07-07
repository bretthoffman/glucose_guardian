import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const doctorMessage = v.object({
  id: v.string(),
  timestamp: v.string(),
  text: v.string(),
  sender: v.union(v.literal("doctor"), v.literal("guardian")),
  read: v.boolean(),
});

const profile = v.object({
  childName: v.string(),
  parentName: v.optional(v.string()),
  diabetesType: v.string(),
  dateOfBirth: v.string(),
  weightLbs: v.optional(v.number()),
  doctorName: v.optional(v.string()),
  insulinTypes: v.optional(v.array(v.string())),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
});

const glucoseReading = v.object({
  value: v.number(),
  trend: v.string(),
  timestamp: v.string(),
});

const alertPreferences = v.object({
  lowThreshold: v.optional(v.number()),
  highThreshold: v.optional(v.number()),
  urgentLowThreshold: v.optional(v.number()),
  urgentHighThreshold: v.optional(v.number()),
});

const therapyProposal = v.object({
  id: v.string(),
  proposedAt: v.string(),
  proposedByDoctorId: v.string(),
  proposedByName: v.string(),
  note: v.string(),
  carbRatio: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
});

const therapyDecision = v.object({
  proposalId: v.string(),
  status: v.union(v.literal("approved"), v.literal("declined")),
  decidedAt: v.string(),
});

function requireIngestSecret(provided: string) {
  const expected = process.env.CONVEX_DOCTOR_INGEST_SECRET;
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized doctor ingest");
  }
}

function generateDemoReadings(): { value: number; trend: string; timestamp: string }[] {
  const readings: { value: number; trend: string; timestamp: string }[] = [];
  const now = Date.now();
  const trends = [
    "Flat",
    "FortyFiveUp",
    "SingleUp",
    "FortyFiveDown",
    "Flat",
    "Flat",
    "SingleDown",
    "Flat",
  ];
  let bg = 118;
  for (let i = 288; i >= 0; i--) {
    bg += (Math.random() - 0.46) * 12;
    if (bg < 60) bg = 65 + Math.random() * 10;
    if (bg > 280) bg = 240 - Math.random() * 20;
    readings.push({
      value: Math.round(bg),
      trend: trends[Math.floor(Math.random() * trends.length)]!,
      timestamp: new Date(now - i * 5 * 60 * 1000).toISOString(),
    });
  }
  return readings;
}

const DEMO_CODE = "DEMO";

export const getState = query({
  args: { serverSecret: v.string(), accessCode: v.string() },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    return await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", args.accessCode))
      .unique();
  },
});

export const upsertFromSync = mutation({
  args: {
    serverSecret: v.string(),
    accessCode: v.string(),
    profile: profile,
    glucoseReadings: v.array(glucoseReading),
    insulinLog: v.array(v.any()),
    foodLog: v.array(v.any()),
    messages: v.array(doctorMessage),
    alertPreferences: v.optional(alertPreferences),
    syncedAt: v.string(),
  },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    const { serverSecret: _s, accessCode, ...rest } = args;
    const existing = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", accessCode))
      .unique();
    const doc = {
      accessCode,
      messages: rest.messages,
      profile: rest.profile,
      glucoseReadings: rest.glucoseReadings,
      insulinLog: rest.insulinLog,
      foodLog: rest.foodLog,
      alertPreferences: rest.alertPreferences,
      // Preserve doctor-owned proposal/decision state — a patient sync must never clobber a
      // pending treatment proposal or the caregiver's last decision.
      therapyProposal: existing?.therapyProposal,
      therapyDecision: existing?.therapyDecision,
      syncedAt: rest.syncedAt,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("doctorPortalState", doc);
    }
  },
});

export const appendMessage = mutation({
  args: {
    serverSecret: v.string(),
    accessCode: v.string(),
    message: doctorMessage,
  },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    const existing = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", args.accessCode))
      .unique();
    if (existing) {
      const messages = [...existing.messages, args.message];
      await ctx.db.replace(existing._id, {
        accessCode: existing.accessCode,
        messages,
        profile: existing.profile,
        glucoseReadings: existing.glucoseReadings,
        insulinLog: existing.insulinLog,
        foodLog: existing.foodLog,
        alertPreferences: existing.alertPreferences,
        therapyProposal: existing.therapyProposal,
        therapyDecision: existing.therapyDecision,
        syncedAt: existing.syncedAt,
      });
    } else {
      await ctx.db.insert("doctorPortalState", {
        accessCode: args.accessCode,
        messages: [args.message],
      });
    }
  },
});

/**
 * Store a doctor-proposed treatment change. At most one proposal may be pending per access code;
 * a second proposal while one is still awaiting a caregiver decision throws so the api-server can
 * return HTTP 409. Creating a new proposal clears any stale prior decision.
 */
export const proposeOrder = mutation({
  args: {
    serverSecret: v.string(),
    accessCode: v.string(),
    proposal: therapyProposal,
  },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    const existing = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", args.accessCode))
      .unique();

    if (existing?.therapyProposal) {
      throw new Error("PENDING_PROPOSAL_EXISTS");
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        therapyProposal: args.proposal,
        therapyDecision: undefined,
      });
    } else {
      await ctx.db.insert("doctorPortalState", {
        accessCode: args.accessCode,
        messages: [],
        therapyProposal: args.proposal,
      });
    }

    return args.proposal;
  },
});

/**
 * Record the caregiver's decision on the pending proposal. Idempotent: matches on `proposalId`,
 * so a duplicate submit (e.g. double-tap or a retry) is a no-op. Clears the pending proposal and
 * stamps the outcome for the doctor portal to read.
 */
export const decideOrder = mutation({
  args: {
    serverSecret: v.string(),
    accessCode: v.string(),
    proposalId: v.string(),
    status: v.union(v.literal("approved"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    const existing = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", args.accessCode))
      .unique();

    if (!existing || existing.therapyProposal?.id !== args.proposalId) {
      const alreadyDecided = existing?.therapyDecision?.proposalId === args.proposalId;
      return { applied: false as const, alreadyDecided };
    }

    const decision = {
      proposalId: args.proposalId,
      status: args.status,
      decidedAt: new Date().toISOString(),
    };
    await ctx.db.patch(existing._id, {
      therapyProposal: undefined,
      therapyDecision: decision,
    });
    return { applied: true as const, decision };
  },
});

/** Idempotent demo seed (matches legacy in-memory DEMO patient). */
export const seedDemo = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireIngestSecret(args.serverSecret);
    const existing = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", DEMO_CODE))
      .unique();
    if (existing) {
      return { seeded: false as const };
    }

    const demoReadings = generateDemoReadings();
    const demoMessages = [
      {
        id: "msg-1",
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        text: "Hi Dr. Chen! Emma had a rough night — lots of lows around 2–4 AM. We adjusted her basal but want your input.",
        sender: "guardian" as const,
        read: true,
      },
      {
        id: "msg-2",
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        text: "Thanks for the heads up. Looking at her CGM data now. Those nocturnal lows are likely from the dinner bolus stacking. Let's reduce her dinner I:C ratio from 1:10 to 1:12 and watch for a few days.",
        sender: "doctor" as const,
        read: true,
      },
      {
        id: "msg-3",
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        text: "The adjustment seems to be working! Only one mild low last night at 68, came back up on her own. Should we keep this ratio?",
        sender: "guardian" as const,
        read: false,
      },
    ];

    await ctx.db.insert("doctorPortalState", {
      accessCode: DEMO_CODE,
      messages: demoMessages,
      profile: {
        childName: "Emma Chen",
        parentName: "Sarah Chen",
        diabetesType: "Type 1",
        dateOfBirth: "2014-06-15",
        weightLbs: 68,
        doctorName: "Dr. Michael Chen",
        insulinTypes: ["Humalog", "Lantus"],
        carbRatio: 10,
        targetGlucose: 110,
        correctionFactor: 50,
      },
      glucoseReadings: demoReadings,
      insulinLog: [
        {
          id: "ins-1",
          timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          units: 3.5,
          type: "bolus",
          note: "Lunch - pasta",
          foodLogId: "food-1",
        },
        {
          id: "ins-2",
          timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          units: 1.0,
          type: "correction",
          note: "BG was 185",
        },
        {
          id: "ins-3",
          timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          units: 2.5,
          type: "bolus",
          note: "Snack",
          foodLogId: "food-2",
        },
        {
          id: "ins-4",
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          units: 4.0,
          type: "bolus",
          note: "Dinner - pizza",
        },
        {
          id: "ins-5",
          timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
          units: 12,
          type: "manual",
          note: "Lantus nightly dose",
        },
      ],
      foodLog: [
        {
          id: "food-1",
          timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          foodName: "Pasta with marinara sauce",
          estimatedCarbs: 52,
          insulinUnits: 3.5,
          confidence: "high",
          fromPhoto: true,
        },
        {
          id: "food-2",
          timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          foodName: "Apple with peanut butter",
          estimatedCarbs: 28,
          insulinUnits: 2.5,
          confidence: "medium",
          fromPhoto: false,
        },
        {
          id: "food-3",
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          foodName: "Cheese pizza (2 slices)",
          estimatedCarbs: 60,
          insulinUnits: 4.0,
          confidence: "medium",
          fromPhoto: true,
        },
      ],
      alertPreferences: {
        lowThreshold: 70,
        highThreshold: 180,
        urgentLowThreshold: 55,
        urgentHighThreshold: 250,
      },
      syncedAt: new Date().toISOString(),
    });

    return { seeded: true as const };
  },
});
