// FDL: blueprints/workflow/commence-patrol.blueprint.yaml
// FDL: blueprints/workflow/stand-down-patrol.blueprint.yaml

import { Hono } from "hono";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  AppError,
  patrolTypeRequiresVehicle,
  type AddPatrolMembersRequest,
  type CommencePatrolRequest,
  type PatrollerStats,
  type StandDownRequest,
  type StatsPeriod,
} from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { getAuth, requireAuth, requireAccessLevel } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import {
  livePins,
  patrolMembers,
  patrollers,
  patrols,
  vehicles,
} from "../db/schema.js";
import { isGeoSarsCompliant, sealRecord } from "../lib/geo.js";
import { logAudit } from "../lib/audit.js";

export const patrolRoutes = new Hono<AppContext>();

function periodStartIso(period: StatsPeriod): string | null {
  if (period === "all") return null;
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

async function resolveJoinablePatrollers(
  db: ReturnType<typeof getDb>,
  auth: ReturnType<typeof getAuth>,
  callSigns: string[],
) {
  const joinedCallSigns = callSigns.map((s) => s.toUpperCase().trim()).filter(Boolean);
  if (!joinedCallSigns.length) return [] as Array<typeof patrollers.$inferSelect>;

  let joined = await db
    .select()
    .from(patrollers)
    .where(
      and(
        eq(patrollers.cpfId, auth.patroller.cpf_id),
        eq(patrollers.sectorId, auth.patroller.sector_id),
      ),
    );
  joined = joined.filter((p) => joinedCallSigns.includes(p.callSign));
  if (joined.length !== joinedCallSigns.length) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");

  for (const jp of joined) {
    if (jp.status !== "active") throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
    if (jp.id === auth.patroller.patroller_id) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
    const jpActive = await db.query.patrolMembers.findFirst({
      where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, jp.id), isNull(pm.endTime)),
    });
    if (jpActive) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
  }
  return joined;
}

patrolRoutes.post("/commence", requireAuth(), requireAccessLevel("patroller", "sector_lead", "admin", "system_admin", "call_centre_agent"), async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<CommencePatrolRequest>().catch(() => null);
  if (!body) throw new AppError("COMMENCE_INVALID_PATROL_TYPE");

  const allowedTypes = ["foot", "vehicle", "static", "sector_monitoring", "ops", "responding"];
  if (!allowedTypes.includes(body.patrol_type)) {
    throw new AppError("COMMENCE_INVALID_PATROL_TYPE");
  }

  const db = getDb(c.env);

  if (patrolTypeRequiresVehicle(body.patrol_type) && !body.patrol_vehicle) {
    throw new AppError("COMMENCE_VEHICLE_REQUIRED");
  }

  const myActive = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) =>
      and(eq(pm.patrollerId, auth.patroller.patroller_id), isNull(pm.endTime)),
  });
  if (myActive) throw new AppError("COMMENCE_ALREADY_ON_PATROL");

  let vehicle: typeof vehicles.$inferSelect | undefined;
  let odometerStart: number | null = null;
  if (body.patrol_vehicle) {
    vehicle = await db.query.vehicles.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, body.patrol_vehicle!), eq(v.cpfId, auth.patroller.cpf_id)),
    });
    if (!vehicle) throw new AppError("COMMENCE_INVALID_VEHICLE");

    const vehicleActive = await db.query.patrols.findFirst({
      where: (p, { and, eq }) => and(eq(p.vehicleId, vehicle!.id), eq(p.state, "active")),
    });
    if (vehicleActive) throw new AppError("COMMENCE_VEHICLE_IN_USE");

    const startOdo = body.odometer_start;
    if (startOdo != null) {
      if (!Number.isFinite(startOdo) || startOdo < 0 || startOdo < vehicle.lastOdometer) {
        throw new AppError("COMMENCE_ODOMETER_START_INVALID");
      }
      odometerStart = Math.round(startOdo);
    }
  }

  const joined = await resolveJoinablePatrollers(db, auth, body.joined_patroller_call_signs ?? []);

  const sarsCompliant =
    isGeoSarsCompliant(body.start_location) &&
    (!patrolTypeRequiresVehicle(body.patrol_type) || odometerStart != null);

  const [created] = await db.insert(patrols).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: auth.patroller.sector_id,
    primaryPatrollerId: auth.patroller.patroller_id,
    patrolType: body.patrol_type,
    vehicleId: vehicle?.id,
    odometerStart,
    startLat: body.start_location?.lat ?? null,
    startLng: body.start_location?.lng ?? null,
    startAccuracyM: body.start_location?.accuracy_m ?? null,
    sarsCompliant,
    state: "active",
  }).returning();

  await db.insert(patrolMembers).values({
    patrolId: created.id,
    patrollerId: auth.patroller.patroller_id,
    role: "primary",
  });
  for (const jp of joined) {
    await db.insert(patrolMembers).values({
      patrolId: created.id,
      patrollerId: jp.id,
      role: "joined",
    });
  }

  await logAudit(db, "patrol.commenced", auth, { patrol_id: created.id, patrol_type: created.patrolType, vehicle_id: created.vehicleId });

  return c.json(await hydrateActivePatrol(db, created.id, auth.patroller.patroller_id));
});

