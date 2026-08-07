// FDL: blueprints/data/hotspots-map.blueprint.yaml
// Managed hotspots: admin-defined circles with rating + diameter (km).

import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { AppError, type HotspotPeriod, type HotspotPin } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { hotspots } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";
import { isCpfWide, tenantScope } from "../lib/scope.js";

export const hotspotsRoute = new Hono<AppContext>();

function ratingToSeverity(rating: number): HotspotPin["severity"] {
  if (rating >= 5) return "critical";
  if (rating >= 4) return "high";
  if (rating >= 3) return "medium";
  return "low";
}

function periodStart(period: HotspotPeriod, now: Date): Date {
  const d = new Date(now);
  switch (period) {
    case "today":
      d.setHours(0, 0, 0, 0);
      return d;
    case "7d":
      d.setDate(d.getDate() - 7);
      return d;
    case "30d":
      d.setDate(d.getDate() - 30);
      return d;
    case "90d":
      d.setDate(d.getDate() - 90);
      return d;
  }
}

function toPin(r: typeof hotspots.$inferSelect): HotspotPin {
  return {
    hotspot_id: r.id,
    title: r.title,
    description: r.description ?? "",
    rating: r.rating,
    diameter_km: r.diameterKm,
    lat: r.lat,
    lng: r.lng,
    created_at: r.createdAt,
    sector_id: r.sectorId,
    severity: ratingToSeverity(r.rating),
    incident_id: r.id,
    type: r.title,
    occurred_at: r.createdAt,
  };
}

hotspotsRoute.get("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const period = (c.req.query("period") ?? "7d") as HotspotPeriod;
  if (!["today", "7d", "30d", "90d"].includes(period)) throw new AppError("HOTSPOTS_INVALID_PERIOD");

  const now = new Date();
  const from = periodStart(period, now);
  const db = getDb(c.env);
  const fromStr = from.toISOString();
  const nowStr = now.toISOString();

  // All managed hotspots in sector (system_admin = whole CPF). Period kept for client UI.
  const rows = await db
    .select()
    .from(hotspots)
    .where(tenantScope(auth, hotspots))
    .orderBy(desc(hotspots.createdAt))
    .limit(500);

  await logAudit(db, "hotspots.queried", auth, {
    period,
    result_count: rows.length,
    cpf_wide: isCpfWide(auth),
  });

  return c.json({
    period,
    from: fromStr,
    to: nowStr,
    pins: rows.map(toPin),
  });
});
