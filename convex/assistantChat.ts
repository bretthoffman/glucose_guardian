/**
 * Assistant chat history, saved by day so a person can scroll back to any date.
 *
 * Private to each person (Brian's call): an account's chats are keyed to that account, and an
 * access-code session's (grandma, the school nurse, Child Mode) to that code. There is no way to
 * read someone else's chats, including a co-guardian's.
 *
 * Every function takes either the account identity (Clerk or legacy userId + passwordHash) or a
 * `code` for code sessions.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";

const MAX_MESSAGES_PER_DAY = 400;
const MAX_TEXT = 4000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ownerArgs = { ...legacyAuthArgs, code: v.optional(v.string()) };

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** "u:<id>" / "c:<code>", or null when the caller can't be identified. */
async function ownerFor(
  ctx: QueryCtx | MutationCtx,
  args: { code?: string; userId?: Id<"users">; passwordHash?: string },
): Promise<string | null> {
  if (args.code) {
    const code = normalizeCode(args.code);
    if (code.length !== 8) return null;
    const row = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    return row && row.status === "active" ? `c:${code}` : null;
  }
  const user = await userCompat(ctx, args);
  return user ? `u:${user._id}` : null;
}

/** First thing the person asked that day, as the list preview. */
export function chatPreview(messages: { role: string; text: string }[]): string {
  const first = messages.find((m) => m.role === "user") ?? messages[0];
  const t = (first?.text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}

/** Days with chats, newest first, with a preview and message count. */
export const days = query({
  args: { ...ownerArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const owner = await ownerFor(ctx, args);
    if (!owner) return [];
    const rows = await ctx.db
      .query("assistantChats")
      .withIndex("by_owner_day", (q) => q.eq("owner", owner))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 120, 1), 400));
    return rows
      .filter((r) => r.messages.length > 0)
      .map((r) => ({ day: r.day, preview: chatPreview(r.messages), count: r.messages.length, updatedAt: r.updatedAt }));
  },
});

/** One day's conversation, oldest first. */
export const day = query({
  args: { ...ownerArgs, day: v.string() },
  handler: async (ctx, args) => {
    const owner = await ownerFor(ctx, args);
    if (!owner || !DAY_RE.test(args.day)) return [];
    const row = await ctx.db
      .query("assistantChats")
      .withIndex("by_owner_day", (q) => q.eq("owner", owner).eq("day", args.day))
      .unique();
    return row?.messages ?? [];
  },
});

/** Add messages to a day (deduped by id, so a retry never doubles a message). */
export const append = mutation({
  args: {
    ...ownerArgs,
    day: v.string(),
    messages: v.array(
      v.object({
        id: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        text: v.string(),
        at: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const owner = await ownerFor(ctx, args);
    if (!owner) throw new ConvexError("Not signed in");
    if (!DAY_RE.test(args.day)) throw new ConvexError("Bad day");
    const incoming = args.messages
      .filter((m) => m.id && m.text.trim())
      .map((m) => ({ ...m, id: m.id.slice(0, 64), text: m.text.slice(0, MAX_TEXT) }));
    if (incoming.length === 0) return;
    const row = await ctx.db
      .query("assistantChats")
      .withIndex("by_owner_day", (q) => q.eq("owner", owner).eq("day", args.day))
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("assistantChats", {
        owner,
        day: args.day,
        messages: incoming.slice(-MAX_MESSAGES_PER_DAY),
        updatedAt: now,
      });
      return;
    }
    const seen = new Set(row.messages.map((m) => m.id));
    const merged = [...row.messages, ...incoming.filter((m) => !seen.has(m.id))]
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_MESSAGES_PER_DAY);
    await ctx.db.patch(row._id, { messages: merged, updatedAt: now });
  },
});
