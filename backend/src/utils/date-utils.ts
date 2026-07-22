/**
 * SQLite's CURRENT_TIMESTAMP/datetime('now') produces UTC values formatted as
 * "YYYY-MM-DD HH:MM:SS" with no timezone marker. JS's Date constructor treats
 * that space-separated (non-ISO) form as local time, silently shifting it by
 * the server's UTC offset. Normalize to ISO-with-Z before parsing so it's
 * always read back as the UTC instant it actually is.
 */
export function parseSqliteUtcTimestamp(value: string): Date {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}
