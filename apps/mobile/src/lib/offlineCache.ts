/** Last-successful API payloads for offline read — memory-first (instant UI). */

import { bulkStorage } from "./bulkStorage";

export type CacheKey =
  | "residents"
  | "members"
  | "emergency"
  | "vehicles"
  | "liveMap"
  | "messageChannels"
  | `messageThread:${string}`
  | `messageMembers:${string}`
  | `hotspots:${string}`
  | `stats:${string}`;

type Envelope<T> = { savedAt: string; data: T };

/** In-RAM copy so directories open instantly without waiting on storage. */
const memory = new Map<string, Envelope<unknown>>();

function storageKey(key: CacheKey): string {
  return `patrol_log.cache.${key}`;
}

export async function cacheSet<T>(key: CacheKey, data: T): Promise<void> {
  const envelope: Envelope<T> = { savedAt: new Date().toISOString(), data };
  memory.set(key, envelope as Envelope<unknown>);
  await bulkStorage.setItem(storageKey(key), JSON.stringify(envelope));
}

/** Sync read from RAM (populated by session download / prior cacheGet). */
export function cacheGetSync<T>(key: CacheKey): Envelope<T> | null {
  const hit = memory.get(key);
  if (!hit || hit.data === undefined) return null;
  return hit as Envelope<T>;
}

export async function cacheGet<T>(key: CacheKey): Promise<Envelope<T> | null> {
  const fromMem = cacheGetSync<T>(key);
  if (fromMem) return fromMem;
  try {
    const raw = await bulkStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || parsed.data === undefined) return null;
    memory.set(key, parsed as Envelope<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

/** Prefetch disk → memory so Members/Residents open instantly after login. */
export async function warmCacheMemory(keys: CacheKey[]): Promise<void> {
  await Promise.all(keys.map((k) => cacheGet(k)));
}

export const EMPTY_CACHE_HINT = "Nothing saved on this device yet. Connect online once to download.";
