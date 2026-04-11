// Admin portal CRUD routes.
// Follow-ups from the brainstorm: member-profile-admin-edit is scoped to the admin's own sector.

import { Hono } from "hono";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { AppError, type LiveMapPin } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import {
  auditLog,
  devices,
  emergencyServices,
  incidents,
  livePins,
  nextOfKin,
  patrollers,
  patrols,
  residents,
  vehicles,
} from "../db/schema.js";
import { hashPassword } from "../lib/hashing.js";
import { logAudit } from "../lib/audit.js";

export const admin = new Hono<AppContext>();

admin.use("*", requireAuth(), requireAccessLevel("admin", "sector_lead"));

// ── Live map snapshot (all active pins for this CPF) ─────
// Admin sees a 30-minute window — stale if > 2 min, not shown if > 30 min.
// This tolerates brief phone backgrounding without losing the pin entirely.
const STALE_MS = 2 * 60_000;      // 2 min — mark as stale/grey
const WINDOW_MS = 30 * 60_000;    // 30 min — maximum age shown

admin.get("/live-map", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const since = new Date(Date.now() - WINDOW_MS);

  const rows = await db
    .select()
    .from(livePins)
    .where(and(eq(livePins.cpfId, auth.patroller.cpf_id), gt(livePins.lastSeenAt, since)));

  const now = Date.now();
  const pins: LiveMapPin[] = await Promise.all(
    rows.map(async (r) => {
      const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, r.patrolId) });
      return {
        patrol_id: r.patrolId,
        call_sign: r.callSign,
        patrol_type: patrol?.patrolType ?? "foot",
        patrol_vehicle: patrol?.vehicleId ?? undefined,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading ?? undefined,
        speed: r.speed ?? undefined,
        last_update: r.lastSeenAt.toISOString(),
        duration_on_patrol_min: patrol ? Math.floor((now - patrol.startTime.getTime()) / 60_000) : 0,
        stale: now - r.lastSeenAt.getTime() > STALE_MS,
      };
    }),
  );

  return c.json({ pins });
});

// ── Dashboard stats ──────────────────────────────────────
admin.get("/stats", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const [activePatrols, registeredResidents, registeredMembers] = await Promise.all([
    db.query.patrols.findMany({ where: (p, { and, eq }) => and(eq(p.cpfId, auth.patroller.cpf_id), eq(p.state, "active")) }),
    db.query.residents.findMany({ where: eq(residents.cpfId, auth.patroller.cpf_id) }),
    db.query.patrollers.findMany({ where: eq(patrollers.cpfId, auth.patroller.cpf_id) }),
  ]);
  return c.json({
    active_patrols: activePatrols.length,
    residents: registeredResidents.length,
    members: registeredMembers.length,
  });
});

// ── Residents CRUD ───────────────────────────────────────
admin.get("/residents", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.select().from(residents).where(eq(residents.cpfId, auth.patroller.cpf_id)).orderBy(residents.name);
  return c.json({ results: rows });
});

admin.post("/residents", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name: string; phone: string; address: string; sector_id?: string }>();
  const db = getDb(c.env);
  const [created] = await db.insert(residents).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: body.sector_id ?? auth.patroller.sector_id,
    name: body.name,
    phone: body.phone,
    address: body.address,
  }).returning();
  await logAudit(db, "admin.resident.created", auth, { resident_id: created.id });
  return c.json(created);
});

admin.patch("/residents/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; phone: string; address: string }>>();
  const db = getDb(c.env);
  const [updated] = await db.update(residents).set(body).where(eq(residents.id, id)).returning();
  await logAudit(db, "admin.resident.updated", auth, { resident_id: id });
  return c.json(updated);
});

admin.delete("/residents/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.delete(residents).where(eq(residents.id, id));
  await logAudit(db, "admin.resident.deleted", auth, { resident_id: id });
  return c.json({ ok: true });
});

// ── Members CRUD ─────────────────────────────────────────
// Scope rule (brainstorm): sector_lead/admin can only edit members in their own sector.
admin.get("/members", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.select().from(patrollers).where(eq(patrollers.cpfId, auth.patroller.cpf_id)).orderBy(patrollers.name);
  return c.json({ results: rows });
});

