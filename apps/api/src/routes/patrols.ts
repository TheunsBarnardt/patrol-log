// FDL: blueprints/workflow/commence-patrol.blueprint.yaml
// FDL: blueprints/workflow/stand-down-patrol.blueprint.yaml

import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import {
  AppError,
  type CommencePatrolRequest,
  type StandDownRequest,
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

// ── Commence ────────────────────────────────────────────
patrolRoutes.post("/commence", requireAuth(), requireAccessLevel("patroller", "sector_lead", "admin"), async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<CommencePatrolRequest>().catch(() => null);
  if (!body) throw new AppError("COMMENCE_INVALID_PATROL_TYPE");

  // Priority 2 — valid patrol type
  if (!["foot", "vehicle", "static"].includes(body.patrol_type)) {
    throw new AppError("COMMENCE_INVALID_PATROL_TYPE");
  }

  const db = getDb(c.env);

  // Priority 3 — vehicle required when patrol_type === "vehicle"
  if (body.patrol_type === "vehicle" && !body.patrol_vehicle) {
    throw new AppError("COMMENCE_VEHICLE_REQUIRED");
  }

  // Priority 4 — primary already on an active patrol
  const myActive = await db.query.patrols.findFirst({
    where: (p, { and, eq }) => and(eq(p.primaryPatrollerId, auth.patroller.patroller_id), eq(p.state, "active")),
  });
  if (myActive) throw new AppError("COMMENCE_ALREADY_ON_PATROL");

  // Priorities 5/6/7 — vehicle validation (only when vehicle patrol)
  let vehicle: typeof vehicles.$inferSelect | undefined;
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
    if (startOdo == null || startOdo < 0 || startOdo < vehicle.lastOdometer) {
      throw new AppError("COMMENCE_ODOMETER_START_INVALID");
    }
  }

  // Priority 8 — joined patrollers availability (simple check: all exist, active, not on another patrol)
  const joinedCallSigns = (body.joined_patroller_call_signs ?? []).map((s) => s.toUpperCase().trim()).filter(Boolean);
  let joined: Array<typeof patrollers.$inferSelect> = [];
  if (joinedCallSigns.length > 0) {
    joined = await db
      .select()
      .from(patrollers)
      .where(eq(patrollers.cpfId, auth.patroller.cpf_id));
    joined = joined.filter((p) => joinedCallSigns.includes(p.callSign));
    if (joined.length !== joinedCallSigns.length) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");

    for (const jp of joined) {
      if (jp.status !== "active") throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
      const jpActive = await db.query.patrolMembers.findFirst({
        where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, jp.id), isNull(pm.endTime)),
      });
      if (jpActive) throw new AppError("COMMENCE_JOINED_PATROLLER_UNAVAILABLE");
    }
  }

  // Priority 10 — create the patrol
  const sarsCompliant = isGeoSarsCompliant(body.start_location) && (body.patrol_type !== "vehicle" || body.odometer_start != null);

  const [created] = await db.insert(patrols).values({
    cpfId: auth.patroller.cpf_id,
    sectorId: auth.patroller.sector_id,
    primaryPatrollerId: auth.patroller.patroller_id,
    patrolType: body.patrol_type,
    vehicleId: vehicle?.id,
    odometerStart: body.odometer_start ?? null,
    startLat: body.start_location?.lat ?? null,
    startLng: body.start_location?.lng ?? null,
    startAccuracyM: body.start_location?.accuracy_m ?? null,
    sarsCompliant,
    state: "active",
  }).returning();

  // Primary is a patrol_member too, for uniform stand-down logic
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

  return c.json(await hydrateActivePatrol(db, created.id));
});

// ── Active patrol (for my session) ──────────────────────
patrolRoutes.get("/active/me", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const membership = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, auth.patroller.patroller_id), isNull(pm.endTime)),
  });
  if (!membership) return c.json(null);
  return c.json(await hydrateActivePatrol(db, membership.patrolId));
});

