// Simple rate limit against the login_attempts table (windowed count).
// FDL: patroller-login.rules.security.rate_limit (5 per 15 min per (call_sign, ip))
//
// For POC scale this is fine. For production, switch to Cloudflare's
// Rate Limiting API or KV-backed counters to avoid DB read amplification.

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
  const since = new Date(Date.now() - cfg.windowSeconds * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
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
