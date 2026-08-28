/** Keys used to spot likely duplicate directory rows. */

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Digits-only phone key so +2782… and 082… match. */
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (digits.startsWith("27") && digits.length >= 11) return digits.slice(-9);
  if (digits.startsWith("0") && digits.length >= 10) return digits.slice(1);
  return digits;
}

export function duplicateIds<T>(
  rows: T[],
  getId: (row: T) => string,
  getKey: (row: T) => string,
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(getId(row));
    groups.set(key, list);
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    if (list.length > 1) for (const id of list) ids.add(id);
  }
  return ids;
}