admin.post("/members", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ call_sign: string; name: string; phone?: string; address?: string; password: string; access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin"; sector_id?: string }>();
  const db = getDb(c.env);
  const targetSector = body.sector_id ?? auth.patroller.sector_id;
  if (auth.patroller.access_level !== "admin" && targetSector !== auth.patroller.sector_id) {
    throw new AppError("STAND_DOWN_UNAUTHORIZED");
  }
  const passwordHash = await hashPassword(body.password);
  const [created] = await db.insert(patrollers).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: targetSector,
    callSign: body.call_sign.toUpperCase(),
    name: body.name,
    phone: body.phone ?? null,
    address: body.address ?? null,
    passwordHash,
    accessLevel: body.access_level,
  }).returning();
  await logAudit(db, "admin.member.created", auth, { member_id: created.id });
  return c.json(created);
});

admin.patch("/members/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; phone: string; address: string; status: "active" | "inactive" | "suspended"; access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin"; password: string; sector_id: string }>>();
  const db = getDb(c.env);

  const target = await db.query.patrollers.findFirst({ where: eq(patrollers.id, id) });
  if (!target) throw new AppError("MEMBERS_NO_RESULTS");
  if (target.cpfId !== auth.patroller.cpf_id) throw new AppError("STAND_DOWN_UNAUTHORIZED");
  if (auth.patroller.access_level !== "admin" && target.sectorId !== auth.patroller.sector_id) {
    throw new AppError("STAND_DOWN_UNAUTHORIZED");
  }

  const update: Partial<typeof patrollers.$inferInsert> = {
    name: body.name,
    phone: body.phone,
    address: body.address,
    status: body.status,
    accessLevel: body.access_level,
    sectorId: body.sector_id,
  };
  if (body.password) update.passwordHash = await hashPassword(body.password);
  const [updated] = await db.update(patrollers).set(update).where(eq(patrollers.id, id)).returning();
  await logAudit(db, "admin.member.updated", auth, { member_id: id });
  return c.json(updated);
});

admin.post("/members/:id/next-of-kin", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ name: string; relationship: string; phone: string; alternate_phone?: string }>();
  const db = getDb(c.env);
  const [row] = await db.insert(nextOfKin).values({
    patrollerId: id,
    name: body.name,
    relationship: body.relationship,
    phone: body.phone,
    alternatePhone: body.alternate_phone ?? null,
  }).returning();
  await logAudit(db, "admin.nok.created", auth, { member_id: id, nok_id: row.id });
  return c.json(row);
});

// ── Emergency services CRUD ──────────────────────────────
admin.get("/emergency-services", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.select().from(emergencyServices).where(eq(emergencyServices.cpfId, auth.patroller.cpf_id)).orderBy(emergencyServices.priority);
  return c.json({ results: rows });
});

admin.post("/emergency-services", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name: string; service_type: string; primary_number: string; secondary_number?: string; address?: string; priority?: number; sensitive?: boolean }>();
  const db = getDb(c.env);
  const [row] = await db.insert(emergencyServices).values({
    cpfId: auth.patroller.cpf_id,
    name: body.name,
    serviceType: body.service_type as any,
    primaryNumber: body.primary_number,
    secondaryNumber: body.secondary_number ?? null,
    address: body.address ?? null,
    priority: body.priority ?? 100,
    sensitive: body.sensitive ?? false,
  }).returning();
  await logAudit(db, "admin.emergency.created", auth, { service_id: row.id });
  return c.json(row);
});

admin.patch("/emergency-services/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ name: string; service_type: string; primary_number: string; secondary_number: string; address: string; priority: number; sensitive: boolean }>>();
  const db = getDb(c.env);
  const update: Partial<typeof emergencyServices.$inferInsert> = {
    name: body.name,
    serviceType: body.service_type as any,
    primaryNumber: body.primary_number,
    secondaryNumber: body.secondary_number,
    address: body.address,
    priority: body.priority,
    sensitive: body.sensitive,
    verifiedAt: new Date(),
  };
  const [row] = await db.update(emergencyServices).set(update).where(eq(emergencyServices.id, id)).returning();
  await logAudit(db, "admin.emergency.updated", auth, { service_id: id });
  return c.json(row);
});

admin.delete("/emergency-services/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.delete(emergencyServices).where(eq(emergencyServices.id, id));
  await logAudit(db, "admin.emergency.deleted", auth, { service_id: id });
  return c.json({ ok: true });
});

