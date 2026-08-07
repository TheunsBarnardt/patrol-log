/**
 * Parse SQLite `datetime('now')` / text timestamps that are UTC but lack a `Z` suffix.
 * Without this, JS treats `"YYYY-MM-DD HH:MM:SS"` as local time (e.g. SA shows −2h).
 */
export function parseSqliteUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const withT = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const d = new Date(withT.endsWith("Z") ? withT : `${withT}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
