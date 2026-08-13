/**
 * GPS breadcrumb trail for the active patrol.
 * Heartbeats append points; the live map draws the path and km.
 * Survives reloads until stand-down.
 */

import { bulkStorage } from "./bulkStorage";

export type TrackPoint = { lat: number; lng: number; at: number };

export type TrackSnapshot = {
  patrolId: string | null;
  points: TrackPoint[];
  km: number;
};

const STORAGE_KEY = "patrol_log.patrol_track";
const MIN_MOVE_M = 12;
const MAX_ACCURACY_M = 80;
const MAX_POINTS = 2500;
const MAX_SPEED_M_S = 50; // 180 km/h — drop GPS teleports

type Persisted = { patrolId: string; points: TrackPoint[]; meters: number };

let patrolId: string | null = null;
let points: TrackPoint[] = [];
let meters = 0;
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snap: TrackSnapshot) => void>();

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function snapshot(): TrackSnapshot {
  return { patrolId, points: points.slice(), km: meters / 1000 };
}

function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persist();
  }, 250);
}

async function persist() {
  if (!patrolId) return;
  const body: Persisted = { patrolId, points, meters };
  try {
    await bulkStorage.setItem(STORAGE_KEY, JSON.stringify(body));
  } catch (err) {
    console.warn("[patrol-track] persist failed", err);
  }
}

/** Flush to disk now — call before logout / background. Does not clear the trail. */
export async function flushPatrolTrack(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persist();
}

async function hydrate(id: string) {
  const incoming = patrolId === id ? points.slice() : [];
  loaded = true;
  try {
    const raw = await bulkStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed?.patrolId === id && Array.isArray(parsed.points)) {
        patrolId = id;
        points = parsed.points.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
        );
        meters = Number.isFinite(parsed.meters)
          ? parsed.meters
          : points.reduce((sum, p, i) => (i === 0 ? 0 : sum + haversineM(points[i - 1]!, p)), 0);
        const lastAt = points[points.length - 1]?.at ?? 0;
        for (const p of incoming) {
          if (p.at <= lastAt) continue;
          const prev = points[points.length - 1];
          if (prev) meters += haversineM(prev, p);
          points.push(p);
        }
        emit();
        return;
      }
    }
  } catch {
    /* start fresh */
  }
  patrolId = id;
  points = incoming;
  meters = incoming.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + haversineM(incoming[i - 1]!, p)),
    0,
  );
  emit();
}

export async function bindPatrolTrack(id: string): Promise<void> {
  if (loaded && patrolId === id) return;
  await hydrate(id);
}

export function getPatrolTrack(): TrackSnapshot {
  return snapshot();
}

export function trailForHeartbeat(): { lat: number; lng: number }[] {
  return points.slice(-800).map((p) => ({ lat: p.lat, lng: p.lng }));
}

export function subscribePatrolTrack(fn: (snap: TrackSnapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

export function appendTrackPoint(
  id: string,
  coords: { lat: number; lng: number; accuracy?: number | null },
): boolean {
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
  if (coords.accuracy != null && coords.accuracy > MAX_ACCURACY_M) return false;

  if (patrolId && patrolId !== id) {
    points = [];
    meters = 0;
    loaded = false;
  }
  patrolId = id;

  const next: TrackPoint = { lat: coords.lat, lng: coords.lng, at: Date.now() };
  const prev = points[points.length - 1];
  if (prev) {
    const dist = haversineM(prev, next);
    if (dist < MIN_MOVE_M) return false;
    const dt = Math.max(1, (next.at - prev.at) / 1000);
    if (dist > Math.max(800, dt * MAX_SPEED_M_S)) return false;
    meters += dist;
  }

  points.push(next);
  if (points.length > MAX_POINTS) {
    const drop = points.length - MAX_POINTS;
    points = points.slice(drop);
  }

  emit();
  schedulePersist();
  return true;
}

export async function clearPatrolTrack(): Promise<void> {
  patrolId = null;
  points = [];
  meters = 0;
  loaded = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await bulkStorage.deleteItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function formatTrackKm(km: number): string {
  if (km < 0.05) return "0 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 10) / 10} km`;
}

export function roundedTrackKm(km: number): number {
  return Math.max(0, Math.round(km));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPatrolTrack();
  });
  window.addEventListener("pagehide", () => {
    void flushPatrolTrack();
  });
}
