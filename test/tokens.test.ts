import { expect, test } from "vitest";
import { estimateTokens } from "../src/lib/tokens";

test("estimates ~chars/4, rounded up", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
});
