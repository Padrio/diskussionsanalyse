import { DEFAULT_SETTINGS, getSettings, setSettings } from "../lib/storage";
import type { ModelId, Theme } from "../lib/types";
import { MODEL_CATALOG } from "../lib/models";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

async function load(): Promise<void> {
  const s = await getSettings();
  applyTheme(s.theme);
  $<HTMLInputElement>("apiKey").value = s.apiKey;
  const select = $<HTMLSelectElement>("model");
  select.replaceChildren();
  for (const [group, label] of [["current", "Aktuelle Modelle"], ["older", "Ältere Modelle"]] as const) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    for (const [id, model] of Object.entries(MODEL_CATALOG)) {
      if (model.group !== group) continue;
      const option = document.createElement("option");
      option.value = id;
      option.textContent = model.label;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = s.model;
  $<HTMLInputElement>("maxInput").value = String(s.maxInputTokens);
  $<HTMLInputElement>("maxOutput").value = String(s.maxOutputTokens);
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
