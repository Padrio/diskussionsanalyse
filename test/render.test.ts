import { expect, test } from "vitest";
import { formatUsage, renderMarkdown, splitSections } from "../src/sidebar/render";

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

test("formatUsage shows input, output and combined cost", () => {
  // opus-4-8: $5/1M input, $25/1M output → 1234*5/1e6 + 5678*25/1e6 = 0.14812
  expect(formatUsage(1234, 5678, "claude-opus-4-8")).toBe("1.2k In · 5.7k Out · ~$0.1481");
});

test("formatUsage returns empty string when no tokens", () => {
  expect(formatUsage(0, 0, "claude-opus-4-8")).toBe("");
});

test("formatUsage handles small counts and unknown model", () => {
  // haiku-4-5: $1/1M input, $5/1M output → 500/1e6 + 800*5/1e6 = 0.0045
  expect(formatUsage(500, 800, "claude-haiku-4-5")).toBe("500 In · 800 Out · ~$0.0045");
  expect(formatUsage(100, 0, "unknown-model")).toBe("100 In · 0 Out · ~$0.0000");
});
