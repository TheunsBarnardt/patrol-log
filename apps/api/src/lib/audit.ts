// POPIA audit log helper.
// FDL: cross-cutting concern across patroller-login, residents-directory, members-directory

import { auditLog } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { AuthenticatedContext } from "../env.js";

export async function logAudit(
  db: Db,
  action: string,
  auth: AuthenticatedContext | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorPatrollerId: auth?.patroller.patroller_id ?? null,
      action,
      payload,
      ip: auth?.ip ?? null,
      deviceId: auth?.device?.device_id ?? null,
    });
  } catch (err) {
    // Audit failures should never break the request path, but they must be visible in logs.
    console.error("[audit] failed to write audit record", { action, err });
  }
}

// Overload for when auth is passed as an object (not wrapped in AuthenticatedContext)
export async function logAuditRaw(
  db: Db,
  action: string,
  data: {
    patroller_id?: string;
    call_sign?: string;
    access_level?: string;
    cpf_id?: string;
    sector_id?: string;
    device_id?: string;
    ip?: string;
  },
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorPatrollerId: data.patroller_id ?? null,
      action,
      payload,
      ip: data.ip ?? null,
      deviceId: data.device_id ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to write audit record", { action, err });
  }
}
