import { expect, test } from "vitest";
import { mapHttpError } from "../src/lib/errors";

test("401 → auth error, opens options", () => {
  const e = mapHttpError(401);
  expect(e.code).toBe("auth");
  expect(e.openOptions).toBe(true);
  expect(e.retryable).toBe(false);
  expect(e.message).toMatch(/API-Key/);
});

test("403 → model permission", () => {
  expect(mapHttpError(403).code).toBe("permission");
});

test("413 → too large", () => {
  expect(mapHttpError(413).code).toBe("too_large");
});

test("429 → rate limit carries retry-after seconds", () => {
  const e = mapHttpError(429, "30");
  expect(e.code).toBe("rate_limit");
  expect(e.retryable).toBe(true);
  expect(e.retryAfterSec).toBe(30);
});

test("529 and 500 → retryable server error", () => {
  expect(mapHttpError(529).retryable).toBe(true);
  expect(mapHttpError(500).retryable).toBe(true);
});

test("unknown status → generic", () => {
  expect(mapHttpError(418).code).toBe("unknown");
});
