// Patroller-accessible vehicles — list assigned (incl. shared) + register own vehicle.
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { vehicles } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";
import {
  addVehicleMember,
  isVehicleMember,
  vehicleIdsForPatroller,
} from "../lib/vehicle-members.js";

export const vehiclesRoute = new Hono<AppContext>();

function toRecord(row: typeof vehicles.$inferSelect) {
  return {
    id: row.id,
    registration: row.registration,
    description: row.description,
    lastOdometer: row.lastOdometer,
    status: row.status,
    sectorId: row.sectorId,
    cpfId: row.cpfId,
    patrollerId: row.patrollerId,
  };
}

// Vehicles assigned to this patroller (including shared household vehicles).
vehiclesRoute.get("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const ids = await vehicleIdsForPatroller(db, auth.patroller.patroller_id);
  if (!ids.length) return c.json({ results: [] });

  const rows = await db
    .select()
    .from(vehicles)
    .where(
      and(
        eq(vehicles.cpfId, auth.patroller.cpf_id),
        inArray(vehicles.id, ids),
        eq(vehicles.status, "available"),
      ),
    )
    .orderBy(vehicles.registration);
  return c.json({ results: rows.map(toRecord) });
});

// Register (or claim) the patroller's own vehicle for patrol use.
vehiclesRoute.post("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const body = await c.req
    .json<{ registration?: string; description?: string; last_odometer?: number }>()
    .catch(() => null);

  const registration = body?.registration?.trim().toUpperCase();
  if (!registration || registration.length < 2) {
    throw new AppError("VEHICLE_REGISTRATION_REQUIRED");
  }

  const db = getDb(c.env);
  const existing = await db.query.vehicles.findFirst({
    where: (v, { and, eq }) =>
      and(eq(v.cpfId, auth.patroller.cpf_id), eq(v.registration, registration)),
  });

  if (existing) {
    const mine = await isVehicleMember(db, existing.id, auth.patroller.patroller_id);
    // Allow reclaiming an unassigned plate, or updating a vehicle already shared with this member.
    if (!mine) {
      const anyMembers = await db.query.vehicleMembers.findFirst({
        where: (vm, { eq }) => eq(vm.vehicleId, existing.id),
      });
      if (existing.patrollerId || anyMembers) {
        throw new AppError("VEHICLE_DUPLICATE_REGISTRATION");
      }
    }

    const [row] = await db
      .update(vehicles)
      .set({
        description: body?.description?.trim() || existing.description,
        lastOdometer:
          body?.last_odometer != null && Number.isFinite(body.last_odometer)
            ? Math.max(0, Math.floor(body.last_odometer))
            : existing.lastOdometer,
        status: "available",
        sectorId: auth.patroller.sector_id,
      })
      .where(eq(vehicles.id, existing.id))
      .returning();
    await addVehicleMember(db, row.id, auth.patroller.patroller_id);
    await logAudit(db, "vehicle.own_registered", auth, { vehicle_id: row.id, reused: true });
    return c.json(toRecord(row), 200);
  }

  const odo =
    body?.last_odometer != null && Number.isFinite(body.last_odometer)
      ? Math.max(0, Math.floor(body.last_odometer))
      : 0;

  const [row] = await db
    .insert(vehicles)
    .values({
      cpfId: auth.patroller.cpf_id,
      sectorId: auth.patroller.sector_id,
      patrollerId: auth.patroller.patroller_id,
      registration,
      description: body?.description?.trim() || "Own vehicle",
      lastOdometer: odo,
      status: "available",
    })
    .returning();

  await addVehicleMember(db, row.id, auth.patroller.patroller_id);
  await logAudit(db, "vehicle.own_registered", auth, { vehicle_id: row.id, reused: false });
  return c.json(toRecord(row), 201);
});

/** Edit own / shared vehicle (registration / description / odometer). */
vehiclesRoute.patch("/:id", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req
    .json<{ registration?: string; description?: string; last_odometer?: number }>()
    .catch(() => null);

  const db = getDb(c.env);
  const existing = await db.query.vehicles.findFirst({
    where: (v, { and, eq }) => and(eq(v.id, id), eq(v.cpfId, auth.patroller.cpf_id)),
  });
  if (!existing) throw new AppError("VEHICLE_NOT_FOUND");
  if (!(await isVehicleMember(db, existing.id, auth.patroller.patroller_id))) {
    throw new AppError("VEHICLE_FORBIDDEN");
  }

  const update: Partial<typeof vehicles.$inferInsert> = {};
  if (body?.registration != null) {
    const registration = body.registration.trim().toUpperCase();
    if (registration.length < 2) throw new AppError("VEHICLE_REGISTRATION_REQUIRED");
    if (registration !== existing.registration) {
      const clash = await db.query.vehicles.findFirst({
        where: (v, { and, eq }) =>
          and(eq(v.cpfId, auth.patroller.cpf_id), eq(v.registration, registration)),
      });
      if (clash && clash.id !== existing.id) throw new AppError("VEHICLE_DUPLICATE_REGISTRATION");
      update.registration = registration;
    }
  }
  if (body?.description !== undefined) {
    update.description = body.description?.trim() || existing.description;
  }
  if (body?.last_odometer != null && Number.isFinite(body.last_odometer)) {
    update.lastOdometer = Math.max(0, Math.floor(body.last_odometer));
  }

  const [row] = await db.update(vehicles).set(update).where(eq(vehicles.id, id)).returning();
  await logAudit(db, "vehicle.own_updated", auth, { vehicle_id: row.id });
  return c.json(toRecord(row));
});
