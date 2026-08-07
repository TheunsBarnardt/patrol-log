// Sector list + system_admin CRUD (name / code). Boundaries not used.

import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { patrollers, sectors } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";

export const sectorsRoute = new Hono<AppContext>();

sectorsRoute.use("*", requireAuth(), requireAccessLevel("system_admin", "admin", "sector_lead", "call_centre_agent"));

sectorsRoute.get("/sectors", async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: sectors.id,
      name: sectors.name,
      code: sectors.code,
      cpfId: sectors.cpfId,
      createdAt: sectors.createdAt,
      memberCount: sql<number>`(select count(*) from patrollers where patrollers.sector_id = ${sectors.id})`.mapWith(Number),
    })
    .from(sectors)
    .where(eq(sectors.cpfId, auth.patroller.cpf_id))
    .orderBy(sectors.name);
  return c.json({ results: rows });
});

sectorsRoute.post("/sectors", requireAccessLevel("system_admin"), async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ name: string; code?: string }>();
  const name = body.name?.trim();
  const code = body.code?.trim().toUpperCase() || null;
  if (!name) throw new AppError("SECTOR_INVALID_INPUT");

  const db = getDb(c.env);
  if (code) {
    const dup = await db.query.sectors.findFirst({
      where: and(eq(sectors.cpfId, auth.patroller.cpf_id), eq(sectors.code, code)),
    });
    if (dup) throw new AppError("SECTOR_DUPLICATE_CODE");
  }

  const [row] = await db
    .insert(sectors)
    .values({
      cpfId: auth.patroller.cpf_id,
      name,
      code,
    })
    .returning();
  await logAudit(db, "admin.sector.created", auth, { sector_id: row.id, code: row.code });
  return c.json(row);
});

sectorsRoute.patch("/sectors/:id", requireAccessLevel("system_admin"), async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; code?: string | null }>();
  const db = getDb(c.env);

  const existing = await db.query.sectors.findFirst({ where: eq(sectors.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("SECTOR_NOT_FOUND");

  const update: Partial<typeof sectors.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new AppError("SECTOR_INVALID_INPUT");
    update.name = name;
  }
  if (body.code !== undefined) {
    const code = body.code?.trim().toUpperCase() || null;
    if (code) {
      const dup = await db.query.sectors.findFirst({
        where: and(eq(sectors.cpfId, auth.patroller.cpf_id), eq(sectors.code, code), ne(sectors.id, id)),
      });
      if (dup) throw new AppError("SECTOR_DUPLICATE_CODE");
    }
    update.code = code;
  }

  const [row] = await db.update(sectors).set(update).where(eq(sectors.id, id)).returning();
  await logAudit(db, "admin.sector.updated", auth, { sector_id: id });
  return c.json(row);
});

sectorsRoute.delete("/sectors/:id", requireAccessLevel("system_admin"), async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const db = getDb(c.env);

  const existing = await db.query.sectors.findFirst({ where: eq(sectors.id, id) });
  if (!existing || existing.cpfId !== auth.patroller.cpf_id) throw new AppError("SECTOR_NOT_FOUND");

  const assigned = await db.query.patrollers.findFirst({ where: eq(patrollers.sectorId, id) });
  if (assigned) throw new AppError("SECTOR_HAS_MEMBERS");

  await db.delete(sectors).where(eq(sectors.id, id));
  await logAudit(db, "admin.sector.deleted", auth, { sector_id: id, code: existing.code });
  return c.json({ ok: true });
});
