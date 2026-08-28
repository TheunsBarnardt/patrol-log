import { parseSqliteUtc, type LiveMapPin, type PatrolType } from "@patrol-log/shared";
import { parsePathJson, pathKm, sanitizePatrolPath } from "./trail.js";

const STALE_MS = 5 * 60_000;

export function toLiveMapPin(opts: {
  pin: {
    patrolId: string;
    callSign: string;
    lat: number;
    lng: number;
    heading: number | null;
    speed: number | null;
    lastSeenAt: string;
    outOfSector: boolean;
    pathJson: unknown;
  };
  patrol: {
    patrolType: PatrolType | null;
    vehicleId: string | null;
    startTime: string;
  };
  vehicleRegistration?: string;
  /** Always the primary's call sign — joined passengers must not appear as their own pin. */
  callSign?: string;
  now: number;
}): LiveMapPin {
  const path = sanitizePatrolPath(parsePathJson(opts.pin.pathJson));
  const startMs = parseSqliteUtc(opts.patrol.startTime)?.getTime() ?? new Date(opts.patrol.startTime).getTime();
  return {
    patrol_id: opts.pin.patrolId,
    call_sign: opts.callSign ?? opts.pin.callSign,
    patrol_type: opts.patrol.patrolType ?? "foot",
    patrol_vehicle: opts.patrol.vehicleId ?? undefined,
    vehicle_registration: opts.vehicleRegistration,
    lat: opts.pin.lat,
    lng: opts.pin.lng,
    heading: opts.pin.heading ?? undefined,
    speed: opts.pin.speed ?? undefined,
    last_update: opts.pin.lastSeenAt,
    duration_on_patrol_min: Math.floor((opts.now - startMs) / 60_000),
    stale: opts.now - (parseSqliteUtc(opts.pin.lastSeenAt)?.getTime() ?? 0) > STALE_MS,
    path: path.length >= 2 ? path : undefined,
    path_km: path.length >= 2 ? pathKm(path) : undefined,
  };
}
