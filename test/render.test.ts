import { expect, test } from "vitest";
import { renderMarkdown, splitSections } from "../src/sidebar/render";

test("renders markdown and strips dangerous HTML", () => {
  const html = renderMarkdown("# Hi\n\n<img src=x onerror=alert(1)>**b**");
  expect(html).toContain("<strong>b</strong>");
  expect(html).not.toContain("onerror");
});

test("splits into ## sections and flags the Bias section", () => {
  const md = "## Kurzüberblick\nA\n\n## Bias & Tendenz\nB";
  const secs = splitSections(md);
  expect(secs).toHaveLength(2);
  expect(secs[0].title).toBe("Kurzüberblick");
  expect(secs[1].isBias).toBe(true);
});
