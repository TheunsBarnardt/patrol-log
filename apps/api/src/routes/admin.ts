// Admin portal CRUD routes.

import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  AppError,
  type DashboardOverview,
  type LiveMapPin,
  type PatrolDetailReport,
  type PatrolSummaryReport,
  type PatrolType,
  type StatsPeriod,
} from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import {
  auditLog,
  devices,
  emergencyServices,
  incidents,
  hotspots,
  livePins,
  nextOfKin,
  patrolBreadcrumbs,
  patrolEscalationEvents,
  patrolMembers,
  patrollers,
  patrols,
  residents,
  sectors,
  vehicles,
} from "../db/schema.js";
import { hashPassword } from "../lib/hashing.js";
import { logAudit } from "../lib/audit.js";
import { assertSectorAccess, scopedSectorId, tenantScope } from "../lib/scope.js";

const EMPTY_HOURS: Record<PatrolType, number> = {
  foot: 0,
  vehicle: 0,
  static: 0,
  sector_monitoring: 0,
  ops: 0,
  responding: 0,
};

function periodStartIso(period: StatsPeriod): string {
  const now = new Date();
  if (period === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (period === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
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

function zeroFilledKmByDay(
  periodStart: string,
  kmByDayMap: Map<string, number>,
  periodEnd?: string,
): { date: string; km: number }[] {
  const start = new Date(periodStart);
  const end = periodEnd ? new Date(periodEnd) : new Date();
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  const out: { date: string; km: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, km: kmByDayMap.get(date) ?? 0 });
  }
  return out;
}

const PATROL_TYPES = new Set<PatrolType>([
  "foot",
  "vehicle",
  "static",
  "sector_monitoring",
  "ops",
  "responding",
]);

function parseReportDate(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("PATROL_INVALID_INPUT", { reason: "date must be YYYY-MM-DD" });
  }
  return value;
}

function parseOptionalPatrolType(value: string | undefined): PatrolType | null {
  if (!value || value === "all") return null;
  if (!PATROL_TYPES.has(value as PatrolType)) {
    throw new AppError("PATROL_INVALID_INPUT", { reason: "invalid patrol type" });
  }
  return value as PatrolType;
}

function durationLabel(hours: number): string {
  if (hours <= 0) return "0:00";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatSectorLabel(code: string | null | undefined, name: string | null | undefined): string {
  if (code && name) return `${code} · ${name}`;
  return code || name || "—";
}

export const admin = new Hono<AppContext>();

// Admin + sector lead + call centre. Patrollers use the mobile app / My details only (no admin API).
admin.use("*", requireAuth(), requireAccessLevel("system_admin", "admin", "sector_lead", "call_centre_agent"));

const STALE_MS = 2 * 60_000;

admin.get("/live-map", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  // Pins stay until stand-down (active patrol only) — no time-based disappearance.
  const rows = await db
    .select({ pin: livePins, patrol: patrols })
    .from(livePins)
    .innerJoin(patrols, eq(patrols.id, livePins.patrolId))
    .where(and(tenantScope(auth, livePins), eq(patrols.state, "active")));

  const now = Date.now();
  const pins: LiveMapPin[] = await Promise.all(
    rows.map(async ({ pin: r, patrol }) => {
      let vehicleRegistration: string | undefined;
      if (patrol.vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, patrol.vehicleId) });
        vehicleRegistration = vehicle?.registration;
      }
      return {
        patrol_id: r.patrolId,
        call_sign: r.callSign,
        patrol_type: patrol.patrolType ?? "foot",
        patrol_vehicle: patrol.vehicleId ?? undefined,
        vehicle_registration: vehicleRegistration,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading ?? undefined,
        speed: r.speed ?? undefined,
        last_update: r.lastSeenAt,
        duration_on_patrol_min: Math.floor((now - new Date(patrol.startTime).getTime()) / 60_000),
        stale: now - new Date(r.lastSeenAt).getTime() > STALE_MS,
      };
    }),
  );

  return c.json({ pins });
});

