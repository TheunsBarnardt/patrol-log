// Admin: Sector CRUD with polygon boundary management.
// Admin-only — sector_lead cannot create/delete sectors.

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { sectors, patrollers } from "../db/schema.js";
import type { GeoJSONPolygon } from "../lib/geo.js";
import { logAudit } from "../lib/audit.js";

export const sectorsRoute = new Hono<AppContext>();

sectorsRoute.use("*", requireAuth(), requireAccessLevel("admin"));

sectorsRoute.get("/sectors", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(sectors)
    .where(eq(sectors.cpfId, auth.patroller.cpf_id))
    .orderBy(sectors.name);
  return c.json({ results: rows });
});

sectorsRoute.post("/sectors", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name: string; boundaries?: GeoJSONPolygon | null }>();
  if (!body.name?.trim()) throw new AppError("LIVE_MAP_HEARTBEAT_PATROL_NOT_ACTIVE"); // reuse 422
  const db = getDb(c.env);
  const [row] = await db
    .insert(sectors)
    .values({
      cpfId: auth.patroller.cpf_id,
      name: body.name.trim(),
      boundaries: body.boundaries ?? null,
    })
    .returning();
  await logAudit(db, "admin.sector.created", auth, { sector_id: row.id });
  return c.json(row);
});

sectorsRoute.patch("/sectors/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; boundaries?: GeoJSONPolygon | null }>();
  const db = getDb(c.env);
  const target = await db.query.sectors.findFirst({ where: and(eq(sectors.id, id), eq(sectors.cpfId, auth.patroller.cpf_id)) });
  if (!target) throw new AppError("MEMBERS_NO_RESULTS");
  const update: Partial<typeof sectors.$inferInsert> = {};
  if (body.name !== undefined) update.name = body.name.trim();
  if ("boundaries" in body) update.boundaries = body.boundaries ?? null;
  const [row] = await db.update(sectors).set(update).where(eq(sectors.id, id)).returning();
  await logAudit(db, "admin.sector.updated", auth, { sector_id: id });
  return c.json(row);
});

sectorsRoute.delete("/sectors/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);
  // Guard: refuse if patrollers are assigned to this sector
  const assigned = await db.query.patrollers.findFirst({ where: eq(patrollers.sectorId, id) });
  if (assigned) {
    return c.json({ error: "SECTOR_HAS_MEMBERS", message: "Reassign all members before deleting this sector." }, 409);
  }
  await db.delete(sectors).where(and(eq(sectors.id, id), eq(sectors.cpfId, auth.patroller.cpf_id)));
  await logAudit(db, "admin.sector.deleted", auth, { sector_id: id });
  return c.json({ ok: true });
});
