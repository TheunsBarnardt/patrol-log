// System admin: full-DB backup / restore / CSV export.
// Backups are stored in system_backups — seed scripts MUST NEVER delete that table.

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { AppError } from "@patrol-log/shared";
import type { AppContext } from "../lib/middleware.js";
import { requireAuth, requireAccessLevel, getAuth } from "../lib/middleware.js";
import { getDb } from "../db/index.js";
import { systemBackups } from "../db/schema.js";
import { logAudit } from "../lib/audit.js";
import {
  BACKUP_VERSION,
  INSERT_TABLES,
  MAX_STORED_BACKUP_BYTES,
  WIPE_TABLES,
  rowsToCsv,
  type SystemBackupPayload,
} from "../lib/backup.js";

export const systemRoute = new Hono<AppContext>();

systemRoute.use("*", requireAuth(), requireAccessLevel("system_admin"));

async function dumpAllTables(db: D1Database): Promise<SystemBackupPayload["tables"]> {
  const tables: SystemBackupPayload["tables"] = {};
  for (const name of INSERT_TABLES) {
    const res = await db.prepare(`SELECT * FROM ${name}`).all();
    tables[name] = (res.results ?? []) as Record<string, unknown>[];
  }
  return tables;
}

function tableCounts(tables: SystemBackupPayload["tables"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, rows] of Object.entries(tables)) out[k] = rows.length;
  return out;
}

function newBackupId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function restorePayload(db: D1Database, payload: SystemBackupPayload): Promise<void> {
  if (!payload?.tables || typeof payload.tables !== "object") {
    throw new AppError("ACCESS_FORBIDDEN");
  }

  // Wipe operational data only — never touch system_backups
  for (const name of WIPE_TABLES) {
    await db.prepare(`DELETE FROM ${name}`).run();
  }

  for (const name of INSERT_TABLES) {
    const rows = payload.tables[name] ?? [];
    for (const row of rows) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      const placeholders = cols.map(() => "?").join(",");
      const values = cols.map((c) => {
        const v = row[c];
        if (v != null && typeof v === "object") return JSON.stringify(v);
        return v as string | number | null;
      });
      await db
        .prepare(`INSERT INTO ${name} (${cols.join(",")}) VALUES (${placeholders})`)
        .bind(...values)
        .run();
    }
  }
}

/** Create backup, store (if size allows), return full payload for download. */
systemRoute.post("/backup", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{ label?: string }>().catch(() => ({} as { label?: string }));
  const tables = await dumpAllTables(c.env.DB);
  const createdAt = new Date().toISOString();
  const payload: SystemBackupPayload = {
    version: BACKUP_VERSION,
    createdAt,
    createdBy: auth.patroller.call_sign,
    tables,
  };
  const payloadStr = JSON.stringify(payload);
  const byteSize = new TextEncoder().encode(payloadStr).byteLength;
  const counts = tableCounts(tables);
  const id = newBackupId();
  let stored = false;

  if (byteSize <= MAX_STORED_BACKUP_BYTES) {
    const orm = getDb(c.env);
    await orm.insert(systemBackups).values({
      id,
      createdAt,
      createdByCallSign: auth.patroller.call_sign,
      createdByPatrollerId: auth.patroller.patroller_id,
      label: body.label?.trim() || null,
      byteSize,
      tableCounts: counts,
      payload: payloadStr,
    });
    stored = true;
  }

  await logAudit(getDb(c.env), "system.backup.created", auth, {
    backup_id: id,
    byte_size: byteSize,
    stored,
    counts,
  });

  return c.json({
    id,
    createdAt,
    stored,
    byteSize,
    tableCounts: counts,
    payload,
    note: stored
      ? "Backup stored on server (seed-safe) and ready to download."
      : "Backup too large to store on server — download and keep this file. Seed still cannot touch stored backups.",
  });
});

systemRoute.get("/backups", async (c) => {
  const orm = getDb(c.env);
  const rows = await orm
    .select({
      id: systemBackups.id,
      createdAt: systemBackups.createdAt,
      createdByCallSign: systemBackups.createdByCallSign,
      label: systemBackups.label,
      byteSize: systemBackups.byteSize,
      tableCounts: systemBackups.tableCounts,
    })
    .from(systemBackups)
    .orderBy(desc(systemBackups.createdAt))
    .limit(50);
  return c.json({ results: rows });
});

systemRoute.get("/backups/:id", async (c) => {
  const id = c.req.param("id");
  const orm = getDb(c.env);
  const row = await orm.query.systemBackups.findFirst({ where: eq(systemBackups.id, id) });
  if (!row) throw new AppError("MEMBERS_NO_RESULTS");
  return c.json({
    id: row.id,
    createdAt: row.createdAt,
    createdByCallSign: row.createdByCallSign,
    label: row.label,
    byteSize: row.byteSize,
    tableCounts: row.tableCounts,
    payload: JSON.parse(row.payload) as SystemBackupPayload,
  });
});

