/**
 * Where Help Mode's explanation card goes relative to the spotlight hole, given the card's
 * measured height and the free space above/below the hole (between the exit pill's clearance and
 * the tab bar). The rule the overlay relies on: the card NEVER covers the spotlight when any
 * position avoids it, preferring its home spot docked above the tab bar. Only when spotlight plus
 * card are taller than the usable screen does it overlap at all, and then on the side where the
 * overlap is smallest, docked at that screen edge so it covers only the spotlight's far tail.
 */
export function helpCardAtTop(cardHeight: number, spaceAbove: number, spaceBelow: number): boolean {
  if (cardHeight <= spaceBelow) return false; // home position, clear of the spotlight
  if (cardHeight <= spaceAbove) return true; // under the exit pill, clear of the spotlight
  return spaceAbove > spaceBelow; // neither side fits: smaller overlap wins
}
