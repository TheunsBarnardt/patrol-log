// Authentication + CORS + error middleware for Hono.

import type { Context, MiddlewareHandler, Next } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { verifyDeviceToken } from "./tokens.js";
import { getDb } from "../db/index.js";
import { devices, patrollers } from "../db/schema.js";
import { AppError } from "@patrol-log/shared";
import type { Env, AuthenticatedContext } from "../env.js";

export type AppContext = {
  Bindings: Env;
  Variables: { auth?: AuthenticatedContext };
};

export function corsMiddleware(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const origins = (c.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim());
    return cors({
      origin: origins.includes("*") ? "*" : (origin) => (origins.includes(origin) ? origin : null),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: origins.includes("*") ? false : true,
      maxAge: 86400,
    })(c, next);
  };
}

// Attach the authenticated patroller to the context, or 401.
export function requireAuth(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new AppError("LOGIN_INVALID_CREDENTIALS");

    const claims = await verifyDeviceToken(c.env.JWT_SECRET, match[1]).catch(() => null);
    if (!claims) throw new AppError("LOGIN_INVALID_CREDENTIALS");

    const db = getDb(c.env);
    const device = await db.query.devices.findFirst({
      where: (d, { and, eq }) => and(eq(d.tokenJti, claims.jti), eq(d.patrollerId, claims.sub)),
    });
    if (!device || device.status !== "active") throw new AppError("LOGIN_DEVICE_REVOKED");

    const patroller = await db.query.patrollers.findFirst({ where: eq(patrollers.id, claims.sub) });
    if (!patroller || patroller.status !== "active") throw new AppError("LOGIN_ACCOUNT_INACTIVE");

    // Update last_seen asynchronously — don't block the request.
    void db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));

    const auth: AuthenticatedContext = {
      patroller: {
        patroller_id: patroller.id,
        call_sign: patroller.callSign,
        access_level: patroller.accessLevel,
        cpf_id: patroller.cpfId,
        sector_id: patroller.sectorId,
      },
      device: { device_id: claims.dev, device_token_jti: claims.jti },
      ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown",
    };
    c.set("auth", auth);
    await next();
  };
}

export function requireAccessLevel(...levels: Array<AuthenticatedContext["patroller"]["access_level"]>): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new AppError("LOGIN_INVALID_CREDENTIALS");
    if (!levels.includes(auth.patroller.access_level)) throw new AppError("COMMENCE_UNAUTHORIZED");
    await next();
  };
}

export async function errorHandler(err: unknown, c: Context<AppContext>) {
  if (err instanceof AppError) {
    return c.json(err.body, err.status as 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 423 | 429 | 500 | 503);
  }
  console.error("[api] unhandled error", err);
  return c.json({ error: "INTERNAL", message: "Something went wrong" }, 500);
}

export function getAuth(c: Context<AppContext>): AuthenticatedContext {
  const auth = c.get("auth");
  if (!auth) throw new AppError("LOGIN_INVALID_CREDENTIALS");
  return auth;
}
