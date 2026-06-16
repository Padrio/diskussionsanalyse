import type { Comment, ExtractionResult } from "../../lib/types";

function commentDepth(row: Element): number {
  const ind = row.querySelector(".ind");
  // Modern HN exposes depth directly via the `indent` attribute on td.ind.
  const indentAttr = ind?.getAttribute("indent");
  if (indentAttr != null) return Number(indentAttr) || 0;
  // Fallback: indentation image width in pixels / 40.
  const img = ind?.querySelector<HTMLImageElement>("img");
  if (!img) return 0;
  const w = img.width || Number(img.getAttribute("width")) || 0;
  return Math.round(w / 40);
}

export function extractHackerNews(doc: Document, url: string): ExtractionResult {
  const title = doc.querySelector(".fatitem .titleline a")?.textContent?.trim() ?? doc.title;
  const postText = doc.querySelector(".fatitem .toptext")?.textContent?.trim() ?? "";

  const comments: Comment[] = [];
  doc.querySelectorAll<HTMLElement>(".comtr").forEach((row) => {
    const text = row.querySelector(".commtext")?.textContent?.replace(/\s+/g, " ").trim();
    if (!text) return; // collapsed / flagged
    const author = row.querySelector(".hnuser")?.textContent?.trim() || undefined;
    comments.push({ author, text, depth: commentDepth(row) });
  });

  const charCount = postText.length + comments.reduce((n, c) => n + c.text.length, 0);
  return {
    url,
    title,
    siteType: "hackernews",
    article: postText ? { text: postText } : { text: title },
    comments,
    stats: { commentCount: comments.length, charCount },
    truncated: false,
  };
}
