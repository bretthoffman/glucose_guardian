/** Used by AuthContext on Convex sign-in / logout so glucose state cannot leak across accounts. */
export const GLUCOSE_HISTORY_STORAGE_KEY = "@gluco_guardian_history";
export const GLUCOSE_SETTINGS_STORAGE_KEY = "@gluco_guardian_settings";

/**
 * Device-local appearance preference ("system" | "light" | "dark"). Intentionally NOT account-scoped
 * and NEVER cleared on sign-out — appearance is a device preference that must survive sign-out/sign-in.
 */
export const THEME_PREFERENCE_STORAGE_KEY = "@glucose_guardian_theme_preference";

/**
 * Device-local Home glucose graph display mode ("line" | "dots"). Intentionally NOT account-scoped
 * and NEVER cleared on sign-out — same persistence model as appearance preferences.
 */
export const GLUCOSE_GRAPH_DISPLAY_MODE_STORAGE_KEY = "@glucose_guardian_graph_display_mode";

/**
 * Device-local Home Recent Readings expand/collapse ("true" | "false"). Intentionally NOT account-scoped
 * and NEVER cleared on sign-out — same persistence model as appearance and graph display preferences.
 */
export const HOME_RECENT_READINGS_EXPANDED_STORAGE_KEY = "@glucose_guardian_home_recent_readings_expanded";

/**
 * Dose calculator's selected insulin type (a profile insulinTypes chip label). Device-local UI
 * default only — validated against the signed-in profile's configured insulins on every load, so a
 * stale value from another account simply falls back to that profile's default.
 */
export const DOSE_INSULIN_TYPE_STORAGE_KEY = "@gluco_guardian_dose_insulin_type";

/**
 * Food page Quick Lookup chips (string[] of food names). Device-local convenience list seeded from
 * the built-in defaults; user saves push new items to the front at a fixed list length.
 */
export const QUICK_FOODS_STORAGE_KEY = "@gluco_guardian_quick_foods";
