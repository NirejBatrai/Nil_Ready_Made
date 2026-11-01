/**
 * Business day and clock time in Asia/Bangkok (decision 0002 §4, decision 0004). Uses the IANA
 * zone through `Intl`, not a fixed offset; Thailand has no daylight saving (always UTC+7). The
 * business day is the calendar date there, so it changes at midnight Bangkok time.
 *
 * Browser-importable (pure functions), but every business day that is STORED is computed on the
 * server from the server clock; the browser never sends a date or a time.
 */

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  parts.find((p) => p.type === type)?.value ?? "";

/** "YYYY-MM-DD" of `at` in Asia/Bangkok. */
export function bangkokDay(at: Date): string {
  const parts = dayFormat.formatToParts(at);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** "HH:mm" (24-hour) of `at` in Asia/Bangkok. */
export function bangkokTime(at: Date): string {
  const parts = timeFormat.formatToParts(at);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

/**
 * A real calendar date written as "YYYY-MM-DD" between 2020 and 2100, or `null`. Never throws
 * (used by input validators).
 */
export function parseBusinessDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  if (y < 2020 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? value
    : null;
}
