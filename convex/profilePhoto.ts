/**
 * The child's photo, shared with the whole care circle.
 *
 * Before this, the photo was only a file path on the phone that picked it (`profilePhotoUri`), so
 * every other phone in the circle saw the initials. Now a guardian's app uploads a small square JPEG
 * (~320px, a few tens of KB) as a data URI onto the circle owner's profile (`sharedPhoto`). It rides
 * along with what members already load: `circleContext.shared` for co-guardians and
 * `slimPatientProfile` for code sessions (grandma, the school nurse, Child Mode), so they all show
 * the same picture.
 *
 * Who may change it: the circle's admins, the same rule as everywhere else in the circle (the
 * patient account and any active co-guardian). Access-code sessions only ever see it.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";

/**
 * Same resolution as `careCircle.circleAnchorFor` (kept local so careCircle can import this file's
 * pure helpers without an import cycle): an active co-guardian acts on the owner's profile,
 * everyone else on their own.
 */
async function circleAnchorFor(ctx: QueryCtx | MutationCtx, callerUserId: Id<"users">): Promise<{ anchor: Id<"users"> }> {
  const membership = await ctx.db
    .query("careLinks")
    .withIndex("by_member", (q) => q.eq("memberUserId", callerUserId).eq("status", "active"))
    .first();
  return { anchor: membership ? membership.patientUserId : callerUserId };
}

/** Largest accepted photo, as data-URI characters (~220 KB of JPEG). The app sends ~20–60 KB. */
export const MAX_SHARED_PHOTO_CHARS = 300_000;

export function isValidSharedPhoto(photo: string): boolean {
  return (
    photo.length <= MAX_SHARED_PHOTO_CHARS &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo)
  );
}

/** A photo another phone can actually show: a data URI or a web address, never a device file path. */
export function shareablePhoto(sharedPhoto: string | undefined, legacyUri: string | undefined): string | undefined {
  if (sharedPhoto) return sharedPhoto;
  if (legacyUri && /^(https?:|data:image\/)/.test(legacyUri)) return legacyUri;
  return undefined;
}

/** The circle's shared photo for a signed-in family account (owner or co-guardian). */
export const mine = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const row = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", anchor))
      .unique();
    return {
      photo: row?.sharedPhoto ?? null,
      updatedAt: row?.sharedPhotoUpdatedAt ?? null,
    };
  },
});

/** Set the circle's shared photo. Owner or active co-guardian only (circleAnchorFor resolves which). */
export const set = mutation({
  args: { ...legacyAuthArgs, photo: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    if (!isValidSharedPhoto(args.photo)) throw new ConvexError("The photo must be a small JPEG, PNG or WebP image");
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const row = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", anchor))
      .unique();
    if (!row) throw new ConvexError("Finish setting up the profile first");
    if (row.sharedPhoto === args.photo) return { updatedAt: row.sharedPhotoUpdatedAt ?? null };
    const now = Date.now();
    await ctx.db.patch(row._id, { sharedPhoto: args.photo, sharedPhotoUpdatedAt: now });
    return { updatedAt: now };
  },
});
