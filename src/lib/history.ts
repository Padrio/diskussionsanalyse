import { openDB, type IDBPDatabase } from "idb";
import type { HistoryRecord, HistorySummary } from "./types";

const DB_NAME = "summarize";
const STORE = "chats";
const VERSION = 1;
const UPDATED_INDEX = "updatedAt";

let dbPromise: Promise<IDBPDatabase | null> | null = null;

/** Whether persistence is usable here (false in e.g. some private windows). */
export function isHistoryAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Lazily open the DB; cache the promise. Resolves to null if IndexedDB is
 *  unavailable or the open fails, so every caller can degrade to a no-op. */
function db(): Promise<IDBPDatabase | null> {
  if (!isHistoryAvailable()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(UPDATED_INDEX, "updatedAt");
      },
    }).catch(() => null);
  }
  return dbPromise;
}

function toSummary(r: HistoryRecord): HistorySummary {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    url: r.url,
    title: r.title,
    siteType: r.siteType,
    stats: r.stats,
    model: r.model,
  };
}

function matches(r: HistoryRecord, needle: string): boolean {
  const hay = [r.title, r.url, r.userMessage, r.analysis, ...r.qa.flatMap((t) => [t.q, t.a])]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

/** Insert or update a chat (keyed by id). No-op when persistence is unavailable. */
export async function putChat(rec: HistoryRecord): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.put(STORE, rec);
}

export async function getChat(id: string): Promise<HistoryRecord | undefined> {
  const d = await db();
  if (!d) return undefined;
  return (await d.get(STORE, id)) as HistoryRecord | undefined;
}

/** Newest-first list of lightweight summaries, optionally filtered by a query
 *  over title/url/content. One cursor pass; heavy fields are dropped per entry
 *  so the returned array stays small regardless of stored content size. */
export async function queryChats(query = ""): Promise<HistorySummary[]> {
  const d = await db();
  if (!d) return [];
  const needle = query.trim().toLowerCase();
  const out: HistorySummary[] = [];
  let cursor = await d.transaction(STORE).store.index(UPDATED_INDEX).openCursor(null, "prev");
  while (cursor) {
    const r = cursor.value as HistoryRecord;
    if (!needle || matches(r, needle)) out.push(toSummary(r));
    cursor = await cursor.continue();
  }
  return out;
}

export async function deleteChat(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.delete(STORE, id);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.clear(STORE);
}

/** Most recent completed output usage for a model, excluding legacy records. */
export async function recentOutputs(model: HistoryRecord["model"], limit = 20): Promise<number[]> {
  const d = await db();
  if (!d) return [];
  const out: number[] = [];
  let cursor = await d.transaction(STORE).store.index(UPDATED_INDEX).openCursor(null, "prev");
  while (cursor && out.length < limit) {
    const r = cursor.value as HistoryRecord;
    if (r.model === model && r.status === "complete" && r.usage?.analysisOutputTokens != null) {
      out.push(r.usage.analysisOutputTokens);
    }
    cursor = await cursor.continue();
  }
  return out;
}
