/**
 * Glucose-screen shortcuts: the buttons each person picks (Dashboard → Shortcuts) to jump straight to
 * Doctor Office, Logs, Messages and so on. Private to each person, like chat history: an account's
 * list is keyed to that account (so it follows them to another phone), an access-code session's to
 * that code. Which shortcuts a person may USE is decided by the app from their permissions; the
 * server only stores the ordered ids.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";

export const MAX_SHORTCUTS = 8;
const ID_RE = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

const ownerArgs = { ...legacyAuthArgs, code: v.optional(v.string()) };

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

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

/** Valid, unique ids, at most MAX_SHORTCUTS, order kept. */
export function cleanShortcutIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (ID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** This person's shortcuts, or null when they've never set any (the app then uses its default). */
export const mine = query({
  args: ownerArgs,
  handler: async (ctx, args) => {
    const owner = await ownerFor(ctx, args);
    if (!owner) return null;
    const row = await ctx.db
      .query("userShortcuts")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .unique();
    return row ? row.ids : null;
  },
});

/** Replace this person's shortcuts with `ids`, in that order. */
export const set = mutation({
  args: { ...ownerArgs, ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const owner = await ownerFor(ctx, args);
    if (!owner) return null;
    const ids = cleanShortcutIds(args.ids);
    const row = await ctx.db
      .query("userShortcuts")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .unique();
    if (row) await ctx.db.patch(row._id, { ids, updatedAt: Date.now() });
    else await ctx.db.insert("userShortcuts", { owner, ids, updatedAt: Date.now() });
    return ids;
  },
});
