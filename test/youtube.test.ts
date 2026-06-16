import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  extractYouTube,
  nextContinuationToken,
  parseInnertubeComments,
} from "../src/content/extractors/youtube";

test("extracts title, description and ytInitialData comments (legacy fallback)", async () => {
  const doc = new DOMParser().parseFromString(
    readFileSync("test/fixtures/youtube.html", "utf8"),
    "text/html",
  );
  const r = await extractYouTube(doc, "https://www.youtube.com/watch?v=abc");
  expect(r.siteType).toBe("youtube");
  expect(r.title).toBe("Cooles Video");
  expect(r.article?.text).toMatch(/Beschreibung/);
  expect(r.comments.map((c) => c.author)).toEqual(["u1", "u2"]);
  expect(r.comments[0].score).toBe(12);
});

test("reads ytInitialData in window[...] form with nested braces and string-braces", async () => {
  // Real YouTube uses `window["ytInitialData"] = {…}`; the "}" inside a string value
  // must not terminate the brace scan early.
  const html =
    `<!doctype html><html><head><title>V - YouTube</title><meta name="title" content="V"></head><body>` +
    `<script>window["ytInitialData"] = {"a":{"b":{"c":1}},"d":"}","__comments":[{"author":"z","text":"hi","likes":5}]};</script>` +
    `</body></html>`;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const r = await extractYouTube(doc, "https://www.youtube.com/watch?v=z");
  expect(r.comments).toEqual([{ author: "z", text: "hi", score: 5, depth: 0 }]);
});

test("parseInnertubeComments reads the new commentEntityPayload format", () => {
  const data = {
    frameworkUpdates: {
      entityBatchUpdate: {
        mutations: [
          {
            payload: {
              commentEntityPayload: {
                key: "k1",
                properties: { content: { content: "Top comment" } },
                author: { displayName: "alice" },
                toolbar: { likeCountNotliked: "12" },
              },
            },
          },
        ],
      },
    },
    onResponseReceivedEndpoints: [
      {
        reloadContinuationItemsCommand: {
          continuationItems: [
            { commentThreadRenderer: { commentViewModel: { commentViewModel: { commentKey: "k1" } } } },
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "T2" } } } },
          ],
        },
      },
    ],
  };
  expect(parseInnertubeComments(data)).toEqual([
    { author: "alice", text: "Top comment", score: 12, depth: 0 },
  ]);
});

test("parseInnertubeComments reads the legacy commentRenderer format and parses K-counts", () => {
  const data = {
    onResponseReceivedEndpoints: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            {
              commentThreadRenderer: {
                comment: {
                  commentRenderer: {
                    authorText: { simpleText: "bob" },
                    contentText: { runs: [{ text: "Hello " }, { text: "world" }] },
                    voteCount: { simpleText: "1.2K" },
                  },
                },
              },
            },
          ],
        },
      },
    ],
  };
  expect(parseInnertubeComments(data)).toEqual([
    { author: "bob", text: "Hello world", score: 1200, depth: 0 },
  ]);
});

test("nextContinuationToken finds the pagination token, undefined when absent", () => {
  const data = {
    onResponseReceivedEndpoints: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } },
          ],
        },
      },
    ],
  };
  expect(nextContinuationToken(data)).toBe("NEXT");
  expect(nextContinuationToken({})).toBeUndefined();
});
