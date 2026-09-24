import { expect, test } from "vitest";
import { conversationMessages, convoFromRecord, dropOldestFollowup, followupMessages, recordFromConvo } from "../src/lib/conversation";
import type { Convo } from "../src/lib/types";

function liveConvo(): Convo {
  return {
    extraction: {
      url: "https://news.ycombinator.com/item?id=1",
      title: "Test Thread",
      siteType: "hackernews",
      article: { text: "Body" },
      comments: [{ text: "c1", depth: 0 }],
      stats: { commentCount: 1, charCount: 42 },
      truncated: false,
    },
    userMessage: "ARTIKEL …\n\nKOMMENTARE …",
    analysis: "## Überblick\nText",
    qa: [
      { q: "Warum?", a: "Weil." },
      { q: "Und?", a: "Darum." },
    ],
  };
}

test("conversationMessages builds [user, assistant, then each q/a pair] in order", () => {
  const c = liveConvo();
  expect(conversationMessages(c)).toEqual([
    { role: "user", content: c.userMessage },
    { role: "assistant", content: c.analysis },
    { role: "user", content: "Warum?" },
    { role: "assistant", content: "Weil." },
    { role: "user", content: "Und?" },
    { role: "assistant", content: "Darum." },
  ]);
});

test("an unanswered last question yields no trailing assistant turn", () => {
  const c = liveConvo();
  c.qa.push({ q: "offen", a: "" });
  const msgs = conversationMessages(c);
  expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "offen" });
});

test("new follow-up skips unfinished turns and budget trimming retains the new question", () => {
  const c = liveConvo();
  c.qa.push({ q: "Unbeantwortet", a: "" });
  c.qa.push({ q: "Teilantwort", a: "Bruchstück", status: "partial" });
  const messages = followupMessages(c, "Neue Frage");
  expect(messages.at(-1)).toEqual({ role: "user", content: "Neue Frage" });
  expect(messages.some((m) => m.content === "Unbeantwortet")).toBe(false);
  expect(messages.some((m) => m.content === "Teilantwort")).toBe(false);
  const trimmed = dropOldestFollowup(messages);
  expect(trimmed.at(-1)).toEqual({ role: "user", content: "Neue Frage" });
  expect(trimmed.some((m) => m.content === "Warum?")).toBe(false);
  expect(trimmed.some((m) => m.content === "Und?")).toBe(true);
});

test("round-trip record↔convo preserves the API message array (cross-path symmetry)", () => {
  const live = liveConvo();
  const rec = recordFromConvo(live, { id: "x", model: "claude-opus-4-8", createdAt: 1, updatedAt: 2 });
  const restored = convoFromRecord(rec);
  // The reopened chat MUST rebuild the exact same request messages as the live one.
  expect(conversationMessages(restored)).toEqual(conversationMessages(live));
});

test("recordFromConvo projects the header metadata + content from the convo", () => {
  const live = liveConvo();
  const rec = recordFromConvo(live, {
    id: "abc",
    model: "claude-sonnet-4-6",
    createdAt: 10,
    updatedAt: 20,
  });
  expect(rec).toMatchObject({
    id: "abc",
    model: "claude-sonnet-4-6",
    createdAt: 10,
    updatedAt: 20,
    url: live.extraction.url,
    title: live.extraction.title,
    siteType: "hackernews",
    stats: { commentCount: 1, charCount: 42 },
    userMessage: live.userMessage,
    analysis: live.analysis,
  });
  expect(rec.qa).toEqual(live.qa);
});

test("convoFromRecord reconstructs a minimal extraction (no article/comments stored)", () => {
  const rec = recordFromConvo(liveConvo(), { id: "x", model: "claude-opus-4-8", createdAt: 1, updatedAt: 2 });
  const convo = convoFromRecord(rec);
  expect(convo.extraction).toEqual({
    url: rec.url,
    title: rec.title,
    siteType: rec.siteType,
    stats: rec.stats,
    article: null,
    comments: [],
    truncated: false,
  });
});

test("record qa is decoupled from the source convo (no shared reference)", () => {
  const live = liveConvo();
  const rec = recordFromConvo(live, { id: "x", model: "claude-opus-4-8", createdAt: 1, updatedAt: 2 });
  live.qa[0].a = "MUTATED";
  expect(rec.qa[0].a).toBe("Weil.");
});
