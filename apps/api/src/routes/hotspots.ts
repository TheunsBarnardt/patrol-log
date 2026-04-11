// FDL: blueprints/data/hotspots-map.blueprint.yaml

import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import { AppError, type HotspotPeriod } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { incidents } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";

export const hotspots = new Hono<AppContext>();

hotspots.get("/", requireAuth(), async (c) => {
  const period = (c.req.query("period") ?? "7d") as HotspotPeriod;
  if (!["today", "7d", "30d", "90d"].includes(period)) throw new AppError("HOTSPOTS_INVALID_PERIOD");

  const now = new Date();
  const from = periodStart(period, now);
  const db = getDb(c.env);

  const rows = await db
    .select()
    .from(incidents)
    .where(and(gte(incidents.occurredAt, from), lte(incidents.occurredAt, now)))
    .limit(500);

  await logAudit(db, "hotspots.queried", c.get("auth")!, { period, result_count: rows.length });

  return c.json({
    period,
    from: from.toISOString(),
    to: now.toISOString(),
    pins: rows.map((r) => ({
      incident_id: r.id,
      lat: r.lat,
      lng: r.lng,
      type: r.type,
      severity: r.severity as "low" | "medium" | "high",
      occurred_at: r.occurredAt.toISOString(),
    })),
  });
});

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
