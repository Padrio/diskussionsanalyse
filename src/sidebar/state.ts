import type { ExtractionResult, UiError } from "../lib/types";

export type State =
  | { name: "empty"; needsKey: boolean }
  | { name: "extracting" }
  | { name: "thinking"; extraction: ExtractionResult }
  | { name: "confirm"; extraction: ExtractionResult; inputTokens: number } // count_tokens gate
  | { name: "result"; extraction: ExtractionResult } // streaming + done; the live
  // analysis text and Q&A thread are managed incrementally outside the store.
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
