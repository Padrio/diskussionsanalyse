import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractHackerNews } from "../src/content/extractors/hackernews";

test("extracts HN post and threaded comments with depth", () => {
  const doc = new DOMParser().parseFromString(
    readFileSync("test/fixtures/hn.html", "utf8"),
    "text/html",
  );
  const r = extractHackerNews(doc, "https://news.ycombinator.com/item?id=1");
  expect(r.siteType).toBe("hackernews");
  expect(r.title).toBe("Ask HN: Remote work?");
  expect(r.article?.text).toMatch(/Is remote work here to stay/);
  expect(r.comments).toHaveLength(2);
  expect(r.comments[0]).toMatchObject({ author: "alice", depth: 0 });
  expect(r.comments[1]).toMatchObject({ author: "bob", depth: 1 });
});
