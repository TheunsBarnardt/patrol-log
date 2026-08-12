/** Per-feature offline sync status — Home buttons show progress, UI stays usable. */

import { create } from "zustand";
import type { HotspotPeriod, Message, MessageChannel, StatsPeriod } from "@patrol-log/shared";
import { api } from "./api";
import { cacheGet, cacheGetSync, cacheSet, warmCacheMemory, type CacheKey } from "./offlineCache";
import { storage } from "./storage";
import { useConnectivityStore } from "./connectivity";

export type SyncFeature =
  | "residents"
  | "members"
  | "emergency"
  | "vehicles"
  | "liveMap"
  | "hotspots"
  | "stats"
  | "activePatrol"
  | "messages";

export type FeatureStatus = "idle" | "loading" | "ready" | "error";

type FeatureState = Record<SyncFeature, FeatureStatus>;

const HOTSPOT_PERIODS: HotspotPeriod[] = ["today", "7d", "30d", "90d"];
const STAT_PERIODS: StatsPeriod[] = ["month", "7d", "30d", "today", "all"];
/** Cap how many chat threads we prefetch so first sync stays snappy. */
const MAX_THREAD_PREFETCH = 25;

const initialFeatures = (): FeatureState => ({
  residents: "idle",
  members: "idle",
  emergency: "idle",
  vehicles: "idle",
  liveMap: "idle",
  hotspots: "idle",
  stats: "idle",
  activePatrol: "idle",
  messages: "idle",
});

interface CacheSyncState {
  features: FeatureState;
  running: boolean;
  setFeature: (f: SyncFeature, s: FeatureStatus) => void;
  hydrateFromDisk: () => Promise<void>;
  startBackgroundSync: () => void;
}

function errorCode(err: unknown): string | undefined {
  return (err as { body?: { error?: string } })?.body?.error ?? (err as { code?: string })?.code;
}

function isEmptyOk(err: unknown): boolean {
  const code = errorCode(err);
  return (
    code === "RESIDENTS_NO_RESULTS" ||
    code === "MEMBERS_NO_RESULTS" ||
    code === "EMERGENCY_NO_SERVICES_CONFIGURED"
  );
}

async function cacheList(key: CacheKey, fetch: () => Promise<{ results: unknown[] }>): Promise<void> {
  try {
    const r = await fetch();
    await cacheSet(key, r.results);
  } catch (err) {
    if (isEmptyOk(err)) {
      await cacheSet(key, []);
      return;
    }
    throw err;
  }
}

/** Download inbox + recent threads for offline reading. */
export async function syncMessagesCache(): Promise<void> {
  const res = await api.messageChannels();
  await cacheSet("messageChannels", res.channels);

  const targets = res.channels
    .slice()
    .sort((a, b) => {
      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return bt - at;
    })
    .slice(0, MAX_THREAD_PREFETCH);

  await Promise.all(
    targets.map(async (ch) => {
      try {
        const thread = await api.channelMessages(ch.id);
        // Store newest-last (same order ChannelScreen uses after reverse).
        await cacheSet(`messageThread:${ch.id}`, [...thread.messages].reverse());
      } catch {
        // Keep prior thread cache if any.
      }
      try {
        const mem = await api.channelMembers(ch.id);
        await cacheSet(`messageMembers:${ch.id}`, mem.members);
      } catch {
        // optional
      }
    }),
  );
}

async function runFeature(
  feature: SyncFeature,
  setFeature: (f: SyncFeature, s: FeatureStatus) => void,
  work: () => Promise<void>,
): Promise<void> {
  const prev = useCacheSyncStore.getState().features[feature];
  if (prev !== "ready") setFeature(feature, "loading");
  try {
    await work();
    setFeature(feature, "ready");
  } catch {
    const keyMap: Partial<Record<SyncFeature, CacheKey>> = {
      residents: "residents",
      members: "members",
      emergency: "emergency",
      vehicles: "vehicles",
      liveMap: "liveMap",
      messages: "messageChannels",
    };
    const key = keyMap[feature];
    const has = key ? !!(await cacheGet(key))?.data : prev === "ready";
    setFeature(feature, has ? "ready" : "error");
  }
}

