/** Rough heuristic: ~4 chars per token. Used only for the truncation budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
