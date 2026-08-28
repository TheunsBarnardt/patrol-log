/** GPS trail stored on live_pins.path_json as [lat, lng][]. */

export type TrailPoint = [number, number];

const MIN_MOVE_M = 12;
const MAX_POINTS = 800;
const MAX_INCOMING = 1200;
/** Bigger than this is a GPS jump (lock / background) — do not treat as driving. */
export const TRAIL_GAP_M = 700;
const MATCH_M = 28;
const REWIND_NEAR_M = 40;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function parsePathJson(raw: unknown): TrailPoint[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: TrailPoint[] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  return out;
}

export function downsampleTrail(
  points: Array<{ lat: number; lng: number }>,
  minM = MIN_MOVE_M,
  max = MAX_POINTS,
): TrailPoint[] {
  const out: TrailPoint[] = [];
  const src = points.length > MAX_INCOMING ? points.slice(-MAX_INCOMING) : points;
  for (const p of src) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const last = out[out.length - 1];
    if (last && haversineM(last[0], last[1], p.lat, p.lng) < minM) continue;
    out.push([p.lat, p.lng]);
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

function appendPoint(path: TrailPoint[], lat: number, lng: number): TrailPoint[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return path;
  const last = path[path.length - 1];
  if (!last || haversineM(last[0], last[1], lat, lng) >= MIN_MOVE_M) {
    path = [...path, [lat, lng]];
  }
  return path.length > MAX_POINTS ? path.slice(path.length - MAX_POINTS) : path;
}

/** True when `p` sits on the trail already (not the current tip). */
function isOnOldTrail(path: TrailPoint[], p: TrailPoint): boolean {
  const until = Math.max(0, path.length - 2);
  for (let i = 0; i < until; i++) {
    const q = path[i]!;
    if (haversineM(q[0], q[1], p[0], p[1]) < REWIND_NEAR_M) return true;
  }
  return false;
}

/** Drop duplicated sliding-window concatenations. Keeps real GPS resume jumps. */
export function sanitizePatrolPath(path: TrailPoint[]): TrailPoint[] {
  if (path.length <= 1) return path;
  const out: TrailPoint[] = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!;
    const last = out[out.length - 1]!;
    const d = haversineM(last[0], last[1], p[0], p[1]);
    if (d < MIN_MOVE_M) continue;
    if (d > TRAIL_GAP_M) {
      const nxt = path[i + 1];
      if (nxt && haversineM(last[0], last[1], nxt[0], nxt[1]) <= TRAIL_GAP_M) {
        continue; // isolated GPS spike
      }
    }
    if (isOnOldTrail(out, p)) continue;
    out.push(p);
  }
  return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
}

/** Only append points that are new after the overlap with the stored trail. */
function extendWithWindow(stored: TrailPoint[], window: TrailPoint[]): TrailPoint[] {
  if (window.length === 0) return stored;
  if (stored.length === 0) return window;

  const last = stored[stored.length - 1]!;
  let matchIdx = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    const p = window[i]!;
    if (haversineM(last[0], last[1], p[0], p[1]) < MATCH_M) {
      matchIdx = i;
      break;
    }
  }

  const extra = matchIdx >= 0 ? window.slice(matchIdx + 1) : window;
  let path = stored.slice();
  for (const p of extra) {
    const prev = path[path.length - 1]!;
    const d = haversineM(prev[0], prev[1], p[0], p[1]);
    if (d < MIN_MOVE_M) continue;
    if (isOnOldTrail(path, p)) continue;
    path.push(p);
    if (path.length > MAX_POINTS) path = path.slice(path.length - MAX_POINTS);
  }
  return path;
}

/** Prefer the client's denser local trail; always include the latest heartbeat fix. */
export function mergePatrolPath(
  stored: TrailPoint[],
  incoming: Array<{ lat: number; lng: number }> | undefined,
  lat: number,
  lng: number,
): TrailPoint[] {
  let path = sanitizePatrolPath(stored);
  if (incoming && incoming.length > 0) {
    path = extendWithWindow(path, downsampleTrail(incoming));
  }
  path = appendPoint(path, lat, lng);
  return sanitizePatrolPath(path);
}

/** Split a trail so lock-screen GPS jumps are not drawn as a straight line. */
export function splitTrailSegments(path: TrailPoint[], maxGapM = TRAIL_GAP_M): TrailPoint[][] {
  const segs: TrailPoint[][] = [];
  let cur: TrailPoint[] = [];
  for (const p of path) {
    if (cur.length > 0) {
      const last = cur[cur.length - 1]!;
      if (haversineM(last[0], last[1], p[0], p[1]) > maxGapM) {
        if (cur.length >= 2) segs.push(cur);
        cur = [p];
        continue;
      }
    }
    cur.push(p);
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

export function pathKm(path: TrailPoint[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const cur = path[i]!;
    const d = haversineM(prev[0], prev[1], cur[0], cur[1]);
    if (d > TRAIL_GAP_M) continue;
    m += d;
  }
  return Math.round((m / 1000) * 10) / 10;
}
