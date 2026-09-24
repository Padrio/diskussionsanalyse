import { beforeEach, expect, test } from "vitest";
import {
  clearAll,
  deleteChat,
  getChat,
  isHistoryAvailable,
  putChat,
  queryChats,
} from "../src/lib/history";
import type { HistoryRecord } from "../src/lib/types";

function rec(id: string, updatedAt: number, over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    siteType: "generic",
    stats: { commentCount: 0, charCount: 0 },
    model: "claude-opus-4-8",
    userMessage: "content",
    analysis: "analysis",
    qa: [],
    ...over,
  };
}

beforeEach(async () => {
  await clearAll();
});

test("isHistoryAvailable is true under fake-indexeddb", () => {
  expect(isHistoryAvailable()).toBe(true);
});

test("put then get round-trips the full record", async () => {
  const r = rec("a", 1);
  await putChat(r);
  expect(await getChat("a")).toEqual(r);
});

test("put with an existing id upserts instead of duplicating", async () => {
  await putChat(rec("a", 1, { analysis: "v1" }));
  await putChat(rec("a", 2, { analysis: "v2" }));
  expect(await queryChats()).toHaveLength(1);
  expect((await getChat("a"))!.analysis).toBe("v2");
});

test("queryChats returns summaries newest-first by updatedAt", async () => {
  await putChat(rec("old", 100));
  await putChat(rec("new", 300));
  await putChat(rec("mid", 200));
  expect((await queryChats()).map((s) => s.id)).toEqual(["new", "mid", "old"]);
});

test("summaries omit the heavy content fields but keep metadata", async () => {
  await putChat(rec("a", 1));
  const [s] = await queryChats();
  expect(s).not.toHaveProperty("userMessage");
  expect(s).not.toHaveProperty("analysis");
  expect(s).not.toHaveProperty("qa");
  expect(s).toMatchObject({ id: "a", title: "Title a", siteType: "generic", model: "claude-opus-4-8" });
});

test("query filters case-insensitively over title, url and content", async () => {
  await putChat(rec("a", 1, { title: "Klimawandel Debatte" }));
  await putChat(rec("b", 2, { url: "https://reddit.com/r/science" }));
  await putChat(rec("c", 3, { userMessage: "tief im Inhalt: Quantencomputer" }));
  await putChat(rec("d", 4, { analysis: "Fazit zur Inflation" }));
  expect((await queryChats("KLIMA")).map((s) => s.id)).toEqual(["a"]);
  expect((await queryChats("reddit")).map((s) => s.id)).toEqual(["b"]);
  expect((await queryChats("quantencomputer")).map((s) => s.id)).toEqual(["c"]);
  expect((await queryChats("inflation")).map((s) => s.id)).toEqual(["d"]);
});

test("an empty query returns everything", async () => {
  await putChat(rec("a", 1));
  await putChat(rec("b", 2));
  expect(await queryChats("")).toHaveLength(2);
  expect(await queryChats("   ")).toHaveLength(2);
});

test("deleteChat removes a single entry", async () => {
  await putChat(rec("a", 1));
  await putChat(rec("b", 2));
  await deleteChat("a");
  expect((await queryChats()).map((s) => s.id)).toEqual(["b"]);
});

test("clearAll empties the store", async () => {
  await putChat(rec("a", 1));
  await clearAll();
  expect(await queryChats()).toEqual([]);
});

test("degrades gracefully (no throw, empty results) when IndexedDB is unavailable", async () => {
  const real = globalThis.indexedDB;
  // @ts-expect-error simulate a context without IndexedDB (private window)
  globalThis.indexedDB = undefined;
  try {
    expect(isHistoryAvailable()).toBe(false);
    await expect(putChat(rec("z", 1))).resolves.toBeUndefined();
    expect(await queryChats()).toEqual([]);
    expect(await getChat("z")).toBeUndefined();
    await expect(deleteChat("z")).resolves.toBeUndefined();
    await expect(clearAll()).resolves.toBeUndefined();
  } finally {
    globalThis.indexedDB = real;
  }
});
