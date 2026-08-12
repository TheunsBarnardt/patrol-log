/** Last-successful API payloads for offline read. */

import { bulkStorage } from "./bulkStorage";

export type CacheKey =
  | "residents"
  | "members"
  | "emergency"
  | "vehicles"
  | "liveMap"
  | `hotspots:${string}`
  | `stats:${string}`;

type Envelope<T> = { savedAt: string; data: T };

function storageKey(key: CacheKey): string {
  return `patrol_log.cache.${key}`;
}

export async function cacheSet<T>(key: CacheKey, data: T): Promise<void> {
  const envelope: Envelope<T> = { savedAt: new Date().toISOString(), data };
  await bulkStorage.setItem(storageKey(key), JSON.stringify(envelope));
}

export async function cacheGet<T>(key: CacheKey): Promise<Envelope<T> | null> {
  try {
    const raw = await bulkStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || parsed.data === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const EMPTY_CACHE_HINT = "Connect once to load this data.";
