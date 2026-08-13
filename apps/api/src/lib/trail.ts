/** GPS trail stored on live_pins.path_json as [lat, lng][]. */

export type TrailPoint = [number, number];

const MIN_MOVE_M = 12;
const MAX_POINTS = 800;
const MAX_INCOMING = 1200;

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

/** Prefer the client's denser local trail; always include the latest heartbeat fix. */
export function mergePatrolPath(
  stored: TrailPoint[],
  incoming: Array<{ lat: number; lng: number }> | undefined,
  lat: number,
  lng: number,
): TrailPoint[] {
  let path = stored.slice();
  if (incoming && incoming.length > 0) {
    const down = downsampleTrail(incoming);
    if (down.length >= path.length) {
      path = down;
    } else {
      for (const p of down) {
        const last = path[path.length - 1];
        if (!last || haversineM(last[0], last[1], p[0], p[1]) >= MIN_MOVE_M) {
          path.push(p);
        }
      }
      if (path.length > MAX_POINTS) path = path.slice(path.length - MAX_POINTS);
    }
  }
  return appendPoint(path, lat, lng);
}

export function pathKm(path: TrailPoint[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const cur = path[i]!;
    m += haversineM(prev[0], prev[1], cur[0], cur[1]);
  }
  return Math.round((m / 1000) * 10) / 10;
}
