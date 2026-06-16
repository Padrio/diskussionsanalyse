import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { extractGeneric } from "../src/content/extractors/generic";

const doc = (f: string) =>
  new DOMParser().parseFromString(readFileSync(`test/fixtures/${f}`, "utf8"), "text/html");

test("extracts article markdown and nested comments", () => {
  const r = extractGeneric(doc("generic-article.html"), "https://ex.com/a");
  expect(r.siteType).toBe("generic");
  expect(r.title).toContain("Klimapolitik");
  expect(r.article?.text).toMatch(/Ausgangslage/);
  expect(r.comments.length).toBeGreaterThanOrEqual(2);
  expect(r.comments.some((c) => c.author === "leser1" && c.depth === 0)).toBe(true);
  expect(r.comments.some((c) => c.author === "leser2" && c.depth === 1)).toBe(true);
});

test("no comment containers → empty comments, article still present", () => {
  const r = extractGeneric(doc("generic-no-comments.html"), "https://ex.com/b");
  expect(r.comments).toHaveLength(0);
  expect(r.article?.text).toBeTruthy();
});
