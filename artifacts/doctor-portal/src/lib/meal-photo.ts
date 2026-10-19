import type { FoodLogEntry } from "@doctor-portal/api-client-react";

/**
 * The server log flags meals whose photo the app uploaded (`hasPhoto`, fetched full-size through
 * the api-server — see useMealPhoto). Not in the generated client type yet.
 */
export function hasUploadedPhoto(food: FoodLogEntry | undefined): boolean {
  return (food as (FoodLogEntry & { hasPhoto?: boolean }) | undefined)?.hasPhoto === true;
}

/** The small thumbnail some phone syncs carry with the entry, when it's an image data URI. */
export function syncedPhotoThumb(food: FoodLogEntry | undefined): string | null {
  return food?.photoDataUri?.startsWith("data:image/") ? food.photoDataUri : null;
}

/** Whether the portal has a photo to show for this meal. */
export function mealHasViewablePhoto(food: FoodLogEntry | undefined): boolean {
  return hasUploadedPhoto(food) || syncedPhotoThumb(food) != null;
}
