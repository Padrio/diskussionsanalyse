import { marked } from "marked";
import DOMPurify from "dompurify";
import { MODEL_PRICES, price } from "../lib/models";
import type { Comment } from "../lib/types";

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** Link only IDs that exist in this analysis and have a verified HTTP(S) URL. */
export function renderSourcedMarkdown(md: string, sources: Comment[] = []): string {
  const template = document.createElement("template");
  template.innerHTML = renderMarkdown(md);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("a, code, pre")) continue;
    const content = node.textContent ?? "";
    const regex = /\[C\d+\]/g;
    if (!regex.test(content)) continue;
    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let from = 0;
    for (const match of content.matchAll(regex)) {
      const index = match.index;
      fragment.append(document.createTextNode(content.slice(from, index)));
      const source = byId.get(match[0].slice(1, -1));
      let safeUrl: URL | null = null;
      try {
        if (source?.url) {
          const parsed = new URL(source.url);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") safeUrl = parsed;
        }
      } catch { /* invalid source URL */ }
      if (safeUrl) {
        const link = document.createElement("a");
        link.href = safeUrl.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = match[0];
        link.title = source?.text.slice(0, 160) ?? "";
        fragment.append(link);
      } else fragment.append(document.createTextNode(match[0]));
      from = index + match[0].length;
    }
    fragment.append(document.createTextNode(content.slice(from)));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
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

// USD per 1M tokens (standard Claude API rates; no caching or batch discount).
export const INPUT_PRICE = Object.fromEntries(Object.entries(MODEL_PRICES).map(([k, v]) => [k, v.input]));
export const OUTPUT_PRICE = Object.fromEntries(Object.entries(MODEL_PRICES).map(([k, v]) => [k, v.output]));

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Usage line "1.2k In · 3.4k Out · ~$0.1481" — empty when no tokens yet. */
export function formatUsage(inputTokens: number, outputTokens: number, model: string, actualCost?: number): string {
  if (!inputTokens && !outputTokens) return "";
  const cost = actualCost ?? (model in MODEL_PRICES ? price(model as keyof typeof MODEL_PRICES, inputTokens, outputTokens) : 0);
  return `${fmtTokens(inputTokens)} In · ${fmtTokens(outputTokens)} Out · ~$${cost.toFixed(4)}`;
}