admin.get("/stats", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const scope = tenantScope(auth, { cpfId: patrols.cpfId, sectorId: patrols.sectorId });
  const [activePatrols, registeredResidents, registeredMembers] = await Promise.all([
    db.select({ id: patrols.id }).from(patrols).where(and(scope, eq(patrols.state, "active"))),
    db.select({ id: residents.id }).from(residents).where(tenantScope(auth, residents)),
    db.select({ id: patrollers.id }).from(patrollers).where(tenantScope(auth, patrollers)),
  ]);
  return c.json({
    active_patrols: activePatrols.length,
    residents: registeredResidents.length,
    members: registeredMembers.length,
  });
});

admin.get("/stats/overview", async (c) => {
  const auth = getAuth(c);
  const rawFrom = c.req.query("from");
  const rawTo = c.req.query("to");
  const patrolType = parseOptionalPatrolType(c.req.query("patrol_type"));
  const rawPeriod = c.req.query("period") ?? "7d";

  let period: StatsPeriod;
  let periodStart: string;
  let periodEnd: string;

  if (rawFrom || rawTo) {
    const from = parseReportDate(rawFrom);
    const to = parseReportDate(rawTo);
    if (from > to) throw new AppError("PATROL_INVALID_INPUT", { reason: "from must be on or before to" });
    period = "custom";
    periodStart = new Date(`${from}T00:00:00.000Z`).toISOString();
    periodEnd = new Date(`${to}T23:59:59.999Z`).toISOString();
  } else {
    period =
      rawPeriod === "today" || rawPeriod === "7d" || rawPeriod === "30d" || rawPeriod === "month"
        ? rawPeriod
        : "7d";
    periodStart = periodStartIso(period);
    periodEnd = new Date().toISOString();
  }

  const fromDb = toSqliteDateTime(periodStart);
  const toDb = toSqliteDateTime(periodEnd);
  const db = getDb(c.env);
  const scope = tenantScope(auth, patrols);

  const sectorRow = scopedSectorId(auth)
    ? await db.query.sectors.findFirst({ where: eq(sectors.id, auth.patroller.sector_id) })
    : null;

  const completedFilters = [
    scope,
    eq(patrols.state, "stood_down"),
    gte(patrols.startTime, fromDb),
    lte(patrols.startTime, toDb),
  ];
  if (patrolType) completedFilters.push(eq(patrols.patrolType, patrolType));

  const activeFilters = [scope, eq(patrols.state, "active")];
  if (patrolType) activeFilters.push(eq(patrols.patrolType, patrolType));

  const [completed, activePatrols] = await Promise.all([
    db.select().from(patrols).where(and(...completedFilters)),
    db.select({ id: patrols.id }).from(patrols).where(and(...activeFilters)),
  ]);

  let totalKm = 0;
  let totalHours = 0;
  const hoursByType: Record<PatrolType, number> = { ...EMPTY_HOURS };
  const kmByDayMap = new Map<string, number>();

  for (const p of completed) {
    const km = p.distanceKm ?? 0;
    const hours = patrolHours(p.startTime, p.endTime);
    totalKm += km;
    totalHours += hours;
    const t = (p.patrolType in hoursByType ? p.patrolType : "foot") as PatrolType;
    hoursByType[t] = round1(hoursByType[t] + hours);
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
    periodEnd,
    patrolType,
    sector: sectorRow
      ? { id: sectorRow.id, code: sectorRow.code ?? null, name: sectorRow.name }
      : null,
    kpis: {
      totalKm,
      totalHours,
      completedPatrols: completed.length,
      activePatrols: activePatrols.length,
      uniqueMembers: members.length,
    },
    hoursByType,
    kmByDay: zeroFilledKmByDay(periodStart, kmByDayMap, periodEnd),
    members,
  };

  return c.json(overview);
});

