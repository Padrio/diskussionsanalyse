import { expect, test } from "vitest";
import { applyBudget, buildUserMessage } from "../src/lib/prompt";
import type { ExtractionResult } from "../src/lib/types";

const base: ExtractionResult = {
  url: "https://news.ycombinator.com/item?id=1",
  title: "Ask HN: Remote work?",
  siteType: "hackernews",
  article: { text: "Original post body." },
  comments: [
    { author: "alice", text: "Pro remote.", score: 142, depth: 0 },
    { author: "bob", text: "Depends on role.", score: 38, depth: 1 },
  ],
  stats: { commentCount: 2, charCount: 100 },
  truncated: false,
};

test("buildUserMessage includes header, article and formatted comments", () => {
  const msg = buildUserMessage(base);
  expect(msg).toContain("QUELLE: https://news.ycombinator.com/item?id=1");
  expect(msg).toContain("TITEL: Ask HN: Remote work?");
  expect(msg).toContain("TYP: hackernews");
  expect(msg).toContain("=== BEITRAG / ARTIKEL ===");
  expect(msg).toContain("Original post body.");
  expect(msg).toContain("=== KOMMENTARE (2) ===");
  expect(msg).toContain("[alice · 142▲ · Ebene 0]");
  expect(msg).toContain("[bob · 38▲ · Ebene 1]");
  expect(msg).not.toContain("HINWEIS: Inhalt wurde");
});

test("buildUserMessage shows truncation notice when flagged", () => {
  expect(buildUserMessage({ ...base, truncated: true })).toContain("HINWEIS: Inhalt wurde");
});

test("applyBudget keeps everything when under cap", () => {
  const out = applyBudget(base, 100_000);
  expect(out.truncated).toBe(false);
  expect(out.comments).toHaveLength(2);
});

test("applyBudget shortens long comments before dropping them and keeps capture count", () => {
  const many: ExtractionResult = {
    ...base,
    article: { text: "A".repeat(40) }, // ~10 tokens, always kept
    comments: [
      { author: "low", text: "x".repeat(4000), score: 1, depth: 0 }, // ~1007 tokens
      { author: "high", text: "y".repeat(4000), score: 999, depth: 0 }, // ~1007 tokens
    ],
    stats: { commentCount: 2, charCount: 8040 },
  };
  // Both threads fit after text is shortened.
  const out = applyBudget(many, 1300);
  expect(out.truncated).toBe(true);
  expect(out.comments).toHaveLength(2);
  expect(out.comments.map((c) => c.author)).toEqual(["low", "high"]); // source order retained
  expect(out.comments[0].text.length).toBeLessThan(4000);
  expect(out.stats.commentCount).toBe(2); // source capture count is never overwritten
  expect(out.coverage).toMatchObject({ captured: 2, selected: 2, shortenedComments: 2 });
});

test("large discussions draw from separate threads, keep parents and original order", () => {
  const comments = Array.from({ length: 20 }, (_, i) => ({
    author: `root-${i}`, text: `thread ${i} ` + "x".repeat(4000), depth: 0, score: 20 - i,
  }));
  comments.splice(1, 0, { author: "reply", text: "answer " + "y".repeat(4000), depth: 1, score: 999 });
  const out = applyBudget({ ...base, comments, stats: { commentCount: comments.length, charCount: 0 } }, 1800);
  expect(out.comments.length).toBeLessThan(comments.length);
  expect(out.comments.some((c) => c.author === "reply")).toBe(true);
  expect(out.comments.some((c) => c.author === "root-0")).toBe(true);
  expect(out.comments.map((c) => Number(c.id!.slice(1)))).toEqual(
    [...out.comments.map((c) => Number(c.id!.slice(1)))].sort((a, b) => a - b),
  );
  expect(out.coverage?.captured).toBe(21);
  expect(buildUserMessage(out)).toContain("Keine Mehrheits- oder Prozentbehauptungen");
});

test("long article yields space to comments and reports the cut", () => {
  const out = applyBudget({
    ...base,
    article: { text: "A".repeat(30000) },
    comments: [{ author: "voice", text: "B".repeat(1000), depth: 0 }],
    stats: { commentCount: 1, charCount: 31000 },
  }, 2000);
  expect(out.coverage?.articleTruncated).toBe(true);
  expect(out.article!.text.length).toBeLessThan(30000);
  expect(out.comments).toHaveLength(1);
  expect(out.coverage?.selected).toBe(1);
});

test("sampling gives distinct authors room even when one author has higher scores", () => {
  const comments = Array.from({ length: 12 }, (_, i) => ({
    author: i < 6 ? "repeat" : `unique-${i}`,
    text: "x".repeat(4000), depth: 0, score: i < 6 ? 100 - i : 1,
  }));
  const out = applyBudget({ ...base, article: null, comments,
    stats: { commentCount: comments.length, charCount: 48000 } }, 750);
  expect(out.comments.length).toBeLessThan(comments.length);
  expect(out.comments.some((c) => c.author === "repeat")).toBe(true);
  expect(out.comments.some((c) => c.author?.startsWith("unique-"))).toBe(true);
});
