import { expect, test } from "vitest";
import { outputForecast, previewCosts } from "../src/lib/preview";
import { DEFAULT_SETTINGS } from "../src/lib/storage";
import { updateRequestUsage } from "../src/lib/usage";
import type { PreparedRequest } from "../src/lib/preview";

test("cold preview labels output values as scenarios and prices input, range and cap", () => {
  const forecast = outputForecast(8000, []);
  expect(forecast).toEqual({ outputLow: 2000, outputHigh: 6000, outputBasis: "scenario" });
  const p = {
    settings: { ...DEFAULT_SETTINGS, model: "claude-opus-5-5" },
    inputTokens: 75000,
    ...forecast,
  } as PreparedRequest;
  expect(previewCosts(p)).toEqual({ input: 0.3, low: 0.34, high: 0.42, max: 0.46 });
});

test("output forecast uses completed samples once five are available", () => {
  expect(outputForecast(8000, [1000, 2000, 3000, 4000, 5000]))
    .toEqual({ outputLow: 2000, outputHigh: 4000, outputBasis: "history" });
  expect(outputForecast(2500, [1000, 2000, 3000, 4000, 5000]).outputHigh).toBe(2500);
});

test("cumulative stream usage replaces the earlier value within one request", () => {
  let usage = { inputTokens: 0, outputTokens: 0 };
  usage = updateRequestUsage(usage, { type: "usage", inputTokens: 123, outputTokens: 1 });
  usage = updateRequestUsage(usage, { type: "usage", outputTokens: 12 });
  usage = updateRequestUsage(usage, { type: "usage", outputTokens: 20 });
  expect(usage).toEqual({ inputTokens: 123, outputTokens: 20 });
});
