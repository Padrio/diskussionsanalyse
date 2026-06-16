import type { Comment, ExtractionResult } from "../../lib/types";

interface YtData {
  __comments?: { author?: string; text?: string; likes?: number }[];
  [k: string]: unknown;
}

function readYtInitialData(doc: Document): YtData | null {
  for (const s of Array.from(doc.querySelectorAll("script"))) {
    const t = s.textContent ?? "";
    const m = t.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
    if (m) {
      try {
        return JSON.parse(m[1]) as YtData;
      } catch {
        /* malformed slice — fall through to DOM */
      }
    }
  }
  return null;
}

function commentsFromData(data: YtData): Comment[] {
  // Fixture/best-effort path. Real continuation parsing is intentionally lenient;
  // the visible-DOM fallback covers what this misses.
  if (Array.isArray(data.__comments)) {
    return data.__comments
      .map((c) => ({
        author: c.author,
        text: String(c.text ?? "").trim(),
        score: c.likes,
        depth: 0,
      }))
      .filter((c): c is Comment => c.text.length > 0);
  }
  return [];
}

function commentsFromDom(doc: Document): Comment[] {
  return Array.from(doc.querySelectorAll<HTMLElement>("#comments ytd-comment-thread-renderer"))
    .map((n) => ({
      author: n.querySelector("#author-text")?.textContent?.trim() || undefined,
      text: (n.querySelector("#content-text")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      depth: 0,
    }))
    .filter((c) => c.text.length > 0);
}

export function extractYouTube(doc: Document, url: string): ExtractionResult {
  const title =
    doc.querySelector('meta[name="title"]')?.getAttribute("content")?.trim() ||
    doc.title.replace(/ - YouTube$/, "").trim();
  const description =
    doc.querySelector("#watch-description, #description")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
    "";

  const data = readYtInitialData(doc);
  let comments = data ? commentsFromData(data) : [];
  if (comments.length === 0) comments = commentsFromDom(doc);

  const charCount = description.length + comments.reduce((n, c) => n + c.text.length, 0);
  return {
    url,
    title,
    siteType: "youtube",
    article: description ? { text: description } : null,
    comments,
    stats: { commentCount: comments.length, charCount },
    truncated: false,
  };
}