systemRoute.delete("/backups/:id", async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const orm = getDb(c.env);
  await orm.delete(systemBackups).where(eq(systemBackups.id, id));
  await logAudit(orm, "system.backup.deleted", auth, { backup_id: id });
  return c.json({ ok: true });
});

/** Restore from stored backup id OR uploaded payload body. */
systemRoute.post("/restore", async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json<{
    backup_id?: string;
    payload?: SystemBackupPayload;
    confirm?: string;
    source?: string;
  }>();
  const isProd = (c.env.ENV ?? "").toLowerCase() === "production";
  const okConfirm = body.confirm === "RESTORE" || (isProd && body.confirm === "RESTORE_PRODUCTION");
  if (!okConfirm) throw new AppError("ACCESS_FORBIDDEN");
  if (isProd && body.confirm !== "RESTORE_PRODUCTION") {
    throw new AppError("ACCESS_FORBIDDEN");
  }

  let payload: SystemBackupPayload | null = null;
  if (body.backup_id) {
    const orm = getDb(c.env);
    const row = await orm.query.systemBackups.findFirst({ where: eq(systemBackups.id, body.backup_id) });
    if (!row) throw new AppError("MEMBERS_NO_RESULTS");
    payload = JSON.parse(row.payload) as SystemBackupPayload;
  } else if (body.payload) {
    payload = body.payload;
  }
  if (!payload) throw new AppError("ACCESS_FORBIDDEN");

  // Safety net: snapshot current DB into system_backups before wipe (when size allows).
  try {
    const preTables = await dumpAllTables(c.env.DB);
    const prePayload: SystemBackupPayload = {
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: auth.patroller.call_sign,
      tables: preTables,
    };
    const preStr = JSON.stringify(prePayload);
    const preSize = new TextEncoder().encode(preStr).byteLength;
    if (preSize <= MAX_STORED_BACKUP_BYTES) {
      await getDb(c.env).insert(systemBackups).values({
        id: newBackupId(),
        createdAt: prePayload.createdAt,
        createdByCallSign: auth.patroller.call_sign,
        createdByPatrollerId: auth.patroller.patroller_id,
        label: `pre-restore ${body.source ?? "manual"}`,
        byteSize: preSize,
        tableCounts: tableCounts(preTables),
        payload: preStr,
      });
    }
  } catch {
    /* best-effort pre-backup */
  }

  await restorePayload(c.env.DB, payload);
  await logAudit(getDb(c.env), "system.backup.restored", auth, {
    backup_id: body.backup_id ?? null,
    created_at: payload.createdAt,
    created_by: payload.createdBy,
    source: body.source ?? null,
    env: c.env.ENV ?? null,
  });

  return c.json({ ok: true, restoredAt: new Date().toISOString(), env: c.env.ENV ?? null });
});

/** CSV pack for all tables (re-import / archive). */
systemRoute.get("/export/csv", async (c) => {
  const auth = getAuth(c);
  const tables = await dumpAllTables(c.env.DB);
  const files: Record<string, string> = {};
  for (const name of INSERT_TABLES) {
    files[`${name}.csv`] = rowsToCsv(tables[name] ?? []);
  }

  // Import-friendly directory CSVs (match admin import columns)
  const members = tables.patrollers ?? [];
  files["members-import.csv"] = rowsToCsv(
    members.map((r) => ({
      call_sign: r.call_sign,
      name: r.name,
      phone: r.phone ?? "",
      address: r.address ?? "",
      access_level: r.access_level,
      sector_id: r.sector_id,
      status: r.status,
      password_hash: r.password_hash,
    })),
  );
  const residents = tables.residents ?? [];
  files["residents-import.csv"] = rowsToCsv(
    residents.map((r) => ({
      name: r.name,
      phone: r.phone,
      address: r.address,
      sector_id: r.sector_id,
    })),
  );
  const vehicles = tables.vehicles ?? [];
  files["vehicles-import.csv"] = rowsToCsv(
    vehicles.map((r) => ({
      registration: r.registration,
      description: r.description ?? "",
      last_odometer: r.last_odometer,
      status: r.status,
      sector_id: r.sector_id ?? "",
    })),
  );
  const emergency = tables.emergency_services ?? [];
  files["emergency-services-import.csv"] = rowsToCsv(
    emergency.map((r) => ({
      name: r.name,
      service_type: r.service_type,
      primary_number: r.primary_number,
      secondary_number: r.secondary_number ?? "",
      address: r.address ?? "",
      priority: r.priority,
      sensitive: r.sensitive,
    })),
  );
  const sectors = tables.sectors ?? [];
  files["sectors-import.csv"] = rowsToCsv(
    sectors.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code ?? "",
      cpf_id: r.cpf_id,
    })),
  );

  await logAudit(getDb(c.env), "system.csv.exported", auth, {
    file_count: Object.keys(files).length,
  });

  return c.json({
    exportedAt: new Date().toISOString(),
    files,
  });
});
