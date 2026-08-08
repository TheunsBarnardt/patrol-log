// Patroller-accessible vehicles — list CPF fleet + register own vehicle.
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { vehicles } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";

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

// Only vehicles registered/assigned to this patroller.
vehiclesRoute.get("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(vehicles)
    .where(
      and(
        eq(vehicles.cpfId, auth.patroller.cpf_id),
        eq(vehicles.patrollerId, auth.patroller.patroller_id),
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
    // Allow reclaiming an unassigned plate, or updating own existing vehicle.
    if (existing.patrollerId && existing.patrollerId !== auth.patroller.patroller_id) {
      throw new AppError("VEHICLE_DUPLICATE_REGISTRATION");
    }
    const [row] = await db
      .update(vehicles)
      .set({
        patrollerId: auth.patroller.patroller_id,
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

  await logAudit(db, "vehicle.own_registered", auth, { vehicle_id: row.id, reused: false });
  return c.json(toRecord(row), 201);
});

/** Edit own vehicle (registration / description / odometer). */
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
  if (existing.patrollerId !== auth.patroller.patroller_id) throw new AppError("VEHICLE_FORBIDDEN");

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
