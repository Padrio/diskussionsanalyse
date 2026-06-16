import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractDiscussion } from "../src/content/extract-core";

const parse = (f: string) =>
  new DOMParser().parseFromString(readFileSync(`test/fixtures/${f}`, "utf8"), "text/html");

test("routes by hostname", async () => {
  expect(
    (await extractDiscussion(parse("hn.html"), "https://news.ycombinator.com/item?id=1")).siteType,
  ).toBe("hackernews");
  expect(
    (await extractDiscussion(parse("youtube.html"), "https://www.youtube.com/watch?v=a")).siteType,
  ).toBe("youtube");
  expect(
    (await extractDiscussion(parse("generic-article.html"), "https://news.example.com/x")).siteType,
  ).toBe("generic");
});