admin.get("/reports/detail", async (c) => {
  const auth = getAuth(c);
  const from = parseReportDate(c.req.query("from"));
  const to = parseReportDate(c.req.query("to"));
  if (from > to) throw new AppError("PATROL_INVALID_INPUT", { reason: "from must be on or before to" });
  const patrolType = parseOptionalPatrolType(c.req.query("patrol_type"));
  const fromDb = `${from} 00:00:00`;
  const toDb = `${to} 23:59:59`;
  const db = getDb(c.env);
  const scope = tenantScope(auth, patrols);

  const filters = [
    scope,
    gte(patrols.startTime, fromDb),
    lte(patrols.startTime, toDb),
  ];
  if (patrolType) filters.push(eq(patrols.patrolType, patrolType));

  const rows = await db
    .select({
      patrolId: patrols.id,
      callSign: patrollers.callSign,
      name: patrollers.name,
      sectorCode: sectors.code,
      sectorName: sectors.name,
      patrolType: patrols.patrolType,
      startTime: patrols.startTime,
      endTime: patrols.endTime,
      distanceKm: patrols.distanceKm,
      vehicleRegistration: vehicles.registration,
      vehicleDescription: vehicles.description,
    })
    .from(patrols)
    .leftJoin(patrollers, eq(patrollers.id, patrols.primaryPatrollerId))
    .leftJoin(sectors, eq(sectors.id, patrols.sectorId))
    .leftJoin(vehicles, eq(vehicles.id, patrols.vehicleId))
    .where(and(...filters))
    .orderBy(desc(patrols.startTime));

  const patrolIds = rows.map((r) => r.patrolId);
  const joinedByPatrol = new Map<
    string,
    Array<{
      callSign: string;
      name: string;
      startTime: string;
      endTime: string | null;
    }>
  >();

  if (patrolIds.length) {
    const joinedRows = await db
      .select({
        patrolId: patrolMembers.patrolId,
        callSign: patrollers.callSign,
        name: patrollers.name,
        startTime: patrolMembers.startTime,
        endTime: patrolMembers.endTime,
      })
      .from(patrolMembers)
      .innerJoin(patrollers, eq(patrollers.id, patrolMembers.patrollerId))
      .where(and(inArray(patrolMembers.patrolId, patrolIds), eq(patrolMembers.role, "joined")))
      .orderBy(patrollers.callSign);

    for (const j of joinedRows) {
      const list = joinedByPatrol.get(j.patrolId) ?? [];
      list.push({
        callSign: j.callSign,
        name: j.name,
        startTime: j.startTime,
        endTime: j.endTime,
      });
      joinedByPatrol.set(j.patrolId, list);
    }
  }

  const reportRows: PatrolDetailReport["rows"] = [];
  for (const r of rows) {
    const hours = patrolHours(r.startTime, r.endTime);
    const sector = formatSectorLabel(r.sectorCode, r.sectorName);
    const vehicleRegistration = r.vehicleRegistration ?? null;
    const vehicleDescription = r.vehicleDescription ?? null;

    reportRows.push({
      callSign: r.callSign ?? "?",
      name: r.name ?? "Unknown",
      sector,
      role: "primary",
      patrolType: r.patrolType,
      commencedAt: r.startTime,
      stoodDownAt: r.endTime,
      durationHours: hours,
      durationLabel: durationLabel(hours),
      distanceKm: r.distanceKm ?? 0,
      vehicleRegistration,
      vehicleDescription,
    });

    for (const j of joinedByPatrol.get(r.patrolId) ?? []) {
      const jHours = patrolHours(j.startTime, j.endTime ?? r.endTime);
      reportRows.push({
        callSign: j.callSign,
        name: j.name,
        sector,
        role: "joined",
        patrolType: r.patrolType,
        commencedAt: j.startTime,
        stoodDownAt: j.endTime ?? r.endTime,
        durationHours: jHours,
        durationLabel: durationLabel(jHours),
        distanceKm: 0,
        vehicleRegistration,
        vehicleDescription,
      });
    }
  }

  const report: PatrolDetailReport = {
    from,
    to,
    patrolType,
    rows: reportRows,
  };

  return c.json(report);
});

