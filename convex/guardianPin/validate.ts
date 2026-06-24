/** Exactly four numeric digits; leading zeros preserved (e.g. `0042`). */
export function isValidGuardianPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
