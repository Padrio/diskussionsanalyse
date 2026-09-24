import browser from "webextension-polyfill";
import type { Settings } from "./types";
import metaPrompt from "../assets/meta-prompt.md?raw";
import { MODEL_CATALOG } from "./models";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-opus-5-5",
  maxInputTokens: 150_000,
  maxOutputTokens: 8_000,
  systemPrompt: metaPrompt,
  language: "Deutsch",
  theme: "system",
};

const KEY = "settings";
const PRIOR_DEFAULT_PROMPT_HASH = 2532407071;

function promptHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export async function getSettings(): Promise<Settings> {
  const got = (await browser.storage.local.get(KEY)) as { settings?: Partial<Settings> };
  const stored = got.settings ?? {};
  // Existing installs stored the bundled default as text; update only that exact
  // version. User-edited prompts remain untouched.
  const systemPrompt = stored.systemPrompt && promptHash(stored.systemPrompt) === PRIOR_DEFAULT_PROMPT_HASH
    ? metaPrompt : stored.systemPrompt;
  const settings = { ...DEFAULT_SETTINGS, ...stored, ...(systemPrompt ? { systemPrompt } : {}) };
  delete (settings as Settings & { tokenGateThreshold?: number }).tokenGateThreshold;
  if (!(settings.model in MODEL_CATALOG)) settings.model = DEFAULT_SETTINGS.model;
  return settings;
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
}
