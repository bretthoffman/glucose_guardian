/** Normal resting content offset for the Home/Glucose ScrollView (no content inset on offset). */
export const HOME_SCROLL_REST_OFFSET = 0;

export const SCROLL_RETURN_SETTLED_TOLERANCE = 1.5;

/** Fallback when native scroll-end events do not arrive after an animated return. */
export const SCROLL_RETURN_FALLBACK_MS = 380;

/** Bounded wait when a reset must defer until drag/momentum ends. */
export const SCROLL_RETURN_DRAG_FALLBACK_MS = 600;

export function isHomeScrollAtRest(
  offsetY: number,
  tolerance = SCROLL_RETURN_SETTLED_TOLERANCE,
): boolean {
  return Math.abs(offsetY - HOME_SCROLL_REST_OFFSET) <= tolerance;
}

export function homeScrollNeedsRecovery(offsetY: number): boolean {
  return !isHomeScrollAtRest(offsetY);
}

/** Imperceptible drift — safe for a silent non-animated correction. */
export const SCROLL_RETURN_IMPERCEPTIBLE_DRIFT = 3;

export function shouldUseAnimatedScrollCorrection(offsetY: number): boolean {
  return Math.abs(offsetY - HOME_SCROLL_REST_OFFSET) > SCROLL_RETURN_IMPERCEPTIBLE_DRIFT;
}
