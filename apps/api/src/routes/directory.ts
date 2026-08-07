// FDL: blueprints/data/residents-directory.blueprint.yaml
// FDL: blueprints/data/members-directory.blueprint.yaml
// FDL: blueprints/data/emergency-contacts-directory.blueprint.yaml

import { Hono } from "hono";
import { and, eq, or, sql } from "drizzle-orm";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import {
  emergencyServices,
  livePins,
  nextOfKin,
  patrolEscalationEvents,
  patrolMembers,
  patrollers,
  residents,
  sectors,
} from "../db/schema.js";
import { logAudit } from "../lib/audit.js";

export const directory = new Hono<AppContext>();

function ilikeCol(col: any, pattern: string) {
  return sql`${col} LIKE ${pattern}`;
}

directory.get("/residents", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const q = (c.req.query("q") ?? "").trim();
  if (q && q.length < 2) throw new AppError("RESIDENTS_SEARCH_TERM_TOO_SHORT");

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(residents)
    .where(
      and(
        eq(residents.sectorId, auth.patroller.sector_id),
        q
          ? or(
              ilikeCol(residents.name, `%${q}%`),
              ilikeCol(residents.phone, `%${q}%`),
              ilikeCol(residents.address, `%${q}%`),
            )
          : sql`true`,
      ),
    )
    .limit(100);

  await logAudit(db, "residents.searched", auth, { q, result_count: rows.length });

  return c.json({
    results: rows.map((r) => ({ resident_id: r.id, name: r.name, phone: r.phone, address: r.address })),
  });
});

directory.post("/residents/:id/call", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  await logAudit(db, "residents.taptocall", auth, { resident_id: c.req.param("id") });
  return c.json({ ok: true });
});

directory.get("/members", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const q = (c.req.query("q") ?? "").trim();
  if (q && q.length < 2) throw new AppError("MEMBERS_SEARCH_TERM_TOO_SHORT");

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(patrollers)
    .where(
      and(
        eq(patrollers.sectorId, auth.patroller.sector_id),
        eq(patrollers.status, "active"),
        q
          ? or(
              ilikeCol(patrollers.name, `%${q}%`),
              ilikeCol(patrollers.callSign, `%${q.toUpperCase().trim()}%`),
              ilikeCol(patrollers.phone, `%${q}%`),
            )
          : sql`true`,
      ),
    )
    .limit(100);

  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, auth.patroller.sector_id) });
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const nok = await db.select().from(nextOfKin).where(eq(nextOfKin.patrollerId, r.id));
      // On duty = active patrol pin present (stays until stand-down, not heartbeat age).
      const onDuty = await db.query.livePins.findFirst({
        where: (lp, { eq }) => eq(lp.callSign, r.callSign),
      });
      return {
        member_id: r.id,
        name: r.name,
        call_sign: r.callSign,
        phone: r.phone ?? "",
        address: r.address ?? "",
        sector: sector?.code || sector?.name || "",
        access_level: r.accessLevel,
        is_on_duty: Boolean(onDuty),
        next_of_kin: nok.map((n) => ({ name: n.name, relationship: n.relationship, phone: n.phone, alternate_phone: n.alternatePhone ?? undefined })),
      };
    }),
  );

  await logAudit(db, "members.searched", auth, { q, result_count: rows.length });
  return c.json({ results: enriched });
});

directory.post("/members/:id/call", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  await logAudit(db, "members.taptocall", auth, { member_id: c.req.param("id") });
  return c.json({ ok: true });
});

directory.get("/emergency-contacts", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(emergencyServices)
    .where(eq(emergencyServices.cpfId, auth.patroller.cpf_id))
    .orderBy(emergencyServices.priority);

  if (rows.length === 0) throw new AppError("EMERGENCY_NO_SERVICES_CONFIGURED");

  const filtered = rows.filter((r) => !r.sensitive || auth.patroller.access_level !== "call_centre_agent");

  return c.json({
    results: filtered.map((r) => ({
      service_id: r.id,
      name: r.name,
      service_type: r.serviceType,
      primary_number: r.primaryNumber,
      secondary_number: r.secondaryNumber ?? undefined,
      address: r.address ?? undefined,
      priority: r.priority,
      verified_at: r.verifiedAt,
      sensitive: r.sensitive,
    })),
  });
});

directory.post("/emergency-contacts/:id/call", requireAuth(), async (c) => {
  const auth = getAuth(c);
  const serviceId = c.req.param("id");
  const db = getDb(c.env);

  const service = await db.query.emergencyServices.findFirst({ where: eq(emergencyServices.id, serviceId) });
  if (!service) return c.json({ ok: true });

  const membership = await db.query.patrolMembers.findFirst({
    where: (pm, { and, eq, isNull }) => and(eq(pm.patrollerId, auth.patroller.patroller_id), isNull(pm.endTime)),
  });
  if (membership) {
    await db.insert(patrolEscalationEvents).values({
      patrolId: membership.patrolId,
      actorPatrollerId: auth.patroller.patroller_id,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: service.serviceType,
    });
  }

  await logAudit(db, "emergency.taptocall", auth, {
    service_id: service.id,
    service_name: service.name,
    service_type: service.serviceType,
    patrol_id: membership?.patrolId ?? null,
  });
  return c.json({ ok: true });
});