admin.get("/reports/summary", async (c) => {
  const auth = getAuth(c);
  const from = parseReportDate(c.req.query("from"));
  const to = parseReportDate(c.req.query("to"));
  if (from > to) throw new AppError("PATROL_INVALID_INPUT", { reason: "from must be on or before to" });
  const patrolType = parseOptionalPatrolType(c.req.query("patrol_type"));
  const fromDb = `${from} 00:00:00`;
  const toDb = `${to} 23:59:59`;
  const db = getDb(c.env);
  const scope = tenantScope(auth, patrols);

  const filters = [
    scope,
    eq(patrols.state, "stood_down"),
    gte(patrols.startTime, fromDb),
    lte(patrols.startTime, toDb),
  ];
  if (patrolType) filters.push(eq(patrols.patrolType, patrolType));

  const completed = await db
    .select()
    .from(patrols)
    .where(and(...filters));

  const memberAgg = new Map<string, { hours: number; km: number }>();

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
        const cur = memberAgg.get(pid) ?? { hours: 0, km: 0 };
        cur.hours = round1(cur.hours + hours);
        memberAgg.set(pid, cur);
      }
      if (km > 0) {
        const primary = memberAgg.get(p.primaryPatrollerId) ?? { hours: 0, km: 0 };
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
        callSign: p?.callSign ?? "?",
        name: p?.name ?? "Unknown",
        totalKm: agg.km,
        totalHours: agg.hours,
      };
    })
    .sort((a, b) => a.callSign.localeCompare(b.callSign));

  const topHours = [...members]
    .sort((a, b) => b.totalHours - a.totalHours || a.callSign.localeCompare(b.callSign))
    .slice(0, 10);
  const topKm = [...members]
    .sort((a, b) => b.totalKm - a.totalKm || a.callSign.localeCompare(b.callSign))
    .slice(0, 10);

  const report: PatrolSummaryReport = {
    from,
    to,
    patrolType,
    members,
    topHours,
    topKm,
  };

  return c.json(report);
});

admin.get("/residents", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(residents)
    .where(tenantScope(auth, residents))
    .orderBy(residents.name);
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
  const rows = await db
    .select({
      id: patrollers.id,
      callSign: patrollers.callSign,
      name: patrollers.name,
      phone: patrollers.phone,
      address: patrollers.address,
      accessLevel: patrollers.accessLevel,
      status: patrollers.status,
      sectorId: patrollers.sectorId,
      sectorCode: sectors.code,
      sectorName: sectors.name,
      cpfId: patrollers.cpfId,
      createdAt: patrollers.createdAt,
    })
    .from(patrollers)
    .leftJoin(sectors, eq(sectors.id, patrollers.sectorId))
    .where(tenantScope(auth, patrollers))
    .orderBy(patrollers.name);
  return c.json({ results: rows });
});

