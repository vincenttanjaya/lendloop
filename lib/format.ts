const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "30 seconds ago", "1 minute ago", "2 hours ago", "3 days ago". */
export function relativeTime(timestampMs: number, now: number = Date.now()): string {
  const seconds = Math.round((timestampMs - now) / 1000);
  if (Math.abs(seconds) < 60) return relative.format(seconds, "second");
  const minutes = Math.trunc(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.trunc(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.trunc(hours / 24), "day");
}

/** "2026-11-02" → "Nov 2, 2026" (read as a UTC calendar date, so no timezone shift). */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}