let syncGeneration = 0;

export const useCacheSyncStore = create<CacheSyncState>((set, get) => ({
  features: initialFeatures(),
  running: false,

  setFeature(f, s) {
    set((state) => ({ features: { ...state.features, [f]: s } }));
  },

  async hydrateFromDisk() {
    await warmCacheMemory([
      "residents",
      "members",
      "emergency",
      "vehicles",
      "liveMap",
      "messageChannels",
    ]);
    const next = { ...get().features };
    for (const key of ["residents", "members", "emergency", "vehicles", "liveMap"] as const) {
      if (cacheGetSync(key)?.data != null) next[key] = "ready";
    }
    if (cacheGetSync<MessageChannel[]>("messageChannels")?.data != null) next.messages = "ready";

    for (const p of HOTSPOT_PERIODS) {
      if (cacheGetSync(`hotspots:${p}`)?.data != null) {
        next.hotspots = "ready";
        break;
      }
    }
    for (const p of STAT_PERIODS) {
      if (cacheGetSync(`stats:${p}`)?.data != null) {
        next.stats = "ready";
        break;
      }
    }
    try {
      const ap = await storage.getActivePatrolCache();
      if (ap) next.activePatrol = "ready";
    } catch {}
    set({ features: next });
  },

  startBackgroundSync() {
    if (get().running) return;
    const gen = ++syncGeneration;
    set({ running: true });

    void (async () => {
      await get().hydrateFromDisk();

      const online = await useConnectivityStore.getState().probe();
      if (!online || gen !== syncGeneration) {
        if (!online) {
          const feats = get().features;
          for (const f of Object.keys(feats) as SyncFeature[]) {
            if (feats[f] === "idle") get().setFeature(f, "error");
          }
        }
        if (gen === syncGeneration) set({ running: false });
        return;
      }

      const setFeature = get().setFeature;

      await Promise.all([
        runFeature("residents", setFeature, () => cacheList("residents", () => api.residents())),
        runFeature("members", setFeature, () => cacheList("members", () => api.members())),
        runFeature("emergency", setFeature, () =>
          cacheList("emergency", () => api.emergencyContacts()),
        ),
        runFeature("vehicles", setFeature, () => cacheList("vehicles", () => api.vehicles())),
        runFeature("liveMap", setFeature, async () => {
          const r = await api.liveMapSnapshot();
          await cacheSet("liveMap", r.pins);
        }),
        runFeature("hotspots", setFeature, async () => {
          await Promise.all(
            HOTSPOT_PERIODS.map(async (period) => {
              const r = await api.hotspots(period);
              await cacheSet(`hotspots:${period}`, r.pins);
            }),
          );
        }),
        runFeature("stats", setFeature, async () => {
          await Promise.all(
            STAT_PERIODS.map(async (period) => {
              const s = await api.myPatrolStats(period);
              await cacheSet(`stats:${period}`, s);
            }),
          );
        }),
        runFeature("activePatrol", setFeature, async () => {
          const p = await api.activePatrol();
          if (p) await storage.setActivePatrolCache(JSON.stringify(p));
          else await storage.clearActivePatrolCache();
        }),
        runFeature("messages", setFeature, () => syncMessagesCache()),
      ]);

      if (gen === syncGeneration) set({ running: false });
    })();
  },
}));

export function refreshSessionCacheInBackground(): void {
  useCacheSyncStore.getState().startBackgroundSync();
}

/** Helpers for screens — typed accessors. */
export async function readCachedChannels(): Promise<MessageChannel[] | null> {
  return (await cacheGet<MessageChannel[]>("messageChannels"))?.data ?? null;
}

export async function readCachedThread(channelId: string): Promise<Message[] | null> {
  return (await cacheGet<Message[]>(`messageThread:${channelId}`))?.data ?? null;
}
