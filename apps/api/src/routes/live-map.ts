// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// POC realtime: HTTP polling (no Durable Objects on free tier).
// Clients POST /live-map/heartbeat every 30s and GET /live-map/snapshot every 30s.

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError, type HeartbeatRequest, type LiveMapPin } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { livePins, patrols, vehicles } from "../db/schema.js";
import { verifyHeartbeat } from "../lib/tokens.js";
import { logAudit } from "../lib/audit.js";

export const liveMap = new Hono<AppContext>();

const STALE_THRESHOLD_MS = 2 * 60_000;

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

  // Upsert pin — no polygon boundary checks (boundaries removed).
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
      outOfSector: false,
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
        outOfSector: false,
      },
    });

  return c.json({ ok: true, out_of_sector: false });
});

liveMap.get("/snapshot", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);

  // system_admin = whole CPF; everyone else = own sector. Pins stay until stand-down.
  const scope =
    auth.patroller.access_level === "system_admin"
      ? eq(livePins.cpfId, auth.patroller.cpf_id)
      : and(eq(livePins.cpfId, auth.patroller.cpf_id), eq(livePins.sectorId, auth.patroller.sector_id));

  const rows = await db
    .select({ pin: livePins, patrol: patrols })
    .from(livePins)
    .innerJoin(patrols, eq(patrols.id, livePins.patrolId))
    .where(and(scope, eq(patrols.state, "active")));

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
        stale: now - new Date(r.lastSeenAt).getTime() > STALE_THRESHOLD_MS,
        out_of_sector: r.outOfSector,
      };
    }),
  );

  return c.json({ pins });
});
