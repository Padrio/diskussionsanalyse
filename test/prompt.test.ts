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

test("applyBudget keeps article + highest-scored comments, drops the rest, flags truncated", () => {
  const many: ExtractionResult = {
    ...base,
    article: { text: "A".repeat(40) }, // ~10 tokens, always kept
    comments: [
      { author: "low", text: "x".repeat(4000), score: 1, depth: 0 }, // ~1007 tokens
      { author: "high", text: "y".repeat(4000), score: 999, depth: 0 }, // ~1007 tokens
    ],
    stats: { commentCount: 2, charCount: 8040 },
  };
  // cap fits article + overhead + exactly one big comment, not both
  const out = applyBudget(many, 1300);
  expect(out.truncated).toBe(true);
  expect(out.comments).toHaveLength(1);
  expect(out.comments[0].author).toBe("high"); // highest score retained first
  expect(out.stats.commentCount).toBe(1);
});