// ── Stand down ──────────────────────────────────────────
patrolRoutes.post("/:patrol_id/stand-down", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const patrolId = c.req.param("patrol_id");
  const body = await c.req.json<StandDownRequest>().catch(() => ({}));

  const db = getDb(c.env);
  const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!patrol) throw new AppError("STAND_DOWN_NOT_ON_PATROL");

  // Priority 1 — actor must be on this patrol (or admin/sector_lead)
  const member = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq }) => and(eq(pm.patrolId, patrolId), eq(pm.patrollerId, auth.patroller.patroller_id)),
  });
  const isElevated = auth.patroller.access_level === "sector_lead" || auth.patroller.access_level === "admin";
  if (!member && !isElevated) throw new AppError("STAND_DOWN_NOT_ON_PATROL");

  // Priority 2 — idempotency
  if (member?.endTime) throw new AppError("STAND_DOWN_ALREADY_STOOD_DOWN");
  if (!member && patrol.state === "stood_down") throw new AppError("STAND_DOWN_ALREADY_STOOD_DOWN");

  const now = new Date();
  const actorRole: "primary" | "joined" = member?.role ?? "primary";

  // ── Joined patroller early exit ──
  if (actorRole === "joined") {
    await db.update(patrolMembers).set({
      endTime: now,
      endLat: body.end_location?.lat ?? null,
      endLng: body.end_location?.lng ?? null,
    }).where(and(eq(patrolMembers.patrolId, patrolId), eq(patrolMembers.patrollerId, auth.patroller.patroller_id)));
    await logAudit(db, "patrol.joinedstooddown", auth, { patrol_id: patrolId });
    return c.json({ patrol_id: patrolId, role: "joined", end_time: now.toISOString() });
  }

  // ── Primary stand-down (with or without handoff) ──
  // Priorities 3/4 — odometer checks for vehicle patrols
  if (patrol.vehicleId) {
    if (body.odometer_end == null) throw new AppError("STAND_DOWN_ODOMETER_END_REQUIRED");
    if (patrol.odometerStart != null && body.odometer_end < patrol.odometerStart) {
      throw new AppError("STAND_DOWN_ODOMETER_END_LESS_THAN_START");
    }
  }

  const distanceKm = patrol.odometerStart != null && body.odometer_end != null
    ? Math.max(0, body.odometer_end - patrol.odometerStart)
    : null;

  const sarsCompliant = patrol.sarsCompliant && isGeoSarsCompliant(body.end_location);
  const seal = await sealRecord({
    patrol_id: patrol.id,
    primary_patroller_id: patrol.primaryPatrollerId,
    patrol_type: patrol.patrolType,
    vehicle_id: patrol.vehicleId,
    odometer_start: patrol.odometerStart,
    odometer_end: body.odometer_end ?? null,
    distance_km: distanceKm,
    start_time: patrol.startTime.toISOString(),
    end_time: now.toISOString(),
    start_location: { lat: patrol.startLat, lng: patrol.startLng, accuracy_m: patrol.startAccuracyM },
    end_location: body.end_location ?? null,
    sars_purpose: patrol.sarsPurpose,
    sars_compliant: sarsCompliant,
    reason: body.reason ?? null,
  });

  // Close the current patrol atomically-ish (Postgres transaction would be ideal;
  // keep it simple for POC and rely on database constraints).
  await db.update(patrols).set({
    state: "stood_down",
    endTime: now,
    endLat: body.end_location?.lat ?? null,
    endLng: body.end_location?.lng ?? null,
    endAccuracyM: body.end_location?.accuracy_m ?? null,
    odometerEnd: body.odometer_end ?? null,
    distanceKm,
    reason: body.reason ?? null,
    sarsCompliant,
    recordSealHash: seal,
  }).where(eq(patrols.id, patrolId));

  // Release vehicle odometer forward
  if (patrol.vehicleId && body.odometer_end != null) {
    await db.update(vehicles).set({ lastOdometer: body.odometer_end }).where(eq(vehicles.id, patrol.vehicleId));
  }

  // Auto-stand-down any still-active joined members
  await db.update(patrolMembers).set({ endTime: now }).where(
    and(eq(patrolMembers.patrolId, patrolId), isNull(patrolMembers.endTime)),
  );

  // Purge live pin
  await db.delete(livePins).where(eq(livePins.patrolId, patrolId));

  await logAudit(db, "patrol.stooddown", auth, { patrol_id: patrolId, distance_km: distanceKm, sars_compliant: sarsCompliant });

  // ── Handoff: commence a successor patrol in one flow ──
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
      odometerStart: body.handoff.continue_vehicle ? body.odometer_end ?? null : null,
      sarsCompliant: sarsCompliant,
      state: "active",
    }).returning();

    await db.insert(patrolMembers).values({ patrolId: successor.id, patrollerId: newPrimary.id, role: "primary" });
    // Transfer other still-at-it joined members (they were just auto-stood-down above, so we open fresh rows)
    const othersToTransfer = (body.handoff.continue_vehicle ? [] : []) as string[];
    for (const transferId of othersToTransfer) {
      await db.insert(patrolMembers).values({ patrolId: successor.id, patrollerId: transferId, role: "joined" });
    }

    handoff = { new_patrol_id: successor.id, new_primary_call_sign: newPrimary.callSign };
    await logAudit(db, "patrol.handedoff", auth, { old_patrol_id: patrolId, new_patrol_id: successor.id, new_primary_call_sign: newPrimary.callSign });
  }

  return c.json({
    patrol_id: patrolId,
    end_time: now.toISOString(),
    distance_km: distanceKm,
    sars_compliant: sarsCompliant,
    record_seal_hash: seal,
    handoff,
  });
});

// ── Helpers ─────────────────────────────────────────────
async function hydrateActivePatrol(db: ReturnType<typeof getDb>, patrolId: string) {
  const p = await db.query.patrols.findFirst({ where: eq(patrols.id, patrolId) });
  if (!p) throw new AppError("STAND_DOWN_NOT_ON_PATROL");
  const members = await db.query.patrolMembers.findMany({
    where: (pm, { eq }) => eq(pm.patrolId, patrolId),
  });
  const primary = members.find((m) => m.role === "primary");
  const primaryP = primary ? await db.query.patrollers.findFirst({ where: eq(patrollers.id, primary.patrollerId) }) : null;
  const joinedMembers = members.filter((m) => m.role === "joined");
  const joinedFull = await Promise.all(
    joinedMembers.map(async (jm) => {
      const jp = await db.query.patrollers.findFirst({ where: eq(patrollers.id, jm.patrollerId) });
      return {
        call_sign: jp?.callSign ?? "",
        name: jp?.name ?? "",
        start_time: jm.startTime.toISOString(),
        end_time: jm.endTime?.toISOString() ?? undefined,
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
    start_time: p.startTime.toISOString(),
    start_location:
      p.startLat != null && p.startLng != null && p.startAccuracyM != null
        ? { lat: p.startLat, lng: p.startLng, accuracy_m: p.startAccuracyM, captured_at: p.startTime.toISOString() }
        : undefined,
    sars_compliant: p.sarsCompliant,
    state: p.state,
  };
}
