// FDL: blueprints/auth/patroller-login.blueprint.yaml

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError, type LoginRequest, type ResumeRequest } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { devices, patrollers, sectors, cpfs } from "../db/schema.js";
import { verifyPassword, hashPassword } from "../lib/hashing.js";
import { signDeviceToken, verifyDeviceToken } from "../lib/tokens.js";
import { checkLoginRateLimit, recordLoginAttempt } from "../lib/rate-limit.js";
import { logAudit } from "../lib/audit.js";
import { requireAuth, getAuth } from "../lib/middleware.js";

export const auth = new Hono<AppContext>();

auth.post("/login", async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null);
  if (!body?.call_sign || !body?.password || !body?.device_id) {
    throw new AppError("LOGIN_MISSING_INPUT");
  }
  const callSign = body.call_sign.toUpperCase().trim();
  const ip = c.req.header("cf-connecting-ip") ?? null;
  const db = getDb(c.env);

  // Priority 1 — rate limit
  const rl = await checkLoginRateLimit(db, callSign, ip);
  if (rl.limited) {
    await recordLoginAttempt(db, callSign, ip, body.device_id, "rate_limited");
    throw new AppError("LOGIN_RATE_LIMITED");
  }

  // Lookup patroller
  const patroller = await db.query.patrollers.findFirst({
    where: (p, { eq }) => eq(p.callSign, callSign),
  });

  // Priority 2 — account locked
  if (patroller?.lockedUntil && patroller.lockedUntil > new Date()) {
    await recordLoginAttempt(db, callSign, ip, body.device_id, "locked");
    throw new AppError("LOGIN_ACCOUNT_LOCKED");
  }

  // Priority 3 — account inactive
  if (patroller && patroller.status !== "active") {
    await recordLoginAttempt(db, callSign, ip, body.device_id, "inactive");
    throw new AppError("LOGIN_ACCOUNT_INACTIVE");
  }

  // Priority 6 — invalid credentials (enumeration prevention: same error for either branch)
  const ok = patroller ? await verifyPassword(body.password, patroller.passwordHash) : false;
  if (!patroller || !ok) {
    const attempts = (patroller?.failedLoginAttempts ?? 0) + 1;
    if (patroller) {
      const lockUntil = attempts >= 10 ? new Date(Date.now() + 30 * 60_000) : patroller.lockedUntil;
      await db
        .update(patrollers)
        .set({ failedLoginAttempts: attempts, lockedUntil: lockUntil ?? null })
        .where(eq(patrollers.id, patroller.id));
    }
    await recordLoginAttempt(db, callSign, ip, body.device_id, "invalid_credentials");
    throw new AppError("LOGIN_INVALID_CREDENTIALS");
  }

  // Priority 10 — successful login. Reset counter, issue device token.
  await db.update(patrollers).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(patrollers.id, patroller.id));

  const { token, jti } = await signDeviceToken(c.env.JWT_SECRET, {
    sub: patroller.id,
    cs: patroller.callSign,
    al: patroller.accessLevel,
    cpf: patroller.cpfId,
    sec: patroller.sectorId,
    dev: body.device_id,
  });

  // Upsert device row (one row per patroller+device).
  const existing = await db.query.devices.findFirst({
    where: (d, { and, eq }) => and(eq(d.patrollerId, patroller.id), eq(d.deviceId, body.device_id)),
  });
  if (existing) {
    await db.update(devices).set({ tokenJti: jti, status: "active", lastSeenAt: new Date() }).where(eq(devices.id, existing.id));
  } else {
    await db.insert(devices).values({
      patrollerId: patroller.id,
      deviceId: body.device_id,
      tokenJti: jti,
      status: "active",
      userAgent: c.req.header("user-agent") ?? null,
    });
  }

  await recordLoginAttempt(db, callSign, ip, body.device_id, "success");

  const profile = await hydrateProfile(db, patroller);
  await logAudit(db, "login.success", {
    patroller: { patroller_id: patroller.id, call_sign: patroller.callSign, access_level: patroller.accessLevel, cpf_id: patroller.cpfId, sector_id: patroller.sectorId },
    device: { device_id: body.device_id, device_token_jti: jti },
    ip: ip ?? "unknown",
  }, { event: "login.success" });

  return c.json({ device_token: token, patroller: profile });
});

