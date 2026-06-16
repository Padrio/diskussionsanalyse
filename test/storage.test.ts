import { beforeEach, expect, test } from "vitest";
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../src/lib/storage";

beforeEach(async () => {
  await browser.storage.local.clear();
});

test("returns defaults when storage empty", async () => {
  const s = await getSettings();
  expect(s.model).toBe("claude-opus-4-8");
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