// ── Vehicles CRUD ────────────────────────────────────────
admin.get("/vehicles", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: vehicles.id,
      cpfId: vehicles.cpfId,
      sectorId: vehicles.sectorId,
      patrollerId: vehicles.patrollerId,
      registration: vehicles.registration,
      description: vehicles.description,
      lastOdometer: vehicles.lastOdometer,
      status: vehicles.status,
      createdAt: vehicles.createdAt,
      memberCallSign: patrollers.callSign,
      memberName: patrollers.name,
    })
    .from(vehicles)
    .leftJoin(patrollers, eq(vehicles.patrollerId, patrollers.id))
    .where(eq(vehicles.cpfId, auth.patroller.cpf_id))
    .orderBy(vehicles.registration);
  return c.json({ results: rows });
});

admin.post("/vehicles", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ registration: string; description?: string; last_odometer?: number; status?: string; sector_id?: string; patroller_id?: string }>();
  const db = getDb(c.env);
  const [row] = await db.insert(vehicles).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: body.sector_id ?? auth.patroller.sector_id,
    patrollerId: body.patroller_id ?? null,
    registration: body.registration.toUpperCase(),
    description: body.description ?? null,
    lastOdometer: body.last_odometer ?? 0,
    status: (body.status as any) ?? "available",
  }).returning();
  await logAudit(db, "admin.vehicle.created", auth, { vehicle_id: row.id });
  return c.json(row);
});

admin.patch("/vehicles/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ description: string; status: string; last_odometer: number; patroller_id: string | null }>>();
  const db = getDb(c.env);
  const update: Partial<typeof vehicles.$inferInsert> = {};
  if (body.description !== undefined) update.description = body.description;
  if (body.status !== undefined) update.status = body.status as any;
  if (body.last_odometer !== undefined) update.lastOdometer = body.last_odometer;
  if ("patroller_id" in body) update.patrollerId = body.patroller_id ?? null;
  const [row] = await db.update(vehicles).set(update).where(eq(vehicles.id, id)).returning();
  await logAudit(db, "admin.vehicle.updated", auth, { vehicle_id: id });
  return c.json(row);
});

admin.delete("/vehicles/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.delete(vehicles).where(eq(vehicles.id, id));
  await logAudit(db, "admin.vehicle.deleted", auth, { vehicle_id: id });
  return c.json({ ok: true });
});

// ── Patrols (view + admin force-close) ───────────────────
admin.get("/patrols", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.select().from(patrols).where(eq(patrols.cpfId, auth.patroller.cpf_id)).orderBy(desc(patrols.startTime)).limit(200);
  return c.json({ results: rows });
});

// ── Devices (admin view + revoke) ────────────────────────
admin.get("/devices", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(devices)
    .leftJoin(patrollers, eq(devices.patrollerId, patrollers.id))
    .where(eq(patrollers.cpfId, auth.patroller.cpf_id))
    .orderBy(desc(devices.lastSeenAt));
  return c.json({ results: rows });
});

admin.post("/devices/:id/revoke", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  await db.update(devices).set({ status: "revoked" }).where(eq(devices.id, id));
  await logAudit(db, "admin.device.revoked", auth, { device_row_id: id });
  return c.json({ ok: true });
});

// ── Bulk import endpoints ────────────────────────────────
type ImportResult = { imported: number; skipped: number; errors: string[] };

admin.post("/residents/import", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ rows: Array<{ name: string; phone: string; address?: string }> }>();
  const db = getDb(c.env);
  let imported = 0; let skipped = 0; const errors: string[] = [];
  for (const r of body.rows) {
    if (!r.name?.trim() || !r.phone?.trim()) { skipped++; continue; }
    try {
      await db.insert(residents).values({
        cpfId: auth.patroller.cpf_id,
        sectorId: auth.patroller.sector_id,
        name: r.name.trim(),
        phone: r.phone.trim(),
        address: r.address?.trim() ?? "",
      });
      imported++;
    } catch { skipped++; }
  }
  await logAudit(db, "admin.residents.imported", auth, { count: imported });
  return c.json({ imported, skipped, errors } satisfies ImportResult);
});

