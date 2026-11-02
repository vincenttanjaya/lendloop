import { expect, test } from "vitest";
import { formatDate, relativeTime } from "../format";

const now = Date.parse("2026-11-02T12:00:00Z");

test("relativeTime renders minutes, hours and days ago", () => {
  expect(relativeTime(now - 30_000, now)).toBe("30 seconds ago");
  expect(relativeTime(now - 90_000, now)).toBe("1 minute ago");
  expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 days ago");
});

test("formatDate renders an ISO date in UTC", () => {
  expect(formatDate("2026-11-02")).toBe("Nov 2, 2026");
  expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
});
