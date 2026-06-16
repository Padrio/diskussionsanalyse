import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export interface Section {
  title: string;
  bodyMd: string;
  isBias: boolean;
}

export function splitSections(md: string): Section[] {
  const parts = md.split(/^##\s+/m).filter((p) => p.trim());
  return parts.map((p) => {
    const nl = p.indexOf("\n");
    const title = (nl === -1 ? p : p.slice(0, nl)).trim();
    const bodyMd = nl === -1 ? "" : p.slice(nl + 1).trim();
    return { title, bodyMd, isBias: /bias|tendenz/i.test(title) };
  });
}

// USD per 1M tokens (source: claude-api model catalog).
export const INPUT_PRICE: Record<string, number> = {
  "claude-opus-4-8": 5,
  "claude-sonnet-4-6": 3,
  "claude-haiku-4-5": 1,
};
export const OUTPUT_PRICE: Record<string, number> = {
  "claude-opus-4-8": 25,
  "claude-sonnet-4-6": 15,
  "claude-haiku-4-5": 5,
};

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Usage line "1.2k In · 3.4k Out · ~$0.1481" — empty when no tokens yet. */
export function formatUsage(inputTokens: number, outputTokens: number, model: string): string {
  if (!inputTokens && !outputTokens) return "";
  const cost =
    (inputTokens / 1e6) * (INPUT_PRICE[model] ?? 0) +
    (outputTokens / 1e6) * (OUTPUT_PRICE[model] ?? 0);
  return `${fmtTokens(inputTokens)} In · ${fmtTokens(outputTokens)} Out · ~$${cost.toFixed(4)}`;
}
