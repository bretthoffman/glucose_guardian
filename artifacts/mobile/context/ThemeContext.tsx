/**
 * Appearance theme provider — the single source of truth for the active color scheme.
 *
 * - Stored preference: "system" | "light" | "dark" (device-local, AsyncStorage).
 * - Default is DARK (the product default) so there is no light flash before storage hydrates.
 * - "system" follows the device via `useColorScheme()` and reacts live to device appearance changes.
 * - Saves are OPTIMISTIC: the choice applies immediately in-session; a storage failure does not crash
 *   and does not falsely claim persistence.
 *
 * Do not scatter `useColorScheme()` across screens — consume `useTheme()` / `useThemeColors()`.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME_PREFERENCE_STORAGE_KEY } from "@/constants/storage-keys";
import {
  getThemeColors,
  parseThemePreference,
  resolveEffectiveScheme,
  type EffectiveColorScheme,
  type ThemeColors,
  type ThemePreference,
} from "@/constants/theme";

interface ThemeContextValue {
  /** Stored choice: system | light | dark. */
  preference: ThemePreference;
  /** Resolved effective scheme: light | dark. */
  scheme: EffectiveColorScheme;
  /** Active structural color tokens for the effective scheme. */
  colors: ThemeColors;
  /** True once the stored preference has been read (or failed) — render is never blocked on this. */
  ready: boolean;
  setPreference: (p: ThemePreference) => void;
}

const defaultValue: ThemeContextValue = {
  preference: "dark",
  scheme: "dark",
  colors: getThemeColors("dark"),
  ready: false,
  setPreference: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(defaultValue);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize to DARK (product default) — avoids a light flash before storage resolves.
  const [preference, setPreferenceState] = useState<ThemePreference>("dark");
  const [ready, setReady] = useState(false);
  // Drives "system" mode and re-renders live when the device appearance changes.
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
        if (cancelled) return;
        // A missing key semantically resolves to dark; we do NOT write "dark" just because it's absent.
        if (raw != null) setPreferenceState(parseThemePreference(raw));
      } catch {
        // Storage read failure → stay on the dark default.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useMemo(
    () => (p: ThemePreference) => {
      setPreferenceState(p); // optimistic: apply immediately
      AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, p).catch(() => {
        // Persistence failed — keep the in-session choice; do not crash or claim success.
      });
    },
    [],
  );

  const scheme = resolveEffectiveScheme(preference, systemScheme);
  const colors = getThemeColors(scheme);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, colors, ready, setPreference }),
    [preference, scheme, colors, ready, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Active theme: preference, effective scheme, structural color tokens, and the setter. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Convenience: just the active structural color tokens. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
