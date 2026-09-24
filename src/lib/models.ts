import type { ModelId } from "./types";

/** Model choices, request capability and standard USD per million tokens. */
export const MODEL_CATALOG: Record<ModelId, {
  label: string; group: "current" | "older"; input: number; output: number; adaptiveThinking: boolean;
}> = {
  "claude-fable-5-1": { label: "Claude Fable 5.1 — höchste Analysetiefe", group: "current", input: 10, output: 50, adaptiveThinking: true },
  "claude-opus-5-5": { label: "Claude Opus 5.5 — Standard", group: "current", input: 4, output: 20, adaptiveThinking: true },
  "claude-sonnet-5": { label: "Claude Sonnet 5 — schnell und günstig", group: "current", input: 2, output: 10, adaptiveThinking: true },
  "claude-haiku-4-5": { label: "Claude Haiku 4.5 — am schnellsten", group: "current", input: 1, output: 5, adaptiveThinking: false },
  "claude-opus-4-8": { label: "Claude Opus 4.8", group: "older", input: 5, output: 25, adaptiveThinking: true },
  "claude-sonnet-4-6": { label: "Claude Sonnet 4.6", group: "older", input: 3, output: 15, adaptiveThinking: true },
};
export const MODEL_PRICES: Record<ModelId, { input: number; output: number }> = MODEL_CATALOG;

export function price(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = MODEL_CATALOG[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
