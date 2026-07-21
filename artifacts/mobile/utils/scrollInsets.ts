/**
 * Opt every scroll surface out of RN's automatic iOS content-inset injection.
 *
 * WHY: `automaticallyAdjustContentInsets` defaults to TRUE on every RN ScrollView/FlatList. On iOS
 * that makes RN add the ENCLOSING VIEW CONTROLLER's safe-area insets to `contentInset` — see
 * `RCTView.autoAdjustInsetsForView` → `RCTContentInsets()`, which walks up to `view.reactViewController`
 * and returns `controller.view.safeAreaInsets`. With expo-router / react-native-screens each screen
 * (and each <Modal>) is its own view controller that gets attached, detached, and re-laid-out as you
 * navigate, so that lookup can resolve against a controller whose safe-area insets are stale or
 * simply not ours. The result is phantom scrollable space with no content in it, and — because
 * `autoAdjustInsetsForView` also shifts `contentOffset` when the top inset changes — content that
 * jumps out of view. It appears on one screen, heals when a re-layout recomputes the inset, then
 * shows up somewhere else.
 *
 * This app never wanted that adjustment: every screen already applies safe-area padding itself via
 * `useSafeAreaInsets()` in its `contentContainerStyle` (plus clearance for the floating tab bar), so
 * the automatic inset is duplicate padding at best and the bug above at worst.
 *
 * NOTE: `contentInsetAdjustmentBehavior` is deliberately NOT set here — RN already defaults it to
 * "never" (RCTScrollView.m), so setting it would be redundant.
 */
export const NO_AUTO_CONTENT_INSETS = {
  automaticallyAdjustContentInsets: false,
} as const;
