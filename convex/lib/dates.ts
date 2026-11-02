export const DAY_MS = 86_400_000;

/** Today's date as "YYYY-MM-DD" in UTC. */
export function todayISO(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** True for a real calendar date in "YYYY-MM-DD" form (rejects e.g. "2026-02-30"). */
export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const time = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(time) && todayISO(time) === s;
}
