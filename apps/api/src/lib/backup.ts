/** Full-DB backup helpers. system_backups is NEVER wiped by seed. */

export const BACKUP_VERSION = 1;

/** Wipe order for restore (children first). system_backups is intentionally absent. */
export const WIPE_TABLES = [
  "message_channel_members",
  "message_reads",
  "messages",
  "message_channels",
  "push_tokens",
  "audit_log",
  "patrol_escalation_events",
  "patrol_breadcrumbs",
  "patrol_guests",
  "patrol_members",
  "live_pins",
  "patrols",
  "devices",
  "login_attempts",
  "next_of_kin",
  "hotspots",
  "incidents",
  "emergency_services",
  "residents",
  "vehicles",
  "patrollers",
  "sectors",
  "cpfs",
] as const;

/** Insert order for restore (parents first). */
export const INSERT_TABLES = [
  "cpfs",
  "sectors",
  "patrollers",
  "next_of_kin",
  "devices",
  "login_attempts",
  "vehicles",
  "patrols",
  "patrol_guests",
  "patrol_members",
  "patrol_breadcrumbs",
  "patrol_escalation_events",
  "live_pins",
  "residents",
  "emergency_services",
  "hotspots",
  "incidents",
  "audit_log",
  "push_tokens",
  "message_channels",
  "messages",
  "message_reads",
  "message_channel_members",
] as const;

export type BackupTableName = (typeof INSERT_TABLES)[number];

export interface SystemBackupPayload {
  version: number;
  createdAt: string;
  createdBy: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** D1 string column soft limit — skip storing oversized payloads (download still works). */
export const MAX_STORED_BACKUP_BYTES = 1_500_000;

export function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(",")),
  ];
  return lines.join("\r\n");
}
