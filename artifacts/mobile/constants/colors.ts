// Dark-clinical palette (feature/dark-clinical-ui). VISUAL ONLY — keys are unchanged so every
// existing `Colors[scheme]` / `COLORS` consumer keeps working; only the values changed. Both the
// `light` and `dark` palettes intentionally resolve to the same dark-clinical look for this pass
// (the Light/Dark/Automatic settings panel is a separate future package), but the structure is kept
// so a real light palette can be reintroduced under `light` without touching screens.
//
// Semantic accents map to the clinical set: violet (primary/active), emerald (healthy), amber
// (warning/high), coral (low/critical). `*Light` tints are concat-safe 8-digit hex translucents.

const tintColorLight = "#7181FF";
const tintColorDark = "#7181FF";

export const COLORS = {
  primary: "#7557F6",
  primaryDark: "#5B43D6",
  primaryLight: "#9D8CFF",
  accent: "#7181FF",
  accentLight: "#7181FF24",
  success: "#1FD18A",
  successLight: "#1FD18A24",
  warning: "#FF9F1C",
  warningLight: "#FF9F1C24",
  danger: "#FF5B57",
  dangerLight: "#FF5B5724",
  navy: "#061124",
  navyMid: "#0B1830",
  navyLight: "#0E1D38",
  glucose: {
    low: "#FF5B57",
    lowRange: "#FF9F1C",
    normal: "#1FD18A",
    high: "#FF9F1C",
    veryHigh: "#FF5B57",
  },
};

// Dark-clinical structural palette (the approved baseline). Mirrors `theme.ts` darkColors.
const darkClinical = {
  text: "#F7F9FC",
  textSecondary: "#93A4BD",
  textMuted: "#75849B",
  background: "#061124",
  backgroundSecondary: "#0B1830",
  backgroundTertiary: "#0E1D38",
  card: "#0B1830",
  border: "rgba(120, 150, 190, 0.14)",
  tint: tintColorDark,
  tabIconDefault: "#75849B",
  tabIconSelected: tintColorDark,
  separator: "rgba(120, 150, 190, 0.14)",
};

// Light-clinical structural palette. Mirrors `theme.ts` lightColors so legacy `Colors[scheme]`
// screens and redesigned `useThemeColors()` screens render the same light look. Semantic health
// colors live in `COLORS` (above) and are shared across both appearances.
const lightClinical = {
  text: "#0E1A2B",
  textSecondary: "#4C5C72",
  textMuted: "#8190A4",
  background: "#EDF1F8",
  backgroundSecondary: "#FFFFFF",
  backgroundTertiary: "#F6F8FC",
  card: "#FFFFFF",
  border: "rgba(30, 55, 100, 0.12)",
  tint: tintColorLight,
  tabIconDefault: "#8190A4",
  tabIconSelected: tintColorLight,
  separator: "rgba(30, 55, 100, 0.10)",
};

export default {
  light: { ...lightClinical },
  dark: { ...darkClinical },
};
