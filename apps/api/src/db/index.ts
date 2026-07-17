// Cloudflare D1 (SQLite) client factory.
// Uses Drizzle's D1 adapter — stateless per request, Worker-safe.
// FDL: database migration from Neon Postgres → Cloudflare D1

import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "../env.js";
import * as schema from "./schema.js";

export function getDb(env: Env): DrizzleD1Database<typeof schema> {
  // DB is the D1 database binding defined in wrangler.toml
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
