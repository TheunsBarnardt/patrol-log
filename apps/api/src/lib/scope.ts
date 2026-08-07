import { and, eq, type SQL } from "drizzle-orm";
import type { AuthenticatedContext } from "../env.js";

/** Only system_admin sees and manages all sectors. Sector admins stay isolated. */
export function isSystemAdmin(auth: AuthenticatedContext): boolean {
  return auth.patroller.access_level === "system_admin";
}

export function isCpfWide(auth: AuthenticatedContext): boolean {
  return isSystemAdmin(auth);
}

/** Sector id for scoped roles; null means CPF-wide (admin). */
export function scopedSectorId(auth: AuthenticatedContext): string | null {
  return isCpfWide(auth) ? null : auth.patroller.sector_id;
}

/** AND-able filter for tables with cpfId + sectorId columns. */
export function tenantScope(
  auth: AuthenticatedContext,
  cols: { cpfId: any; sectorId?: any },
): SQL {
  const cpf = eq(cols.cpfId, auth.patroller.cpf_id);
  const sectorId = scopedSectorId(auth);
  if (!sectorId || !cols.sectorId) return cpf;
  return and(cpf, eq(cols.sectorId, sectorId))!;
}

export function assertSectorAccess(
  auth: AuthenticatedContext,
  targetSectorId: string | null | undefined,
): boolean {
  if (isCpfWide(auth)) return true;
  if (!targetSectorId) return false;
  return targetSectorId === auth.patroller.sector_id;
}
