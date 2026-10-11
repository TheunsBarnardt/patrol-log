/** Helpers for multi-member vehicle assignment (shared household vehicles). */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { patrollers, vehicleMembers, vehicles } from "../db/schema.js";

export type VehicleMemberInfo = {
  id: string;
  callSign: string;
  name: string;
};

/** Replace all assignees for a vehicle and sync legacy vehicles.patroller_id. */
export async function setVehicleMembers(
  db: Db,
  vehicleId: string,
  patrollerIds: string[],
): Promise<void> {
  const unique = [...new Set(patrollerIds.filter(Boolean))];
  await db.delete(vehicleMembers).where(eq(vehicleMembers.vehicleId, vehicleId));
  if (unique.length) {
    await db.insert(vehicleMembers).values(
      unique.map((patrollerId) => ({ vehicleId, patrollerId })),
    );
  }
  await db
    .update(vehicles)
    .set({ patrollerId: unique[0] ?? null })
    .where(eq(vehicles.id, vehicleId));
}

/** Ensure a patroller is listed on the vehicle (idempotent). */
export async function addVehicleMember(
  db: Db,
  vehicleId: string,
  patrollerId: string,
): Promise<void> {
  const existing = await db.query.vehicleMembers.findFirst({
    where: (vm, { and, eq }) => and(eq(vm.vehicleId, vehicleId), eq(vm.patrollerId, patrollerId)),
  });
  if (!existing) {
    await db.insert(vehicleMembers).values({ vehicleId, patrollerId });
  }
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) });
  if (vehicle && !vehicle.patrollerId) {
    await db.update(vehicles).set({ patrollerId }).where(eq(vehicles.id, vehicleId));
  }
}

export async function isVehicleMember(
  db: Db,
  vehicleId: string,
  patrollerId: string,
): Promise<boolean> {
  const row = await db.query.vehicleMembers.findFirst({
    where: (vm, { and, eq }) => and(eq(vm.vehicleId, vehicleId), eq(vm.patrollerId, patrollerId)),
  });
  if (row) return true;
  // Legacy fallback before backfill / during mixed state.
  const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) });
  return vehicle?.patrollerId === patrollerId;
}

/** Vehicle IDs assigned to this patroller (junction + legacy column). */
export async function vehicleIdsForPatroller(db: Db, patrollerId: string): Promise<string[]> {
  const fromJunction = await db
    .select({ vehicleId: vehicleMembers.vehicleId })
    .from(vehicleMembers)
    .where(eq(vehicleMembers.patrollerId, patrollerId));
  const fromLegacy = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.patrollerId, patrollerId));
  return [...new Set([...fromJunction.map((r) => r.vehicleId), ...fromLegacy.map((r) => r.id)])];
}

export async function membersForVehicles(
  db: Db,
  vehicleIds: string[],
): Promise<Map<string, VehicleMemberInfo[]>> {
  const map = new Map<string, VehicleMemberInfo[]>();
  if (!vehicleIds.length) return map;

  const rows = await db
    .select({
      vehicleId: vehicleMembers.vehicleId,
      id: patrollers.id,
      callSign: patrollers.callSign,
      name: patrollers.name,
    })
    .from(vehicleMembers)
    .innerJoin(patrollers, eq(patrollers.id, vehicleMembers.patrollerId))
    .where(inArray(vehicleMembers.vehicleId, vehicleIds))
    .orderBy(patrollers.callSign);

  for (const row of rows) {
    const list = map.get(row.vehicleId) ?? [];
    list.push({ id: row.id, callSign: row.callSign, name: row.name });
    map.set(row.vehicleId, list);
  }

  // Legacy: vehicles with patroller_id but no junction rows yet.
  const missing = vehicleIds.filter((id) => !map.has(id));
  if (missing.length) {
    const legacy = await db
      .select({
        vehicleId: vehicles.id,
        id: patrollers.id,
        callSign: patrollers.callSign,
        name: patrollers.name,
      })
      .from(vehicles)
      .innerJoin(patrollers, eq(patrollers.id, vehicles.patrollerId))
      .where(and(inArray(vehicles.id, missing)));
    for (const row of legacy) {
      map.set(row.vehicleId, [{ id: row.id, callSign: row.callSign, name: row.name }]);
    }
  }

  return map;
}

/** Resolve call signs (or ids) in a CPF to patroller ids; skips unknowns. */
export async function resolvePatrollerIdsInCpf(
  db: Db,
  cpfId: string,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = await db
    .select({ id: patrollers.id })
    .from(patrollers)
    .where(and(eq(patrollers.cpfId, cpfId), inArray(patrollers.id, unique)));
  return rows.map((r) => r.id);
}