patrolRoutes.get("/active/me", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const membership = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, auth.patroller.patroller_id), isNull(pm.endTime)),
  });
  if (!membership) return c.json(null);
  return c.json(await hydrateActivePatrol(db, membership.patrolId, auth.patroller.patroller_id));
});

/** Active patrols in the caller's sector that they can join as a passenger. */
patrolRoutes.get("/active", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const myId = auth.patroller.patroller_id;

  const myActive = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, myId), isNull(pm.endTime)),
  });
  if (myActive) return c.json({ results: [] });

  const active = await db
    .select({
      patrolId: patrols.id,
      patrolType: patrols.patrolType,
      startTime: patrols.startTime,
      primaryId: patrols.primaryPatrollerId,
      primaryCallSign: patrollers.callSign,
      primaryName: patrollers.name,
      vehicleRegistration: vehicles.registration,
    })
    .from(patrols)
    .innerJoin(patrollers, eq(patrollers.id, patrols.primaryPatrollerId))
    .leftJoin(vehicles, eq(vehicles.id, patrols.vehicleId))
    .where(
      and(
        eq(patrols.cpfId, auth.patroller.cpf_id),
        eq(patrols.sectorId, auth.patroller.sector_id),
        eq(patrols.state, "active"),
      ),
    );

  const results = [];
  for (const row of active) {
    if (row.primaryId === myId) continue;
    const members = await db.query.patrolMembers.findMany({
      where: (pm, { eq }) => eq(pm.patrolId, row.patrolId),
    });
    const alreadyOn = members.some((m) => m.patrollerId === myId && !m.endTime);
    if (alreadyOn) continue;
    results.push({
      patrol_id: row.patrolId,
      primary_patroller_call_sign: row.primaryCallSign,
      primary_patroller_name: row.primaryName,
      patrol_type: row.patrolType,
      vehicle_registration: row.vehicleRegistration ?? null,
      start_time: row.startTime,
      joined_count: members.filter((m) => m.role === "joined" && !m.endTime).length,
    });
  }

  results.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));
  return c.json({ results });
});

patrolRoutes.post("/:patrol_id/join", requireAuth(), requireAccessLevel("patroller", "sector_lead", "admin", "system_admin", "call_centre_agent"), async (c) => {
  const auth = getAuth(c);
  const patrolId = c.req.param("patrol_id");
  const db = getDb(c.env);
  const myId = auth.patroller.patroller_id;

  const myActive = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, myId), isNull(pm.endTime)),
  });
  if (myActive) throw new AppError("COMMENCE_ALREADY_ON_PATROL");

  const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!patrol || patrol.state !== "active") throw new AppError("JOIN_PATROL_UNAVAILABLE");
  if (patrol.cpfId !== auth.patroller.cpf_id || patrol.sectorId !== auth.patroller.sector_id) {
    throw new AppError("JOIN_PATROL_UNAVAILABLE");
  }
  if (patrol.primaryPatrollerId === myId) throw new AppError("JOIN_PATROL_ALREADY_MEMBER");

  const existing = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq }) => and(eq(pm.patrolId, patrolId), eq(pm.patrollerId, myId)),
  });
  if (existing && !existing.endTime) throw new AppError("JOIN_PATROL_ALREADY_MEMBER");

  if (existing?.endTime) {
    await db.update(patrolMembers).set({
      role: "joined",
      startTime: new Date().toISOString(),
      endTime: null,
      endLat: null,
      endLng: null,
    }).where(and(eq(patrolMembers.patrolId, patrolId), eq(patrolMembers.patrollerId, myId)));
  } else {
    await db.insert(patrolMembers).values({
      patrolId,
      patrollerId: myId,
      role: "joined",
    });
  }

  await logAudit(db, "patrol.joined", auth, { patrol_id: patrolId });
  return c.json(await hydrateActivePatrol(db, patrolId, myId));
});

