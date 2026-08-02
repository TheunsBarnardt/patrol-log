// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// POC realtime: HTTP polling (no Durable Objects on free tier).
// Clients POST /live-map/heartbeat every 30s and GET /live-map/snapshot every 30s.

import { Hono } from "hono";
import { and, eq, gt, sql } from "drizzle-orm";
import { AppError, type HeartbeatRequest, type LiveMapPin } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { livePins, patrols, patrolMembers, sectors, vehicles } from "../db/schema.js";
import { verifyHeartbeat } from "../lib/tokens.js";
import { logAudit } from "../lib/audit.js";
import { pointInPolygon } from "../lib/geo.js";
import { sendOutOfSectorNotification } from "./messages.js";

export const liveMap = new Hono<AppContext>();

const STALE_THRESHOLD_MS = 2 * 60_000;
const OUT_OF_SECTOR_THROTTLE_MS = 15 * 60_000; // max 1 alert per 15 min

liveMap.post("/heartbeat", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<HeartbeatRequest>().catch(() => null);
  if (!body) throw new AppError("LIVE_MAP_HEARTBEAT_PATROL_NOT_ACTIVE");

  // Priority 3 — signature must verify
  const ok = await verifyHeartbeat(auth.device.device_token_jti, body.patrol_id, body.timestamp, body.signature);
  if (!ok) {
    await logAudit(getDb(c.env), "livemap.forgerydetected", auth, { patrol_id: body.patrol_id });
    throw new AppError("LIVE_MAP_HEARTBEAT_INVALID_SIGNATURE");
  }

  const db = getDb(c.env);
  const patrol = await db.query.patrols.findFirst({ where: eq(patrols.id, body.patrol_id) });
  if (!patrol || patrol.state !== "active") throw new AppError("LIVE_MAP_HEARTBEAT_PATROL_NOT_ACTIVE");

  // Priority 2 — rate limit (1 per 20s): check last_seen_at on the row.
  const existing = await db.query.livePins.findFirst({ where: eq(livePins.patrolId, body.patrol_id) });
  if (existing && new Date(existing.lastSeenAt) > new Date(Date.now() - 20_000)) {
    throw new AppError("LIVE_MAP_HEARTBEAT_RATE_LIMITED");
  }

  // Priority 10 — upsert the pin and append a breadcrumb
  await db
    .insert(livePins)
    .values({
      patrolId: body.patrol_id,
      cpfId: patrol.cpfId,
      sectorId: patrol.sectorId,
      callSign: auth.patroller.call_sign,
      lat: body.lat,
      lng: body.lng,
      heading: body.heading ?? null,
      speed: body.speed ?? null,
      accuracyM: body.accuracy_m,
      lastSeenAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: livePins.patrolId,
      set: {
        lat: body.lat,
        lng: body.lng,
        heading: body.heading ?? null,
        speed: body.speed ?? null,
        accuracyM: body.accuracy_m,
        lastSeenAt: new Date().toISOString(),
      },
    });

  // ── Out-of-sector boundary check ────────────────────────
  let outOfSector = false;
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, patrol.sectorId) });

  if (sector?.boundaries) {
    outOfSector = !pointInPolygon(body.lat, body.lng, sector.boundaries);
  }

  // Update the outOfSector flag on the pin
  await db
    .update(livePins)
    .set({ outOfSector })
    .where(eq(livePins.patrolId, body.patrol_id));

  // Throttled alert: max 1 per 15 min per patrol
  if (outOfSector) {
    const pin = await db.query.livePins.findFirst({ where: eq(livePins.patrolId, body.patrol_id) });
    const shouldAlert =
      !pin?.lastOutOfSectorAlertAt ||
      Date.now() - new Date(pin.lastOutOfSectorAlertAt).getTime() > OUT_OF_SECTOR_THROTTLE_MS;

    if (shouldAlert) {
      await db
        .update(livePins)
        .set({ lastOutOfSectorAlertAt: new Date().toISOString() })
        .where(eq(livePins.patrolId, body.patrol_id));

      // In-app message only (no FCM push)
      void sendOutOfSectorNotification(
        db,
        auth,
        patrol.sectorId,
        sector?.name ?? "Unknown Sector",
        patrol.cpfId,
      );
    }
  }

  return c.json({ ok: true, out_of_sector: outOfSector });
});

liveMap.get("/snapshot", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  // Dispatch and admin roles see all sectors in their CPF; patrollers see only their sector.
  const isDispatch = auth.patroller.access_level === "call_centre_agent"
    || auth.patroller.access_level === "admin"
    || auth.patroller.access_level === "sector_lead";
  const since = new Date(Date.now() - STALE_THRESHOLD_MS * 2).toISOString();

  const rows = isDispatch
    ? await db.select().from(livePins).where(and(eq(livePins.cpfId, auth.patroller.cpf_id), gt(livePins.lastSeenAt, since)))
    : await db.select().from(livePins).where(and(eq(livePins.sectorId, auth.patroller.sector_id), gt(livePins.lastSeenAt, since)));

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
        stale: now - new Date(r.lastSeenAt).getTime() > STALE_THRESHOLD_MS,
        out_of_sector: r.outOfSector,
      };
    }),
  );

  return c.json({ pins });
});
