# Mobile Settings Popup + Persistent Dark / Light / Automatic Appearance (v1)

Status: implemented in the working tree on `feature/dark-clinical-ui`; **uncommitted**. Mobile typecheck,
the existing test suite (86 tests), and an iOS Expo export all pass. Expo Go compatible, OTA-safe.

## Settings entry point
The **Dashboard profile/avatar control** (`components/ProfileChip.tsx`, rendered only on
`app/(tabs)/dashboard.tsx`) is the single entry point. Tapping it no longer launches the image picker
— it opens the centered Settings popup (`setSettingsOpen(true)`). No settings entry exists on any
other tab, in the tab bar, or as a global icon.

## Modal behavior
`components/SettingsModal.tsx` uses the built-in React Native `<Modal transparent animationType="fade"
statusBarTranslucent>` — a **centered card**, not a bottom sheet, with **no swipe-down dismissal**.
- Backdrop is a full-screen `Pressable` whose `onPress` closes the popup → **tap-outside dismisses**.
- The card is a nested `Pressable` with an empty `onPress` → **taps inside do not dismiss** (RN touches
  do not bubble to the backdrop).
- The **X button** (top-right, 32×32 target, `hitSlop`) closes the popup.
- Android hardware back (`onRequestClose`) closes it.
- The popup is fully theme-aware and **re-renders live** when appearance changes (it reads `useTheme()`),
  so changing the scheme updates the popup without closing it.

### Header
- Top-left: a quiet uppercase `Settings` label (muted, letter-spaced — not a page title).
- Top-right: identity block (first name / age / diabetes type) from the existing `useAuth()` context
  (same source the Dashboard already uses — no second data path) + the X close button. Missing fields
  are omitted safely; no fabricated age/type.

## Profile-image behavior
The exact existing picker flow was extracted **once** into `hooks/useProfilePhotoPicker.ts`
(permissions → `launchImageLibraryAsync` → `FileSystem.copyAsync` → `updateProfile`, with loading and
error `Alert` states). The Dashboard owns the single hook instance; `ProfileChip` shows the upload
spinner via an `uploading` prop, and the popup's **`Update Profile Image`** action invokes the same
`pickPhoto`. There is no second image-picker implementation.

**Chosen UX:** tapping `Update Profile Image` **closes the popup first, then launches the system
picker** (avoids modal-over-modal presentation issues on iOS); the avatar shows the upload spinner.

## Color Scheme control
An inline expander row labeled `Color Scheme`:
- Collapsed: shows the current value (`Automatic` / `Light` / `Dark`) + a chevron.
- Expanded: three options. Selecting one calls `setPreference(...)` (saves + applies immediately),
  **collapses** the list, **keeps the popup open**, and **marks the selection** with a check icon and
  bold weight (not color alone). No Save button. Unselected options show an empty radio ring.

## Theme preference model
- `type ThemePreference = "system" | "light" | "dark"` (`constants/theme.ts`).
- `type EffectiveColorScheme = "light" | "dark"`.
- Stored values are exactly `system` / `light` / `dark`.
- **Storage key:** `@glucose_guardian_theme_preference` (in the `constants/storage-keys.ts` registry).

### Default behavior
Missing/invalid stored value resolves to **Dark** (`parseThemePreference`). A missing key is **not**
written to storage — it simply resolves to dark. The provider initializes to dark, so there is no light
flash before storage hydrates.

### Automatic behavior
`system` follows the device via React Native `useColorScheme()` — it re-renders live when the device
appearance changes while the app is open. No location, sunrise/sunset, or time-based logic. If the
device reports no scheme, `system` resolves to dark.

## Provider architecture
`context/ThemeContext.tsx` — a single `ThemeProvider` placed at the top of the tree (inside
`SafeAreaProvider`, wrapping `ErrorBoundary` and everything below) so tabs, modals, shared components,
navigation chrome, and the status bar can all consume it. Exposes via `useTheme()`:
`{ preference, scheme, colors, ready, setPreference }`, plus a `useThemeColors()` convenience.
- Loads the stored preference asynchronously on mount; render is never blocked on storage.
- Saves are **optimistic**: the choice applies immediately in-session; a storage failure does not crash
  and does not claim success (the in-session choice still applies).
