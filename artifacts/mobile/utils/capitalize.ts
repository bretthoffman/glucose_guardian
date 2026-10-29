/**
 * Capital letters that don't depend on the phone's keyboard settings (iOS lets people turn
 * Auto-Capitalization off for every app). Only lowercase letters at the start are raised; nothing
 * else in the text changes, so "iPhone"-style words in the middle and the cursor are untouched.
 */

/** First letter of the text (and of each new line) in capitals: "pizza" → "Pizza". */
export function capFirst(text: string): string {
  if (!text) return text;
  return text.replace(/(^|\n)(\s*)(\p{Ll})/gu, (_m, start: string, space: string, ch: string) => start + space + ch.toUpperCase());
}

/** First letter of every word in capitals, for names: "mary ann" → "Mary Ann". */
export function capWords(text: string): string {
  if (!text) return text;
  return text.replace(/(^|[\s-])(\p{Ll})/gu, (_m, before: string, ch: string) => before + ch.toUpperCase());
}

/**
 * Saved log entries as shown in lists: food names and notes start with a capital, whatever was
 * typed when they were saved. Entries that already read well are returned as the same object.
 */
export function capLogEntries<T extends { foodName?: string; note?: string }>(list: T[]): T[] {
  let changed = false;
  const out = list.map((e) => {
    const foodName = e.foodName != null ? capFirst(e.foodName) : e.foodName;
    const note = e.note != null ? capFirst(e.note) : e.note;
    if (foodName === e.foodName && note === e.note) return e;
    changed = true;
    return { ...e, ...(e.foodName != null ? { foodName } : {}), ...(e.note != null ? { note } : {}) };
  });
  return changed ? out : list;
}
