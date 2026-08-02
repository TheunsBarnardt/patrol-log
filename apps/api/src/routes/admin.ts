// Admin portal CRUD routes.

import { Hono } from "hono";
import { and, desc, eq, gte, gt, inArray, sql } from "drizzle-orm";
import { AppError, type DashboardOverview, type LiveMapPin, type StatsPeriod } from "@patrol-log/shared";
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
  patrolMembers,
  patrollers,
  patrols,
  residents,
  vehicles,
} from "../db/schema.js";
import { hashPassword } from "../lib/hashing.js";
import { logAudit } from "../lib/audit.js";

function periodStartIso(period: StatsPeriod): string {
  const now = new Date();
  if (period === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  const days = period === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** SQLite `datetime('now')` style for lexicographic compare with stored start_time. */
function toSqliteDateTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function parseDbTime(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z");
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : new Date(value).getTime();
}

function patrolHours(startTime: string, endTime: string | null): number {
  if (!endTime) return 0;
  const ms = parseDbTime(endTime) - parseDbTime(startTime);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dateKeyUtc(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function zeroFilledKmByDay(periodStart: string, kmByDayMap: Map<string, number>): { date: string; km: number }[] {
  const start = new Date(periodStart);
  const end = new Date();
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  const out: { date: string; km: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, km: kmByDayMap.get(date) ?? 0 });
  }
  return out;
}

export const admin = new Hono<AppContext>();

// Admin + sector lead + call centre. Patrollers use the mobile app / My details only (no admin API).
admin.use("*", requireAuth(), requireAccessLevel("admin", "sector_lead", "call_centre_agent"));

const STALE_MS = 2 * 60_000;
const WINDOW_MS = 30 * 60_000;

admin.get("/live-map", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const rows = await db
    .select()
    .from(livePins)
    .where(and(eq(livePins.cpfId, auth.patroller.cpf_id), gt(livePins.lastSeenAt, since)));

  const now = Date.now();
  const pins: LiveMapPin[] = await Promise.all(
    rows.map(async (r) => {
      const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, r.patrolId) });
      let vehicleRegistration: string | undefined;
      if (patrol?.vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, patrol.vehicleId) });
        vehicleRegistration = vehicle?.registration;
      }
      return {
        patrol_id: r.patrolId,
        call_sign: r.callSign,
        patrol_type: patrol?.patrolType ?? "foot",
        patrol_vehicle: patrol?.vehicleId ?? undefined,
        vehicle_registration: vehicleRegistration,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading ?? undefined,
        speed: r.speed ?? undefined,
        last_update: r.lastSeenAt,
        duration_on_patrol_min: patrol ? Math.floor((now - new Date(patrol.startTime).getTime()) / 60_000) : 0,
        stale: now - new Date(r.lastSeenAt).getTime() > STALE_MS,
      };
    }),
  );

  return c.json({ pins });
});

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

