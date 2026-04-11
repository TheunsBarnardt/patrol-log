// Geo helpers for SARS compliance + sector boundary checks.
// FDL: commence-patrol.rules.geo.minimum_accuracy_meters = 100

import type { GeoPoint } from "@patrol-log/shared";
import type { GeoJSONPolygon } from "../db/schema.js";

export type { GeoJSONPolygon };

/**
 * Ray-casting point-in-polygon test.
 * GeoJSON uses [longitude, latitude] coordinate order.
 */
export function pointInPolygon(lat: number, lng: number, polygon: GeoJSONPolygon): boolean {
  const ring = polygon.coordinates[0]; // outer ring; holes ignored for patrol use-case
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // xi=lng, yi=lat (GeoJSON order)
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const MAX_ACCURACY_M = 100;

export function isGeoSarsCompliant(point: GeoPoint | undefined | null): boolean {
  if (!point) return false;
  if (typeof point.lat !== "number" || typeof point.lng !== "number") return false;
  if (point.accuracy_m == null || point.accuracy_m > MAX_ACCURACY_M) return false;
  return true;
}

// Cryptographic seal over the stand-down record fields.
// FDL: stand-down-patrol.rules.audit.seal_algorithm = sha256_over_all_record_fields
export async function sealRecord(record: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(record, Object.keys(record).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