patrolRoutes.get("/stats/me", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const rawPeriod = c.req.query("period") ?? "month";
  const period: StatsPeriod =
    rawPeriod === "today" || rawPeriod === "7d" || rawPeriod === "30d" || rawPeriod === "month" || rawPeriod === "all"
      ? rawPeriod
      : "month";
  const periodStart = periodStartIso(period);
  const db = getDb(c.env);
  const pid = auth.patroller.patroller_id;

  const memberships = await db
    .select({ patrolId: patrolMembers.patrolId })
    .from(patrolMembers)
    .where(eq(patrolMembers.patrollerId, pid));
  const patrolIds = memberships.map((m) => m.patrolId);
  if (!patrolIds.length) {
    const empty: PatrollerStats = {
      period,
      periodStart: periodStart ?? new Date(0).toISOString(),
      totalKm: 0,
      totalHours: 0,
      completedPatrols: 0,
    };
    return c.json(empty);
  }

  const filters = [
    inArray(patrols.id, patrolIds),
    eq(patrols.state, "stood_down"),
  ];
  if (periodStart) {
    filters.push(gte(patrols.startTime, toSqliteDateTime(periodStart)));
  }

  const completed = await db
    .select()
    .from(patrols)
    .where(and(...filters));

  let totalKm = 0;
  let totalHours = 0;
  for (const p of completed) {
    totalHours += patrolHours(p.startTime, p.endTime);
    if (p.primaryPatrollerId === pid) totalKm += p.distanceKm ?? 0;
  }

  const stats: PatrollerStats = {
    period,
    periodStart: periodStart ?? new Date(0).toISOString(),
    totalKm,
    totalHours: Math.round(totalHours * 10) / 10,
    completedPatrols: completed.length,
  };
  return c.json(stats);
});

patrolRoutes.post("/:patrol_id/members", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const patrolId = c.req.param("patrol_id");
  const body = await c.req.json<AddPatrolMembersRequest>().catch(() => null);
  if (!body?.call_signs?.length) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");

  const db = getDb(c.env);
  const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!patrol || patrol.state !== "active") throw new AppError("STAND_DOWN_NOT_ON_PATROL");
  if (patrol.primaryPatrollerId !== auth.patroller.patroller_id) {
    throw new AppError("STAND_DOWN_UNAUTHORIZED");
  }

  const joined = await resolveJoinablePatrollers(db, auth, body.call_signs);
  for (const jp of joined) {
    const existing = await db.query.patrolMembers.findFirst({
      where: (pm, { and, eq }) => and(eq(pm.patrolId, patrolId), eq(pm.patrollerId, jp.id)),
    });
    if (existing && !existing.endTime) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
    if (existing?.endTime) {
      await db.update(patrolMembers).set({
        startTime: new Date().toISOString(),
        endTime: null,
        endLat: null,
        endLng: null,
      }).where(
        and(eq(patrolMembers.patrolId, patrolId), eq(patrolMembers.patrollerId, jp.id)),
      );
    } else if (!existing) {
      await db.insert(patrolMembers).values({
        patrolId,
        patrollerId: jp.id,
        role: "joined",
      });
    }
  }

  await logAudit(db, "patrol.membersadded", auth, {
    patrol_id: patrolId,
    call_signs: joined.map((j) => j.callSign),
  });

  return c.json(await hydrateActivePatrol(db, patrolId, auth.patroller.patroller_id));
});

