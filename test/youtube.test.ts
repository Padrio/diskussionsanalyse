import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractYouTube } from "../src/content/extractors/youtube";

test("extracts title, description and ytInitialData comments", () => {
  const doc = new DOMParser().parseFromString(
    readFileSync("test/fixtures/youtube.html", "utf8"),
    "text/html",
  );
  const r = extractYouTube(doc, "https://www.youtube.com/watch?v=abc");
  expect(r.siteType).toBe("youtube");
  expect(r.title).toBe("Cooles Video");
  expect(r.article?.text).toMatch(/Beschreibung/);
  expect(r.comments.map((c) => c.author)).toEqual(["u1", "u2"]);
  expect(r.comments[0].score).toBe(12);
});
