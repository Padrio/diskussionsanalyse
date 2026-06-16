import browser from "webextension-polyfill";
import type { Settings } from "./types";
import metaPrompt from "../assets/meta-prompt.md?raw";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-opus-4-8",
  maxInputTokens: 150_000,
  maxOutputTokens: 8_000,
  systemPrompt: metaPrompt,
  language: "Deutsch",
  theme: "system",
};

const KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const got = (await browser.storage.local.get(KEY)) as { settings?: Partial<Settings> };
  return { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
}
