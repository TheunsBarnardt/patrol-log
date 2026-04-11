// Neon serverless Postgres client factory.
// One HTTP driver per request — Neon's driver is stateless and Worker-safe.

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import type { Env } from "../env.js";
import * as schema from "./schema.js";

export function getDb(env: Env) {
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
