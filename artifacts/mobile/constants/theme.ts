/**
 * Dark-clinical visual tokens for the patient app (feature/dark-clinical-ui).
 *
 * VISUAL ONLY. No behavior. Kept free of `react-native` imports so the pure helpers
 * (e.g. `glucoseTone`) stay unit-testable. Typography uses the PLATFORM SYSTEM FONT
 * (SF Pro on iOS, Roboto on Android) by setting `fontWeight` and omitting `fontFamily`.
 */

export const T = {
  color: {
    // foundations
    screen: "#061124",
    card: "#0B1830",
    cardElevated: "#0E1D38",
    border: "rgba(120, 150, 190, 0.14)",
    borderStrong: "rgba(120, 150, 190, 0.22)",
    highlight: "rgba(190, 210, 240, 0.35)",

    // text
    textPrimary: "#F7F9FC",
    textSecondary: "#93A4BD",
    textMuted: "#75849B",

    // semantic
    emerald: "#1FD18A",
    emeraldDark: "#0D8F63",
    coral: "#FF5B57",
    amber: "#FF9F1C",
    violet: "#7557F6",
    violetActive: "#7181FF",

    // chart
    grid: "rgba(145, 165, 195, 0.10)",
    axis: "#8898B2",
    pointCenter: "#EAFBF5",
    // chart controls / inset plot surface (shared by the Home + Dose charts)
    chartPlotBg: "#1a2540",
    chartControlTrack: "#0A142499", // = withAlpha("#0A1424", 0.6)
    chartControlActive: "#22324C",
    chartControlActiveText: "#F7F9FC",
  },

  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },

  /** Tab headers that host GlucoseStatusPill — identical pill screen coordinates across Chat/Dose/Food. */
  tabGlucoseHeader: {
    paddingTopInset: 12,
    paddingHorizontal: 16,
    rowGap: 12,
    rowMinHeight: 40,
  },

  radius: { card: 28, control: 16, pill: 14, nav: 30, sm: 10 },

  /**
   * Weight tokens — used as `fontWeight` (NOT `fontFamily`). Omitting fontFamily renders the
   * platform system font (SF Pro Display/Text on iOS, Roboto on Android).
   */
  font: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    heavy: "800",
  },
} as const;

/* ------------------------------ appearance theming ------------------------------ */

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveColorScheme = "light" | "dark";

/** Structural color tokens that DIFFER between light and dark. Semantic health colors are shared. */
export type ThemeColors = { [K in keyof typeof T.color]: string };

/** Dark-clinical structural tokens — the approved baseline (unchanged). */
export const darkColors: ThemeColors = { ...T.color };

/**
 * Light-clinical structural tokens. Same geometry/role as dark — only structural contrast changes.
 * SEMANTIC health colors (emerald/coral/amber/violet/violetActive/emeraldDark) are intentionally
 * IDENTICAL to dark so a glucose reading never changes classification when appearance changes.
 */
export const lightColors: ThemeColors = {
  // foundations — warm neutral off-white canvas, white cards, soft cool-gray borders
  screen: "#EDF1F8",
  card: "#FFFFFF",
  cardElevated: "#F6F8FC",
  border: "rgba(30, 55, 100, 0.12)",
  borderStrong: "rgba(30, 55, 100, 0.20)",
  highlight: "rgba(255, 255, 255, 0.70)",

  // text — dark navy/charcoal primary, muted slate secondary
  textPrimary: "#0E1A2B",
  textSecondary: "#4C5C72",
  textMuted: "#8190A4",

  // semantic (shared with dark — DO NOT diverge classification)
  emerald: T.color.emerald,
  emeraldDark: T.color.emeraldDark,
  coral: T.color.coral,
  amber: T.color.amber,
  violet: T.color.violet,
  violetActive: T.color.violetActive,

  // chart
  grid: "rgba(20, 40, 80, 0.08)",
  axis: "#64748B",
  pointCenter: "#FFFFFF",
  // chart controls / inset plot surface — light structural language; selected = product violet
  chartPlotBg: "#EFF3FA",
  chartControlTrack: "rgba(30, 55, 100, 0.06)",
  chartControlActive: "#7557F6",
  chartControlActiveText: "#FFFFFF",
};

export const THEME_COLORS: Record<EffectiveColorScheme, ThemeColors> = {
  dark: darkColors,
  light: lightColors,
};

export function getThemeColors(scheme: EffectiveColorScheme): ThemeColors {
  return THEME_COLORS[scheme] ?? darkColors;
}

/** Parse a stored value into a preference. Missing/invalid → "dark" (the product default). */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : "dark";
}

/**
 * Resolve the effective scheme. "system" follows the device (null/undefined system → dark default);
 * "light"/"dark" are explicit. Any unexpected value resolves to dark.
 */
export function resolveEffectiveScheme(
  pref: ThemePreference,
  systemScheme: "light" | "dark" | null | undefined,
): EffectiveColorScheme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return systemScheme === "light" ? "light" : "dark";
}

/**
 * Role-based typography tokens (system font + weight + tracking). Spread into a Text style, e.g.
 * `style={[styles.x, TYPE.title]}`. `display`/`numeric` get tighter tracking for premium numerals;
 * body/label/caption stay restrained.
 */
export const TYPE = {
  display: { fontWeight: "800", letterSpacing: -1.2 },
  numeric: { fontWeight: "700", letterSpacing: -0.5 },
  title: { fontWeight: "800", letterSpacing: -0.5 },
  /** Tab screen page title — 21px (~75% of legacy 28px); stronger than section headings (18). */
  pageTitle: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  heading: { fontWeight: "700", letterSpacing: -0.3 },
  body: { fontWeight: "400", letterSpacing: 0 },
  label: { fontWeight: "500", letterSpacing: 0.1 },
  button: { fontWeight: "600", letterSpacing: 0.2 },
  caption: { fontWeight: "400", letterSpacing: 0.1 },
  axis: { fontWeight: "500", letterSpacing: 0.2 },
} as const;

/** Hex + 0..1 alpha → 8-digit hex, e.g. withAlpha("#1FD18A", 0.12). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/**
 * Four-state clinical color for a glucose value, using the ACCOUNT's configured thresholds.
 *
 *   value < low            → coral   (below low / critical low)
 *   low ≤ value ≤ high      → emerald (in target range)
 *   high < value < urgentHigh → amber (above target, below critical high)
 *   value ≥ urgentHigh      → coral   (critical high)
 *
 * Defaults mirror the app defaults, but callers pass the live `alertPrefs` thresholds so a reading
 * in the amber high zone never turns red prematurely.
 */
export function glucoseTone(
  value: number,
  low = 70,
  high = 180,
  urgentHigh = 250,
): string {
  if (value < low) return T.color.coral;
  if (value <= high) return T.color.emerald;
  if (value < urgentHigh) return T.color.amber;
  return T.color.coral;
}
