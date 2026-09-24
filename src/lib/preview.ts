import type { ChatMessage } from "./anthropic";
import type { ExtractionResult, Settings } from "./types";
import { price } from "./models";

export interface PreparedRequest {
  kind: "analysis" | "followup";
  settings: Settings;
  messages: ChatMessage[];
  extraction: ExtractionResult;
  question?: string;
  droppedTurns: number;
  inputTokens: number;
  tokenSource: "api" | "local";
  warning?: string;
  outputLow: number;
  outputHigh: number;
  outputBasis: "history" | "scenario";
}

export function outputForecast(max: number, samples: number[]): Pick<PreparedRequest, "outputLow" | "outputHigh" | "outputBasis"> {
  if (samples.length < 5) {
    return { outputLow: Math.round(max * 0.25), outputHigh: Math.round(max * 0.75), outputBasis: "scenario" };
  }
  const sorted = samples.slice(0, 20).sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
  return { outputLow: Math.min(max, quantile(0.25)), outputHigh: Math.min(max, quantile(0.75)), outputBasis: "history" };
}

export function previewCosts(p: PreparedRequest) {
  const model = p.settings.model;
  return {
    input: price(model, p.inputTokens, 0),
    low: price(model, p.inputTokens, p.outputLow),
    high: price(model, p.inputTokens, p.outputHigh),
    max: price(model, p.inputTokens, p.settings.maxOutputTokens),
  };
}