auth.post("/resume", async (c) => {
  const body = await c.req.json<ResumeRequest>().catch(() => null);
  if (!body?.device_token || !body?.device_id) throw new AppError("LOGIN_INVALID_CREDENTIALS");
  const db = getDb(c.env);

  const claims = await verifyDeviceToken(c.env.JWT_SECRET, body.device_token).catch(() => null);
  if (!claims || claims.dev !== body.device_id) throw new AppError("LOGIN_INVALID_CREDENTIALS");

  const device = await db.query.devices.findFirst({
    where: (d, { and, eq }) => and(eq(d.patrollerId, claims.sub), eq(d.deviceId, body.device_id)),
  });
  if (!device || device.status !== "active" || device.tokenJti !== claims.jti) {
    throw new AppError("LOGIN_DEVICE_REVOKED");
  }

  const patroller = await db.query.patrollers.findFirst({ where: eq(patrollers.id, claims.sub) });
  if (!patroller || patroller.status !== "active") throw new AppError("LOGIN_ACCOUNT_INACTIVE");

  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));
  const profile = await hydrateProfile(db, patroller);
  return c.json({ device_token: body.device_token, patroller: profile });
});

auth.post("/logout", requireAuth(), async (c) => {
  const a = getAuth(c);
  const db = getDb(c.env);
  await db.update(devices).set({ status: "revoked" }).where(
    and(eq(devices.patrollerId, a.patroller.patroller_id), eq(devices.deviceId, a.device.device_id)),
  );
  await logAudit(db, "logout", a);
  return c.json({ ok: true });
});

auth.post("/change-password", requireAuth(), async (c) => {
  const a = getAuth(c);
  const body = await c.req.json<{ current_password: string; new_password: string }>().catch(() => null);
  if (!body?.current_password || !body?.new_password) throw new AppError("LOGIN_MISSING_INPUT");
  if (body.new_password.length < 8) throw new AppError("LOGIN_MISSING_INPUT");
  const db = getDb(c.env);
  const patroller = await db.query.patrollers.findFirst({ where: eq(patrollers.id, a.patroller.patroller_id) });
  if (!patroller) throw new AppError("LOGIN_ACCOUNT_INACTIVE");
  const ok = await verifyPassword(body.current_password, patroller.passwordHash);
  if (!ok) throw new AppError("LOGIN_INVALID_CREDENTIALS");
  const newHash = await hashPassword(body.new_password);
  await db.update(patrollers).set({ passwordHash: newHash }).where(eq(patrollers.id, patroller.id));
  await logAudit(db, "auth.password_changed", a);
  return c.json({ ok: true });
});

auth.get("/me", requireAuth(), async (c) => {
  const a = getAuth(c);
  const db = getDb(c.env);
  const patroller = await db.query.patrollers.findFirst({ where: eq(patrollers.id, a.patroller.patroller_id) });
  if (!patroller) throw new AppError("LOGIN_ACCOUNT_INACTIVE");
  return c.json(await hydrateProfile(db, patroller));
});

async function hydrateProfile(db: ReturnType<typeof getDb>, p: typeof patrollers.$inferSelect) {
  const [sector, cpf] = await Promise.all([
    db.query.sectors.findFirst({ where: eq(sectors.id, p.sectorId) }),
    db.query.cpfs.findFirst({ where: eq(cpfs.id, p.cpfId) }),
  ]);
  return {
    patroller_id: p.id,
    call_sign: p.callSign,
    name: p.name,
    access_level: p.accessLevel,
    organization: "CPF",
    sector: sector?.name ?? "",
    province: cpf?.province ?? "",
    cpf_id: p.cpfId,
    sector_id: p.sectorId,
  };
}
