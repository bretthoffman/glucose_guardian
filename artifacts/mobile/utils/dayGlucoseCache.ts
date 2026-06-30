import type { CGMReading } from "@/components/CGMChart";

export const DAY_GLUCOSE_CACHE_MAX_ENTRIES = 14;

interface CacheEntry {
  readings: CGMReading[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getDayGlucoseCache(dayKey: string): CGMReading[] | null {
  return cache.get(dayKey)?.readings ?? null;
}

export function setDayGlucoseCache(dayKey: string, readings: CGMReading[]): void {
  if (cache.size >= DAY_GLUCOSE_CACHE_MAX_ENTRIES && !cache.has(dayKey)) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(dayKey, { readings, fetchedAt: Date.now() });
}

export function clearDayGlucoseCache(): void {
  cache.clear();
}

export function invalidateDayGlucoseCache(dayKey: string): void {
  cache.delete(dayKey);
}

/** For tests — current cache size. */
export function dayGlucoseCacheSize(): number {
  return cache.size;
}