patrolRoutes.post("/:patrol_id/stand-down", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const patrolId = c.req.param("patrol_id");
  const body = await c.req.json<StandDownRequest>().catch(() => ({} as StandDownRequest));

  const db = getDb(c.env);
  const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!patrol) throw new AppError("STAND_DOWN_NOT_ON_PATROL");

  const member = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq }) => and(eq(pm.patrolId, patrolId), eq(pm.patrollerId, auth.patroller.patroller_id)),
  });
  const isElevated =
    auth.patroller.access_level === "sector_lead" ||
    auth.patroller.access_level === "admin" ||
    auth.patroller.access_level === "system_admin" ||
    auth.patroller.access_level === "call_centre_agent";
  if (!member && !isElevated) throw new AppError("STAND_DOWN_NOT_ON_PATROL");

  if (member?.endTime) throw new AppError("STAND_DOWN_ALREADY_STOOD_DOWN");
  if (!member && patrol.state === "stood_down") throw new AppError("STAND_DOWN_ALREADY_STOOD_DOWN");

  const now = new Date().toISOString();
  const actorRole: "primary" | "joined" = member?.role ?? "primary";

  if (actorRole === "joined") {
    await db.update(patrolMembers).set({
      endTime: now,
      endLat: body.end_location?.lat ?? null,
      endLng: body.end_location?.lng ?? null,
    }).where(and(eq(patrolMembers.patrolId, patrolId), eq(patrolMembers.patrollerId, auth.patroller.patroller_id)));
    await logAudit(db, "patrol.joinedstooddown", auth, { patrol_id: patrolId });
    return c.json({ patrol_id: patrolId, role: "joined", end_time: now });
  }

  let distanceKm: number | null = null;
  let odometerEnd: number | null = null;

  if (patrol.vehicleId) {
    if (patrol.odometerStart != null) {
      if (body.odometer_end == null || !Number.isFinite(body.odometer_end)) {
        throw new AppError("STAND_DOWN_ODOMETER_END_REQUIRED");
      }
      if (body.odometer_end < patrol.odometerStart) {
        throw new AppError("STAND_DOWN_ODOMETER_END_LESS_THAN_START");
      }
      odometerEnd = Math.round(body.odometer_end);
      distanceKm = Math.max(0, odometerEnd - patrol.odometerStart);
    } else {
      if (body.distance_km == null || !Number.isFinite(body.distance_km) || body.distance_km < 0) {
        throw new AppError("STAND_DOWN_DISTANCE_REQUIRED");
      }
      distanceKm = Math.round(body.distance_km);
    }
  }

  const sarsCompliant = patrol.sarsCompliant && isGeoSarsCompliant(body.end_location);
  const seal = await sealRecord({
    patrol_id: patrol.id,
    primary_patroller_id: patrol.primaryPatrollerId,
    patrol_type: patrol.patrolType,
    vehicle_id: patrol.vehicleId,
    odometer_start: patrol.odometerStart,
    odometer_end: odometerEnd,
    distance_km: distanceKm,
    start_time: patrol.startTime,
    end_time: now,
    start_location: { lat: patrol.startLat, lng: patrol.startLng, accuracy_m: patrol.startAccuracyM },
    end_location: body.end_location ?? null,
    sars_purpose: patrol.sarsPurpose,
    sars_compliant: sarsCompliant,
    reason: body.reason ?? null,
  });

  await db.update(patrols).set({
    state: "stood_down",
    endTime: now,
    endLat: body.end_location?.lat ?? null,
    endLng: body.end_location?.lng ?? null,
    endAccuracyM: body.end_location?.accuracy_m ?? null,
    odometerEnd,
    distanceKm,
    reason: body.reason ?? null,
    sarsCompliant,
    recordSealHash: seal,
  }).where(eq(patrols.id, patrolId));

  if (patrol.vehicleId && odometerEnd != null) {
    await db.update(vehicles).set({ lastOdometer: odometerEnd }).where(eq(vehicles.id, patrol.vehicleId));
  }

  await db.update(patrolMembers).set({ endTime: now }).where(
    and(eq(patrolMembers.patrolId, patrolId), isNull(patrolMembers.endTime)),
  );

  await db.delete(livePins).where(eq(livePins.patrolId, patrolId));

  await logAudit(db, "patrol.stooddown", auth, { patrol_id: patrolId, distance_km: distanceKm, sars_compliant: sarsCompliant });

  let handoff: { new_patrol_id: string; new_primary_call_sign: string } | undefined;
  if (body.handoff?.new_primary_call_sign) {
    const newPrimary = await db.query.patrollers.findFirst({
      where: (p, { and, eq }) => and(eq(p.callSign, body.handoff!.new_primary_call_sign.toUpperCase().trim()), eq(p.cpfId, auth.patroller.cpf_id)),
    });
    if (!newPrimary || newPrimary.status !== "active") throw new AppError("STAND_DOWN_HANDOFF_NEW_PRIMARY_INVALID");
    if (!["patroller", "sector_lead", "admin"].includes(newPrimary.accessLevel)) throw new AppError("STAND_DOWN_HANDOFF_NEW_PRIMARY_INVALID");

    const wasOnPatrol = await db.query.patrolMembers.findFirst({
      where: (pm, { and, eq }) => and(eq(pm.patrolId, patrolId), eq(pm.patrollerId, newPrimary.id)),
    });
    if (!wasOnPatrol) throw new AppError("STAND_DOWN_HANDOFF_NEW_PRIMARY_INVALID");

    const [successor] = await db.insert(patrols).values({
      cpfId: auth.patroller.cpf_id,
      sectorId: auth.patroller.sector_id,
      primaryPatrollerId: newPrimary.id,
      patrolType: patrol.patrolType,
      vehicleId: body.handoff.continue_vehicle ? patrol.vehicleId : null,
      odometerStart: body.handoff.continue_vehicle ? odometerEnd : null,
      sarsCompliant: sarsCompliant,
      state: "active",
    }).returning();

    await db.insert(patrolMembers).values({ patrolId: successor.id, patrollerId: newPrimary.id, role: "primary" });

    handoff = { new_patrol_id: successor.id, new_primary_call_sign: newPrimary.callSign };
    await logAudit(db, "patrol.handedoff", auth, { old_patrol_id: patrolId, new_patrol_id: successor.id, new_primary_call_sign: newPrimary.callSign });
  }

  return c.json({
    patrol_id: patrolId,
    end_time: now,
    distance_km: distanceKm,
    sars_compliant: sarsCompliant,
    record_seal_hash: seal,
    handoff,
  });
});

