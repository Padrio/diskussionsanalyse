import { expect, test } from "vitest";
import { formatRelative } from "../src/lib/dates";

const NOW = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("under a minute reads 'gerade eben'", () => {
  expect(formatRelative(NOW - 30 * SEC, NOW)).toBe("gerade eben");
});

test("minutes", () => {
  expect(formatRelative(NOW - 5 * MIN, NOW)).toBe("vor 5 Min.");
});

test("hours", () => {
  expect(formatRelative(NOW - 3 * HOUR, NOW)).toBe("vor 3 Std.");
});

test("exactly one day is singular", () => {
  expect(formatRelative(NOW - 25 * HOUR, NOW)).toBe("vor 1 Tag");
});

test("multiple days are plural", () => {
  expect(formatRelative(NOW - 3 * DAY, NOW)).toBe("vor 3 Tagen");
});

test("a week or more falls back to an absolute date (no 'vor')", () => {
  const out = formatRelative(NOW - 30 * DAY, NOW);
  expect(out).not.toMatch(/vor/);
  expect(out.length).toBeGreaterThan(0);
});

test("future timestamps (clock skew) read 'gerade eben'", () => {
  expect(formatRelative(NOW + 10 * SEC, NOW)).toBe("gerade eben");
});
