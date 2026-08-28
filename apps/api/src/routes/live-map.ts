// FDL: blueprints/data/live-patroller-map.blueprint.yaml
// POC realtime: HTTP polling (no Durable Objects on free tier).
// Clients POST /live-map/heartbeat every 30s and GET /live-map/snapshot every 30s.

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError, parseSqliteUtc, type HeartbeatRequest, type LiveMapPin } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { livePins, patrols, patrollers, vehicles } from "../db/schema.js";
import { verifyHeartbeat } from "../lib/tokens.js";
import { logAudit } from "../lib/audit.js";
import { toLiveMapPin } from "../lib/live-pin.js";
import { mergePatrolPath, parsePathJson } from "../lib/trail.js";

export const liveMap = new Hono<AppContext>();

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

  // Passengers share the primary's pin — do not move it to the joiner's phone.
  if (patrol.primaryPatrollerId !== auth.patroller.patroller_id) {
    return c.json({ ok: true, out_of_sector: false });
  }

  // Priority 2 — rate limit (1 per 20s): check last_seen_at on the row.
  const existing = await db.query.livePins.findFirst({ where: eq(livePins.patrolId, body.patrol_id) });
  const lastSeen = existing ? parseSqliteUtc(existing.lastSeenAt)?.getTime() ?? 0 : 0;
  if (existing && lastSeen > Date.now() - 15_000) {
    throw new AppError("LIVE_MAP_HEARTBEAT_RATE_LIMITED");
  }

  const pathJson = mergePatrolPath(parsePathJson(existing?.pathJson), body.trail, body.lat, body.lng);

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
      pathJson,
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
        pathJson,
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
    .select({ pin: livePins, patrol: patrols, primary: patrollers })
    .from(livePins)
    .innerJoin(patrols, eq(patrols.id, livePins.patrolId))
    .innerJoin(patrollers, eq(patrollers.id, patrols.primaryPatrollerId))
    .where(and(scope, eq(patrols.state, "active")));

  const now = Date.now();
  const pins: LiveMapPin[] = await Promise.all(
    rows.map(async ({ pin: r, patrol, primary }) => {
      let vehicleRegistration: string | undefined;
      if (patrol.vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, patrol.vehicleId) });
        vehicleRegistration = vehicle?.registration;
      }
      return toLiveMapPin({ pin: r, patrol, vehicleRegistration, callSign: primary.callSign, now });
    }),
  );

  return c.json({ pins });
});
