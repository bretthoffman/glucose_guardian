/** Bounded inner ScrollView height for Dashboard section popups (accounts for safe area + tab bar). */
export function dashboardModalMaxBodyHeight(
  windowHeight: number,
  topInset: number,
  bottomInset: number,
): number {
  const topPad = topInset + 12;
  const bottomPad = bottomInset + 96;
  return Math.max(240, windowHeight - topPad - bottomPad - 52);
}
