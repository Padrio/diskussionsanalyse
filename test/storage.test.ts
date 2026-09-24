import { beforeEach, expect, test } from "vitest";
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../src/lib/storage";

beforeEach(async () => {
  await browser.storage.local.clear();
});

test("returns defaults when storage empty", async () => {
  const s = await getSettings();
  expect(s.model).toBe("claude-opus-5-5");
  expect(s.maxInputTokens).toBe(DEFAULT_SETTINGS.maxInputTokens);
  expect(s.systemPrompt.length).toBeGreaterThan(50);
  expect(s.apiKey).toBe("");
});

test("setSettings merges a partial patch", async () => {
  await setSettings({ apiKey: "sk-test", model: "claude-haiku-4-5" });
  const s = await getSettings();
  expect(s.apiKey).toBe("sk-test");
  expect(s.model).toBe("claude-haiku-4-5");
  expect(s.theme).toBe(DEFAULT_SETTINGS.theme); // untouched fields keep defaults
});

test("legacy gate setting is discarded and custom prompt remains untouched", async () => {
  await browser.storage.local.set({ settings: {
    tokenGateThreshold: 50000, systemPrompt: "Eigener Prompt", model: "invalid-model",
  } });
  const s = await getSettings();
  expect(s).not.toHaveProperty("tokenGateThreshold");
  expect(s.systemPrompt).toBe("Eigener Prompt");
  expect(s.model).toBe(DEFAULT_SETTINGS.model);
});
