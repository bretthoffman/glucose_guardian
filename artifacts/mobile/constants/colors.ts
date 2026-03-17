const tintColorLight = "#3B82F6";
const tintColorDark = "#60A5FA";

export const COLORS = {
  primary: "#3B82F6",
  primaryDark: "#2563EB",
  primaryLight: "#93C5FD",
  accent: "#06B6D4",
  accentLight: "#A5F3FC",
  success: "#10B981",
  successLight: "#D1FAE5",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  danger: "#EF4444",
  dangerLight: "#FEE2E2",
  navy: "#0F172A",
  navyMid: "#1E293B",
  navyLight: "#334155",
  glucose: {
    low: "#EF4444",
    lowRange: "#F97316",
    normal: "#10B981",
    high: "#F59E0B",
    veryHigh: "#EF4444",
  },
};

export default {
  light: {
    text: "#0F172A",
    textSecondary: "#64748B",
    textMuted: "#94A3B8",
    background: "#F8FAFC",
    backgroundSecondary: "#FFFFFF",
    backgroundTertiary: "#F1F5F9",
    card: "#FFFFFF",
    border: "#E2E8F0",
    tint: tintColorLight,
    tabIconDefault: "#94A3B8",
    tabIconSelected: tintColorLight,
    separator: "#F1F5F9",
  },
  dark: {
    text: "#F1F5F9",
    textSecondary: "#94A3B8",
    textMuted: "#64748B",
    background: "#0F172A",
    backgroundSecondary: "#1E293B",
    backgroundTertiary: "#334155",
    card: "#1E293B",
    border: "#334155",
    tint: tintColorDark,
    tabIconDefault: "#64748B",
    tabIconSelected: tintColorDark,
    separator: "#1E293B",
  },
};
