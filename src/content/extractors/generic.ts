import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Comment, ExtractionResult } from "../../lib/types";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const COMMENT_SELECTOR =
  '[id*="comment" i] .comment, .comment, [role="comment"], [data-testid*="comment" i], li.comment';

function collectComments(root: ParentNode, pageUrl: string): Comment[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR));
  // De-duplicate nested matches: keep each node, compute depth by counting
  // ancestor comment nodes within the matched set.
  const set = new Set(nodes);
  const out: Comment[] = [];
  for (const node of nodes) {
    let depth = 0;
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (set.has(p)) depth++;
    }
    const author = node
      .querySelector('[class*="author" i], [class*="user" i], [rel="author"]')
      ?.textContent?.trim();
    // text = node's own text minus nested comment subtrees and author labels
    const clone = node.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(COMMENT_SELECTOR).forEach((n) => n.remove());
    clone.querySelectorAll('[class*="author" i], [class*="user" i]').forEach((n) => n.remove());
    const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) {
      const target = node.id && (root as Document).getElementById(node.id) === node
        ? new URL(`#${encodeURIComponent(node.id)}`, pageUrl).href : undefined;
      out.push({ author, text, depth, ...(target ? { url: target } : {}) });
    }
  }
  return out;
}

export function extractGeneric(doc: Document, url: string): ExtractionResult {
  const clone = doc.cloneNode(true) as Document;
  const parsed = new Readability(clone).parse();
  const articleText = parsed?.content ? turndown.turndown(parsed.content).trim() : "";
  const title = parsed?.title?.trim() || doc.title || url;

  const comments = collectComments(doc, url);
  const totalValue = doc.querySelector('meta[itemprop="commentCount"], meta[property="article:comment_count"]')?.getAttribute("content");
  const platformTotal = totalValue && /^\d+$/.test(totalValue) ? Number(totalValue) : undefined;
  const charCount = articleText.length + comments.reduce((n, c) => n + c.text.length, 0);

  return {
    url,
    title,
    siteType: "generic",
    lang: doc.documentElement.getAttribute("lang") ?? undefined,
    article: articleText ? { text: articleText, byline: parsed?.byline ?? undefined } : null,
    comments,
    stats: { commentCount: comments.length, charCount, ...(platformTotal != null ? { platformTotal } : {}) },
    truncated: false,
  };
}