admin.get("/stats/overview", async (c) => {
  const auth = getAuth(c);
  const rawPeriod = c.req.query("period") ?? "7d";
  const period: StatsPeriod =
    rawPeriod === "today" || rawPeriod === "7d" || rawPeriod === "30d" ? rawPeriod : "7d";
  const periodStart = periodStartIso(period);
  const periodStartDb = toSqliteDateTime(periodStart);
  const db = getDb(c.env);
  const cpfId = auth.patroller.cpf_id;

  const [completed, activePatrols] = await Promise.all([
    db
      .select()
      .from(patrols)
      .where(
        and(
          eq(patrols.cpfId, cpfId),
          eq(patrols.state, "stood_down"),
          gte(patrols.startTime, periodStartDb),
        ),
      ),
    db
      .select({ id: patrols.id })
      .from(patrols)
      .where(and(eq(patrols.cpfId, cpfId), eq(patrols.state, "active"))),
  ]);

  let totalKm = 0;
  let totalHours = 0;
  const hoursByType = { foot: 0, vehicle: 0, static: 0 };
  const kmByDayMap = new Map<string, number>();

  for (const p of completed) {
    const km = p.distanceKm ?? 0;
    const hours = patrolHours(p.startTime, p.endTime);
    totalKm += km;
    totalHours += hours;
    hoursByType[p.patrolType] = round1(hoursByType[p.patrolType] + hours);
    if (km > 0) {
      const day = dateKeyUtc(p.startTime);
      kmByDayMap.set(day, (kmByDayMap.get(day) ?? 0) + km);
    }
  }
  totalHours = round1(totalHours);

  const memberAgg = new Map<
    string,
    { patrolCount: number; hours: number; km: number }
  >();

  if (completed.length) {
    const patrolIds = completed.map((p) => p.id);
    const memberships = await db
      .select({
        patrolId: patrolMembers.patrolId,
        patrollerId: patrolMembers.patrollerId,
      })
      .from(patrolMembers)
      .where(inArray(patrolMembers.patrolId, patrolIds));

    const byPatrol = new Map<string, string[]>();
    for (const m of memberships) {
      const list = byPatrol.get(m.patrolId) ?? [];
      list.push(m.patrollerId);
      byPatrol.set(m.patrolId, list);
    }

    for (const p of completed) {
      const hours = patrolHours(p.startTime, p.endTime);
      const km = p.distanceKm ?? 0;
      let memberIds = byPatrol.get(p.id) ?? [];
      if (!memberIds.includes(p.primaryPatrollerId)) {
        memberIds = [...memberIds, p.primaryPatrollerId];
      }
      for (const pid of memberIds) {
        const cur = memberAgg.get(pid) ?? { patrolCount: 0, hours: 0, km: 0 };
        cur.patrolCount += 1;
        cur.hours = round1(cur.hours + hours);
        memberAgg.set(pid, cur);
      }
      if (km > 0) {
        const primary = memberAgg.get(p.primaryPatrollerId) ?? {
          patrolCount: 0,
          hours: 0,
          km: 0,
        };
        primary.km += km;
        memberAgg.set(p.primaryPatrollerId, primary);
      }
    }
  }

  const memberIds = [...memberAgg.keys()];
  const patrollerRows = memberIds.length
    ? await db
        .select({
          id: patrollers.id,
          callSign: patrollers.callSign,
          name: patrollers.name,
        })
        .from(patrollers)
        .where(inArray(patrollers.id, memberIds))
    : [];
  const patrollerMap = new Map(patrollerRows.map((r) => [r.id, r]));

  const members = memberIds
    .map((id) => {
      const agg = memberAgg.get(id)!;
      const p = patrollerMap.get(id);
      return {
        patrollerId: id,
        callSign: p?.callSign ?? "?",
        name: p?.name ?? "Unknown",
        patrolCount: agg.patrolCount,
        hours: agg.hours,
        km: agg.km,
      };
    })
    .sort((a, b) => b.hours - a.hours || b.km - a.km || a.callSign.localeCompare(b.callSign));

  const overview: DashboardOverview = {
    period,
    periodStart,
    kpis: {
      totalKm,
      totalHours,
      completedPatrols: completed.length,
      activePatrols: activePatrols.length,
      uniqueMembers: members.length,
    },
    hoursByType,
    kmByDay: zeroFilledKmByDay(periodStart, kmByDayMap),
    members,
  };

  return c.json(overview);
});

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
    verifiedAt: new Date().toISOString(),
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

admin.get("/patrols", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db.select().from(patrols).where(eq(patrols.cpfId, auth.patroller.cpf_id)).orderBy(desc(patrols.startTime)).limit(200);
  return c.json({ results: rows });
});

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
    occurredAt: new Date(body.occurred_at).toISOString(),
    description: body.description ?? null,
  }).returning();
  await logAudit(db, "admin.incident.created", auth, { incident_id: row.id });
  return c.json(row);
});
