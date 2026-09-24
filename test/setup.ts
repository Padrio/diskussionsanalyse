// jsdom provides no IndexedDB — install an in-memory implementation so the
// history layer can be exercised in tests (sets globalThis.indexedDB et al.).
import "fake-indexeddb/auto";

export {};
