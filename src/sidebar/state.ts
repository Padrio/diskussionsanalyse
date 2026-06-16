import type { ExtractionResult, UiError } from "../lib/types";

export type State =
  | { name: "empty"; needsKey: boolean }
  | { name: "extracting" }
  | { name: "extracted"; extraction: ExtractionResult }
  | { name: "thinking"; extraction: ExtractionResult }
  | { name: "streaming"; extraction: ExtractionResult; markdown: string }
  | { name: "done"; extraction: ExtractionResult; markdown: string; outputTokens?: number }
  | { name: "error"; error: UiError; extraction?: ExtractionResult };

export type Listener = (s: State) => void;

export function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next: State) {
      state = next;
      listeners.forEach((l) => l(state));
    },
    subscribe(l: Listener) {
      listeners.add(l);
      l(state);
      return () => listeners.delete(l);
    },
  };
}