admin.post("/members", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ call_sign: string; name: string; phone?: string; address?: string; password: string; access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin" | "system_admin"; sector_id?: string }>();
  const db = getDb(c.env);
  const targetSector = body.sector_id ?? auth.patroller.sector_id;
  const canCrossSector =
    auth.patroller.access_level === "system_admin" || auth.patroller.access_level === "admin";
  if (!canCrossSector && targetSector !== auth.patroller.sector_id) {
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
  const body = await c.req.json<Partial<{
    call_sign: string;
    name: string;
    phone: string;
    address: string;
    status: "active" | "inactive" | "suspended";
    access_level: "call_centre_agent" | "patroller" | "sector_lead" | "admin" | "system_admin";
    password: string;
    sector_id: string;
  }>>();
  const db = getDb(c.env);

  const target = await db.query.patrollers.findFirst({ where: eq(patrollers.id, id) });
  if (!target) throw new AppError("MEMBERS_NO_RESULTS");
  if (target.cpfId !== auth.patroller.cpf_id) throw new AppError("STAND_DOWN_UNAUTHORIZED");
  const isSysAdmin = auth.patroller.access_level === "system_admin";
  const canCrossSector = isSysAdmin || auth.patroller.access_level === "admin";
  if (!canCrossSector && target.sectorId !== auth.patroller.sector_id) {
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

  if (body.call_sign !== undefined) {
    if (!isSysAdmin) throw new AppError("ACCESS_FORBIDDEN");
    const callSign = body.call_sign.trim().toUpperCase();
    if (!callSign || callSign.length < 2) throw new AppError("MEMBERS_INVALID_CALL_SIGN");
    if (callSign !== target.callSign) {
      const taken = await db.query.patrollers.findFirst({
        where: and(
          eq(patrollers.cpfId, auth.patroller.cpf_id),
          eq(patrollers.callSign, callSign),
        ),
      });
      if (taken) throw new AppError("MEMBERS_DUPLICATE_CALL_SIGN");
      update.callSign = callSign;
      // Keep live map pins in sync with renamed call sign
      await db
        .update(livePins)
        .set({ callSign })
        .where(and(eq(livePins.cpfId, target.cpfId), eq(livePins.callSign, target.callSign)));
    }
  }

  if (body.password) update.passwordHash = await hashPassword(body.password);
  const [updated] = await db.update(patrollers).set(update).where(eq(patrollers.id, id)).returning();
  await logAudit(db, "admin.member.updated", auth, {
    member_id: id,
    call_sign: updated.callSign,
    call_sign_changed: !!update.callSign,
  });
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
    .where(tenantScope(auth, vehicles))
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
  const rows = await db
    .select({
      patrol: patrols,
      primaryCallSign: patrollers.callSign,
      primaryName: patrollers.name,
    })
    .from(patrols)
    .leftJoin(patrollers, eq(patrollers.id, patrols.primaryPatrollerId))
    .where(tenantScope(auth, patrols))
    .orderBy(desc(patrols.startTime))
    .limit(200);
  return c.json({
    results: rows.map((r) => ({
      ...r.patrol,
      primaryCallSign: r.primaryCallSign,
      primaryName: r.primaryName,
    })),
  });
});

/** system_admin: correct captured / active patrol records */
admin.patch("/patrols/:id", requireAccessLevel("system_admin"), async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{
    patrol_type: PatrolType;
    start_time: string;
    end_time: string | null;
    odometer_start: number | null;
    odometer_end: number | null;
    distance_km: number | null;
    state: "active" | "stood_down";
    reason: "shift_end" | "emergency" | "vehicle_issue" | "personal" | null;
    sars_purpose: string;
    sars_compliant: boolean;
    vehicle_id: string | null;
  }>>();

  const db = getDb(c.env);
  const existing = await db.query.patrols.findFirst({ where: eq(patrols.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("PATROL_NOT_FOUND");
  if (!assertSectorAccess(auth, existing.sectorId)) throw new AppError("ACCESS_FORBIDDEN");

  const update: Partial<typeof patrols.$inferInsert> = {};
  const types: PatrolType[] = ["foot", "vehicle", "static", "sector_monitoring", "ops", "responding"];

  if (body.patrol_type !== undefined) {
    if (!types.includes(body.patrol_type)) throw new AppError("PATROL_INVALID_INPUT");
    update.patrolType = body.patrol_type;
  }
  if (body.start_time !== undefined) {
    const t = Date.parse(body.start_time);
    if (!Number.isFinite(t)) throw new AppError("PATROL_INVALID_INPUT");
    update.startTime = new Date(t).toISOString();
  }
  if (body.end_time !== undefined) {
    if (body.end_time === null || body.end_time === "") {
      update.endTime = null;
    } else {
      const t = Date.parse(body.end_time);
      if (!Number.isFinite(t)) throw new AppError("PATROL_INVALID_INPUT");
      update.endTime = new Date(t).toISOString();
    }
  }
  if (body.odometer_start !== undefined) {
    if (body.odometer_start === null) update.odometerStart = null;
    else {
      const n = Number(body.odometer_start);
      if (!Number.isFinite(n) || n < 0) throw new AppError("PATROL_INVALID_INPUT");
      update.odometerStart = Math.round(n);
    }
  }
  if (body.odometer_end !== undefined) {
    if (body.odometer_end === null) update.odometerEnd = null;
    else {
      const n = Number(body.odometer_end);
      if (!Number.isFinite(n) || n < 0) throw new AppError("PATROL_INVALID_INPUT");
      update.odometerEnd = Math.round(n);
    }
  }
  if (body.distance_km !== undefined) {
    if (body.distance_km === null) update.distanceKm = null;
    else {
      const n = Number(body.distance_km);
      if (!Number.isFinite(n) || n < 0) throw new AppError("PATROL_INVALID_INPUT");
      update.distanceKm = Math.round(n);
    }
  }
  if (body.state !== undefined) {
    if (body.state !== "active" && body.state !== "stood_down") throw new AppError("PATROL_INVALID_INPUT");
    update.state = body.state;
  }
  if (body.reason !== undefined) update.reason = body.reason;
  if (body.sars_purpose !== undefined) update.sarsPurpose = body.sars_purpose.trim() || "CPF sector patrol";
  if (body.sars_compliant !== undefined) update.sarsCompliant = !!body.sars_compliant;
  if (body.vehicle_id !== undefined) update.vehicleId = body.vehicle_id || null;

  // Recompute distance from odometers when both present and distance not explicitly set
  const nextStart = update.odometerStart !== undefined ? update.odometerStart : existing.odometerStart;
  const nextEnd = update.odometerEnd !== undefined ? update.odometerEnd : existing.odometerEnd;
  if (
    body.distance_km === undefined &&
    nextStart != null &&
    nextEnd != null &&
    (body.odometer_start !== undefined || body.odometer_end !== undefined)
  ) {
    if (nextEnd < nextStart) throw new AppError("STAND_DOWN_ODOMETER_END_LESS_THAN_START");
    update.distanceKm = nextEnd - nextStart;
  }

  // Admin correction invalidates the cryptographic seal
  if (Object.keys(update).length > 0) update.recordSealHash = null;

  const nextState = update.state ?? existing.state;
  if (nextState === "stood_down") {
    await db.delete(livePins).where(eq(livePins.patrolId, id));
    if (update.endTime === undefined && existing.endTime == null && body.end_time === undefined) {
      update.endTime = new Date().toISOString();
    }
  }

  const [row] = await db.update(patrols).set(update).where(eq(patrols.id, id)).returning();
  await logAudit(db, "admin.patrol.updated", auth, { patrol_id: id, fields: Object.keys(body) });
  return c.json(row);
});

/** system_admin: permanently delete a patrol (incl. sealed / captured) */
admin.delete("/patrols/:id", requireAccessLevel("system_admin"), async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  const existing = await db.query.patrols.findFirst({ where: eq(patrols.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("PATROL_NOT_FOUND");
  if (!assertSectorAccess(auth, existing.sectorId)) throw new AppError("ACCESS_FORBIDDEN");

  // Explicit cleanup (D1 FK cascade is not always enforced)
  await db.delete(livePins).where(eq(livePins.patrolId, id));
  await db.delete(patrolBreadcrumbs).where(eq(patrolBreadcrumbs.patrolId, id));
  await db.delete(patrolEscalationEvents).where(eq(patrolEscalationEvents.patrolId, id));
  await db.delete(patrolMembers).where(eq(patrolMembers.patrolId, id));
  await db.delete(patrols).where(eq(patrols.id, id));
  await logAudit(db, "admin.patrol.deleted", auth, {
    patrol_id: id,
    state: existing.state,
    sealed: !!existing.recordSealHash,
  });
  return c.json({ ok: true });
});

admin.get("/devices", requireAccessLevel("system_admin"), async (c) => {
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

admin.post("/devices/:id/revoke", requireAccessLevel("system_admin"), async (c) => {
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

admin.get("/audit-log", requireAccessLevel("system_admin"), async (c) => {
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

// ── Managed hotspots (rating + km diameter + description) ──

admin.get("/hotspots", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(hotspots)
    .where(tenantScope(auth, hotspots))
    .orderBy(desc(hotspots.createdAt));
  return c.json({ results: rows });
});

admin.post("/hotspots", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{
    title: string;
    description?: string;
    rating: number;
    diameter_km: number;
    lat: number;
    lng: number;
    sector_id?: string;
  }>();
  const title = body.title?.trim();
  const rating = Number(body.rating);
  const diameterKm = Number(body.diameter_km);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (
    !title ||
    !Number.isFinite(rating) ||
    rating < 1 ||
    rating > 5 ||
    !Number.isFinite(diameterKm) ||
    diameterKm <= 0 ||
    diameterKm > 50 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new AppError("HOTSPOTS_INVALID_INPUT");
  }
  const sectorId = body.sector_id ?? auth.patroller.sector_id;
  if (!assertSectorAccess(auth, sectorId)) throw new AppError("STAND_DOWN_UNAUTHORIZED");

  const db = getDb(c.env);
  const [row] = await db
    .insert(hotspots)
    .values({
      cpfId: auth.patroller.cpf_id,
      sectorId,
      title,
      description: body.description?.trim() ?? "",
      rating: Math.round(rating),
      diameterKm,
      lat,
      lng,
    })
    .returning();
  await logAudit(db, "admin.hotspot.created", auth, { hotspot_id: row.id });
  return c.json(row);
});

admin.patch("/hotspots/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{
    title: string;
    description: string;
    rating: number;
    diameter_km: number;
    lat: number;
    lng: number;
  }>>();
  const db = getDb(c.env);
  const existing = await db.query.hotspots.findFirst({ where: eq(hotspots.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("HOTSPOTS_NOT_FOUND");
  if (!assertSectorAccess(auth, existing.sectorId)) throw new AppError("STAND_DOWN_UNAUTHORIZED");

  const update: Partial<typeof hotspots.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) throw new AppError("HOTSPOTS_INVALID_INPUT");
    update.title = t;
  }
  if (body.description !== undefined) update.description = body.description.trim();
  if (body.rating !== undefined) {
    const rating = Number(body.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new AppError("HOTSPOTS_INVALID_INPUT");
    update.rating = Math.round(rating);
  }
  if (body.diameter_km !== undefined) {
    const d = Number(body.diameter_km);
    if (!Number.isFinite(d) || d <= 0 || d > 50) throw new AppError("HOTSPOTS_INVALID_INPUT");
    update.diameterKm = d;
  }
  if (body.lat !== undefined) {
    const lat = Number(body.lat);
    if (!Number.isFinite(lat)) throw new AppError("HOTSPOTS_INVALID_INPUT");
    update.lat = lat;
  }
  if (body.lng !== undefined) {
    const lng = Number(body.lng);
    if (!Number.isFinite(lng)) throw new AppError("HOTSPOTS_INVALID_INPUT");
    update.lng = lng;
  }

  const [row] = await db.update(hotspots).set(update).where(eq(hotspots.id, id)).returning();
  await logAudit(db, "admin.hotspot.updated", auth, { hotspot_id: id });
  return c.json(row);
});

admin.delete("/hotspots/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  const existing = await db.query.hotspots.findFirst({ where: eq(hotspots.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("HOTSPOTS_NOT_FOUND");
  if (!assertSectorAccess(auth, existing.sectorId)) throw new AppError("STAND_DOWN_UNAUTHORIZED");
  await db.delete(hotspots).where(eq(hotspots.id, id));
  await logAudit(db, "admin.hotspot.deleted", auth, { hotspot_id: id });
  return c.json({ ok: true });
});