admin.post("/members/import", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ rows: Array<{ call_sign: string; name: string; phone?: string; address?: string; access_level?: string; password?: string }> }>();
  const db = getDb(c.env);
  let imported = 0; let skipped = 0; const errors: string[] = [];
  for (const r of body.rows) {
    if (!r.call_sign?.trim() || !r.name?.trim()) { skipped++; continue; }
    try {
      const pwd = r.password?.trim() || `Change@Me1`;
      const passwordHash = await hashPassword(pwd);
      await db.insert(patrollers).values({
        cpfId: auth.patroller.cpf_id,
        sectorId: auth.patroller.sector_id,
        callSign: r.call_sign.trim().toUpperCase(),
        name: r.name.trim(),
        phone: r.phone?.trim() ?? null,
        address: r.address?.trim() ?? null,
        passwordHash,
        accessLevel: (r.access_level as any) ?? "patroller",
      });
      imported++;
    } catch (e: any) {
      errors.push(`${r.call_sign}: ${e?.message ?? "duplicate or invalid"}`);
      skipped++;
    }
  }
  await logAudit(db, "admin.members.imported", auth, { count: imported });
  return c.json({ imported, skipped, errors } satisfies ImportResult);
});

admin.post("/emergency-services/import", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ rows: Array<{ name: string; service_type?: string; primary_number: string; secondary_number?: string; address?: string; priority?: string | number; sensitive?: string | boolean }> }>();
  const db = getDb(c.env);
  let imported = 0; let skipped = 0; const errors: string[] = [];
  for (const r of body.rows) {
    if (!r.name?.trim() || !r.primary_number?.trim()) { skipped++; continue; }
    try {
      await db.insert(emergencyServices).values({
        cpfId: auth.patroller.cpf_id,
        name: r.name.trim(),
        serviceType: (r.service_type as any) ?? "other",
        primaryNumber: r.primary_number.trim(),
        secondaryNumber: r.secondary_number?.trim() ?? null,
        address: r.address?.trim() ?? null,
        priority: Number(r.priority ?? 100),
        sensitive: r.sensitive === true || r.sensitive === "true" || r.sensitive === "1",
      });
      imported++;
    } catch { skipped++; }
  }
  await logAudit(db, "admin.emergency.imported", auth, { count: imported });
  return c.json({ imported, skipped, errors } satisfies ImportResult);
});

admin.post("/vehicles/import", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ rows: Array<{ registration: string; description?: string; last_odometer?: string | number; status?: string; member_call_sign?: string }> }>();
  const db = getDb(c.env);
  let imported = 0; let skipped = 0; const errors: string[] = [];
  for (const r of body.rows) {
    if (!r.registration?.trim()) { skipped++; continue; }
    try {
      let patrollerId: string | null = null;
      if (r.member_call_sign?.trim()) {
        const member = await db.query.patrollers.findFirst({
          where: and(eq(patrollers.callSign, r.member_call_sign.trim().toUpperCase()), eq(patrollers.cpfId, auth.patroller.cpf_id)),
        });
        patrollerId = member?.id ?? null;
      }
      await db.insert(vehicles).values({
        cpfId: auth.patroller.cpf_id,
        sectorId: auth.patroller.sector_id,
        patrollerId,
        registration: r.registration.trim().toUpperCase(),
        description: r.description?.trim() ?? null,
        lastOdometer: Number(r.last_odometer ?? 0),
        status: (r.status as any) ?? "available",
      });
      imported++;
    } catch (e: any) {
      errors.push(`${r.registration}: ${e?.message ?? "duplicate or invalid"}`);
      skipped++;
    }
  }
  await logAudit(db, "admin.vehicles.imported", auth, { count: imported });
  return c.json({ imported, skipped, errors } satisfies ImportResult);
});

// ── Audit log view (POPIA — payload intentionally omitted from response) ──────
admin.get("/audit-log", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select({
      audit_log: {
        id: auditLog.id,
        action: auditLog.action,
        ip: auditLog.ip,
        deviceId: auditLog.deviceId,
        createdAt: auditLog.createdAt,
      },
      patrollers: {
        callSign: patrollers.callSign,
        name: patrollers.name,
      },
    })
    .from(auditLog)
    .leftJoin(patrollers, eq(auditLog.actorPatrollerId, patrollers.id))
    .where(eq(patrollers.cpfId, auth.patroller.cpf_id))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
  return c.json({ results: rows });
});

// ── Incidents seed (for hotspots) ─────────────────────────
admin.post("/incidents", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ type: string; severity: string; lat: number; lng: number; occurred_at: string; description?: string; sector_id?: string }>();
  const db = getDb(c.env);
  const [row] = await db.insert(incidents).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: body.sector_id ?? auth.patroller.sector_id,
    type: body.type,
    severity: body.severity,
    lat: body.lat,
    lng: body.lng,
    occurredAt: new Date(body.occurred_at),
    description: body.description ?? null,
  }).returning();
  await logAudit(db, "admin.incident.created", auth, { incident_id: row.id });
  return c.json(row);
});
