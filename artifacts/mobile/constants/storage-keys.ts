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
