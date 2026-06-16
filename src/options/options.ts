import { DEFAULT_SETTINGS, getSettings, setSettings } from "../lib/storage";
import type { ModelId, Theme } from "../lib/types";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Gate threshold: empty falls back to default; 0 is valid ("never gate"). */
const parseGate = (v: string): number => {
  const t = v.trim();
  if (t === "") return DEFAULT_SETTINGS.tokenGateThreshold;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.tokenGateThreshold;
};

function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

async function load(): Promise<void> {
  const s = await getSettings();
  applyTheme(s.theme);
  $<HTMLInputElement>("apiKey").value = s.apiKey;
  $<HTMLSelectElement>("model").value = s.model;
  $<HTMLInputElement>("maxInput").value = String(s.maxInputTokens);
  $<HTMLInputElement>("maxOutput").value = String(s.maxOutputTokens);
  $<HTMLInputElement>("tokenGate").value = String(s.tokenGateThreshold);
  $<HTMLTextAreaElement>("systemPrompt").value = s.systemPrompt;
  $<HTMLInputElement>("language").value = s.language;
  $<HTMLSelectElement>("theme").value = s.theme;
}

async function save(): Promise<void> {
  const theme = $<HTMLSelectElement>("theme").value as Theme;
  await setSettings({
    apiKey: $<HTMLInputElement>("apiKey").value.trim(),
    model: $<HTMLSelectElement>("model").value as ModelId,
    maxInputTokens: Number($<HTMLInputElement>("maxInput").value) || DEFAULT_SETTINGS.maxInputTokens,
    maxOutputTokens:
      Number($<HTMLInputElement>("maxOutput").value) || DEFAULT_SETTINGS.maxOutputTokens,
    tokenGateThreshold: parseGate($<HTMLInputElement>("tokenGate").value),
    systemPrompt: $<HTMLTextAreaElement>("systemPrompt").value,
    language: $<HTMLInputElement>("language").value.trim() || "Deutsch",
    theme,
  });
  applyTheme(theme);
  const status = $<HTMLSpanElement>("status");
  status.textContent = "Gespeichert ✓";
  setTimeout(() => {
    status.textContent = "";
  }, 1600);
}

$("save").addEventListener("click", () => void save());
$("resetPrompt").addEventListener("click", () => {
  $<HTMLTextAreaElement>("systemPrompt").value = DEFAULT_SETTINGS.systemPrompt;
});
$("theme").addEventListener("change", () =>
  applyTheme($<HTMLSelectElement>("theme").value as Theme),
);

void load();
