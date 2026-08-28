// Simple rate limit against the login_attempts table (windowed count).
// FDL: patroller-login.rules.security.rate_limit (5 per 15 min per (call_sign, ip))

import { and, eq, gt, sql } from "drizzle-orm";
import { loginAttempts } from "../db/schema.js";
import type { Db } from "../db/index.js";

export interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

export async function checkLoginRateLimit(
  db: Db,
  callSign: string,
  ip: string | null,
  cfg: RateLimitConfig = { windowSeconds: 900, maxRequests: 5 },
): Promise<{ limited: boolean; attempts: number }> {
  // login_attempts.created_at is SQLite `datetime('now')` (`YYYY-MM-DD HH:MM:SS`).
  // Comparing against ISO-8601 with `T`/`Z` never matches, so the limit never fired.
  const since = new Date(Date.now() - cfg.windowSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.callSign, callSign), gt(loginAttempts.createdAt, since)));
  const count = rows[0]?.count ?? 0;
  return { limited: count >= cfg.maxRequests, attempts: count };
}

export async function recordLoginAttempt(
  db: Db,
  callSign: string,
  ip: string | null,
  deviceId: string | null,
  outcome: string,
): Promise<void> {
  await db.insert(loginAttempts).values({ callSign, ip, deviceId, outcome });
}
