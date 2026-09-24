import type { StreamEvent } from "./types";

export interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Anthropic stream usage values are cumulative within one request. */
export function updateRequestUsage(current: RequestUsage, event: StreamEvent): RequestUsage {
  if (event.type !== "usage") return current;
  return {
    inputTokens: event.inputTokens ?? current.inputTokens,
    outputTokens: event.outputTokens ?? current.outputTokens,
  };
}
