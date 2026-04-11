// Patroller-accessible vehicle list — returns vehicles assigned to this patroller.
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { vehicles } from "../db/schema.js";

export const vehiclesRoute = new Hono<AppContext>();

vehiclesRoute.get("/", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  // Return only vehicles assigned to this patroller (linked via patroller_id).
  const rows = await db
    .select()
    .from(vehicles)
    .where(
      and(
        eq(vehicles.cpfId, auth.patroller.cpf_id),
        eq(vehicles.patrollerId, auth.patroller.patroller_id),
      ),
    );
  return c.json({ results: rows });
});