// ── Helpers ─────────────────────────────────────────────
async function hydrateActivePatrol(
  db: ReturnType<typeof getDb>,
  patrolId: string,
  viewerPatrollerId: string,
) {
  const p = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!p) throw new AppError("STAND_DOWN_NOT_ON_PATROL");
  const members = await db.query.patrolMembers.findMany({
    where: (pm, { eq }) => eq(pm.patrolId, patrolId),
  });
  const primary = members.find((m) => m.role === "primary");
  const primaryP = primary ? await db.query.patrollers.findFirst({ where: eq(patrollers.id, primary.patrollerId) }) : null;
  const viewer = members.find((m) => m.patrollerId === viewerPatrollerId);
  const joinedMembers = members.filter((m) => m.role === "joined");
  const joinedFull = await Promise.all(
    joinedMembers.map(async (jm) => {
      const jp = await db.query.patrollers.findFirst({ where: eq(patrollers.id, jm.patrollerId) });
      return {
        call_sign: jp?.callSign ?? "",
        name: jp?.name ?? "",
        start_time: jm.startTime,
        end_time: jm.endTime ?? undefined,
      };
    }),
  );
  return {
    patrol_id: p.id,
    primary_patroller_call_sign: primaryP?.callSign ?? "",
    joined_patrollers: joinedFull,
    patrol_type: p.patrolType,
    patrol_vehicle: p.vehicleId ?? undefined,
    odometer_start: p.odometerStart ?? undefined,
    start_time: p.startTime,
    start_location:
      p.startLat != null && p.startLng != null && p.startAccuracyM != null
        ? { lat: p.startLat, lng: p.startLng, accuracy_m: p.startAccuracyM, captured_at: p.startTime }
        : undefined,
    sars_compliant: p.sarsCompliant,
    state: p.state,
    my_role: (viewer?.role ?? (p.primaryPatrollerId === viewerPatrollerId ? "primary" : "joined")) as "primary" | "joined",
  };
}