- Pure, unit-tested resolution helpers (`parseThemePreference`, `resolveEffectiveScheme`,
  `getThemeColors`) live in `constants/theme.ts` (no `react-native` import → testable).

## Token architecture
Structural tokens differ by theme; **semantic health colors are shared** so a glucose reading never
changes classification when appearance changes.
- `constants/theme.ts`: `darkColors` (the approved baseline) + `lightColors` (new). Both implement the
  same `ThemeColors` shape: `screen, card, cardElevated, border, borderStrong, highlight, textPrimary,
  textSecondary, textMuted, grid, axis, pointCenter` (structural) and `emerald, emeraldDark, coral,
  amber, violet, violetActive` (semantic — identical in both). `T.color` remains the dark set (static
  fallback + `glucoseTone`).
- `constants/colors.ts`: legacy `Colors.dark` (unchanged dark-clinical) + a real `Colors.light` palette
  mirroring `lightColors`; `COLORS` semantic accents unchanged. Legacy screens consume `Colors[scheme]`
  driven by the provider's effective scheme.
- Redesigned screens consume `useThemeColors()` (`c.*`); components with themed `StyleSheet` colors use
  a `makeStyles(c)` + `useMemo` factory.

## Sign-out preservation
The theme key is device-local and intentionally **excluded** from sign-out cleanup. `AuthContext`'s
`signOut`/`logout` remove specific account/session keys (no `AsyncStorage.clear()`); the appearance key
is not in any removal list, so it survives sign-out → sign-in. Auth/session-sensitive cleanup is
unchanged. Modal-open and expander state are component-local and reset naturally.

## Accessibility
- Selected Color Scheme option uses a **check icon + bold weight** (not color alone).
- Options are `accessibilityRole="radio"` with `accessibilityState={{ selected }}`; the expander row is
  `accessibilityRole="button"` with `accessibilityState={{ expanded }}`.
- X close button and avatar have accessibility labels; touch targets are ≥ 32px with `hitSlop`.
- Status-bar content flips with the theme (dark theme → light content; light theme → dark content).

## Expo Go / OTA compatibility
JS-only: React Native `<Modal>`, `useColorScheme()`, AsyncStorage (already installed `2.2.0`),
`expo-status-bar`, `@expo/vector-icons`. No native modules, config plugins, entitlements, permissions,
SDK, or native files changed. No package.json/lockfile changes.

## Light-theme visual principles
Same geometry, spacing, typography, radii, navigation, and animations as dark — only structural
contrast changes: warm neutral off-white canvas (`#EDF1F8`), white cards, soft cool-gray borders, dark
navy/charcoal primary text (`#0E1A2B`), muted slate secondary, restrained shadows, and the same
violet-blue navigation identity and semantic glucose colors.

## Test matrix (automated)
`constants/theme.test.ts` (runs under the existing root vitest):
- missing/invalid preference → Dark; `dark`→dark; `light`→light; `system`→follows device; no device → dark.
- semantic colors identical across light/dark; structural colors differ.
Manual matrix (Dark/Light/Automatic persistence across close/reopen and sign-out/sign-in; no-pref → dark)
is to be exercised in Expo Go.

## Known limitations
- **Dose inline trend chart** (`app/(tabs)/insulin.tsx`, a bespoke non-`CGMChart` chart) remains a dark
  data panel in light mode; full light theming of its internals was deferred to avoid risk to
  dose-related visuals. The redesigned Home chart (`CGMChart`) IS theme-aware.
- **Auth/onboarding** pre-login screens keep their fixed dark appearance (intentional; they render
  before/around sign-in).
- **`ErrorFallback`** (crash screen) intentionally follows the device scheme (not the preference) for
  robustness if the provider is unavailable.
- **Splash screen** appearance is native config and is not changed in this OTA-safe package.

## Future extension points
- Promote `Color Scheme` into a fuller Settings surface (notifications, units, etc.).
- Optional per-theme semantic-text contrast tweaks for light mode.
- Full light theming of the Dose inline chart.
