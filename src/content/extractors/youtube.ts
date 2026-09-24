import type { Comment, ExtractionResult } from "../../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
// YouTube's internal JSON (ytInitialData / Innertube /next) is deeply nested and
// version-volatile; we walk it defensively with optional chaining and never throw.

interface YtData {
  __comments?: { author?: string; text?: string; likes?: number }[];
  [k: string]: unknown;
}

const MAX_COMMENTS = 200;
const MAX_PAGES = 6;
const MAX_FIND_DEPTH = 14;

/** Slice a balanced {...} literal starting at the first "{" at or after `from`.
 *  Brace-aware + string-aware so it survives huge nested ytInitialData payloads. */
function sliceBalancedObject(text: string, from: number): string | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function readYtInitialData(doc: Document): YtData | null {
  // Handles both `var ytInitialData = {…}` and `window["ytInitialData"] = {…}`.
  for (const s of Array.from(doc.querySelectorAll("script"))) {
    const t = s.textContent ?? "";
    const anchor = t.indexOf("ytInitialData");
    if (anchor === -1) continue;
    const eq = t.indexOf("=", anchor);
    if (eq === -1) continue;
    const slice = sliceBalancedObject(t, eq);
    if (slice) {
      try {
        return JSON.parse(slice) as YtData;
      } catch {
        /* try next script / fall through to DOM */
      }
    }
  }
  return null;
}

/** Parse YouTube vote/like counts: "12", "1,234", "1.2K", "3.4M" → number. */
export function parseCount(s?: string | null): number | undefined {
  if (s == null) return undefined;
  const m = String(s)
    .trim()
    .match(/^([\d.,]+)\s*([KMB])?/i);
  if (!m) return undefined;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const suffix = (m[2] ?? "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

function cfgValue(doc: Document, key: string): string | undefined {
  for (const s of Array.from(doc.querySelectorAll("script"))) {
    const m = (s.textContent ?? "").match(new RegExp(`"${key}":\\s*"([^"]+)"`));
    if (m) return m[1];
  }
  return undefined;
}

// ── Innertube /next response parsing (pure, testable) ──

function continuationItems(data: any): any[] {
  const eps = data?.onResponseReceivedEndpoints;
  const items: any[] = [];
  if (Array.isArray(eps)) {
    for (const ep of eps) {
      const ci =
        ep?.appendContinuationItemsAction?.continuationItems ??
        ep?.reloadContinuationItemsCommand?.continuationItems;
      if (Array.isArray(ci)) items.push(...ci);
    }
  }
  return items;
}

/** New format: comment bodies live in frameworkUpdates entity mutations, keyed by commentKey. */
function entityMap(data: any): Map<string, Comment> {
  const map = new Map<string, Comment>();
  const muts = data?.frameworkUpdates?.entityBatchUpdate?.mutations;
  if (!Array.isArray(muts)) return map;
  for (const mut of muts) {
    const p = mut?.payload?.commentEntityPayload;
    const key = p?.key;
    if (!key) continue;
    const text = String(p?.properties?.content?.content ?? "").trim();
    const author = p?.author?.displayName || undefined;
    const likes = parseCount(p?.toolbar?.likeCountNotliked ?? p?.toolbar?.likeCountLiked);
    const commentId = p?.properties?.commentId;
    map.set(key, { author, text, score: likes, depth: 0, ...(commentId ? { url: `https://www.youtube.com/watch?lc=${encodeURIComponent(String(commentId))}` } : {}) });
  }
  return map;
}

/** Legacy format: comment body inline on commentRenderer. */
function fromLegacyRenderer(r: any, depth: number): Comment | null {
  if (!r) return null;
  const runs = r?.contentText?.runs;
  const text = (
    Array.isArray(runs) ? runs.map((x: any) => x?.text ?? "").join("") : (r?.contentText?.simpleText ?? "")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const author = r?.authorText?.simpleText || undefined;
  const score = parseCount(r?.voteCount?.simpleText) ?? parseCount(r?.likeCount);
  return { author, text, score, depth, ...(r.commentId ? { url: `https://www.youtube.com/watch?lc=${encodeURIComponent(String(r.commentId))}` } : {}) };
}

export function parseInnertubeComments(data: unknown): Comment[] {
  const d = data as any;
  const entities = entityMap(d);
  const out: Comment[] = [];
  for (const item of continuationItems(d)) {
    const ctr = item?.commentThreadRenderer;
    if (!ctr) continue;
    const key = ctr?.commentViewModel?.commentViewModel?.commentKey;
    if (key && entities.has(key)) {
      const c = entities.get(key)!;
      if (c.text) out.push(c);
      continue;
    }
    const legacy = fromLegacyRenderer(ctr?.comment?.commentRenderer, 0);
    if (legacy) out.push(legacy);
  }
  return out;
}

export function nextContinuationToken(data: unknown): string | undefined {
  for (const item of continuationItems(data as any)) {
    const tok = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (tok) return tok;
  }
  return undefined;
}

/** Seed token for the comments section, dug out of ytInitialData. */
function findCommentsContinuation(node: any, depth = 0): string | undefined {
  if (!node || typeof node !== "object" || depth > MAX_FIND_DEPTH) return undefined;
  const isr = node.itemSectionRenderer;
  if (isr?.sectionIdentifier === "comment-item-section" && Array.isArray(isr.contents)) {
    for (const it of isr.contents) {
      const tok = it?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (tok) return tok;
    }
  }
  for (const k of Object.keys(node)) {
    const v = (node as any)[k];
    if (v && typeof v === "object") {
      const found = findCommentsContinuation(v, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** Primary path: page through the Innertube comments API (same-origin from the YouTube tab). */
async function fetchYouTubeComments(doc: Document, signal?: AbortSignal): Promise<Comment[]> {
  const key = cfgValue(doc, "INNERTUBE_API_KEY");
  const clientVersion = cfgValue(doc, "INNERTUBE_CLIENT_VERSION");
  const yt = readYtInitialData(doc);
  if (!key || !clientVersion || !yt) return [];
  let token = findCommentsContinuation(yt);
  if (!token) return [];

  const context = {
    client: {
      clientName: "WEB",
      clientVersion,
      hl: cfgValue(doc, "HL") || "de",
      gl: cfgValue(doc, "GL") || "DE",
    },
  };
  const url = `https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(key)}&prettyPrint=false`;
  const out: Comment[] = [];

  for (let page = 0; page < MAX_PAGES && token && out.length < MAX_COMMENTS; page++) {
    let data: unknown;
    try {
      const res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context, continuation: token }),
      });
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // network/CORS — fall back to DOM
    }
    const batch = parseInnertubeComments(data);
    if (batch.length === 0) break;
    out.push(...batch);
    token = nextContinuationToken(data);
  }
  return out.slice(0, MAX_COMMENTS);
}

/** Fallback: scrape whatever comments are rendered in the DOM (top-level + inline replies). */
function commentsFromDom(doc: Document): Comment[] {
  const out: Comment[] = [];
  const threads = Array.from(doc.querySelectorAll<HTMLElement>("ytd-comment-thread-renderer"));
  for (const th of threads) {
    const main = pickDomComment(
      th.querySelector("#comment, ytd-comment-renderer, ytd-comment-view-model"),
      0,
    );
    if (main) out.push(main);
    const replies = th.querySelectorAll<HTMLElement>(
      "ytd-comment-replies-renderer ytd-comment-renderer, ytd-comment-replies-renderer ytd-comment-view-model",
    );
    for (const rep of Array.from(replies)) {
      const r = pickDomComment(rep, 1);
      if (r) out.push(r);
    }
  }
  return out;
}

function pickDomComment(n: Element | null, depth: number): Comment | null {
  if (!n) return null;
  const text = (n.querySelector("#content-text")?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const author = n.querySelector("#author-text")?.textContent?.trim() || undefined;
  const score = parseCount(n.querySelector("#vote-count-middle")?.textContent);
  const permalink = n.querySelector<HTMLAnchorElement>('a[href*="lc="]')?.href;
  return { author, text, score, depth, ...(permalink ? { url: permalink } : {}) };
}

/** Last resort: the __comments array used by the test fixture. */
function commentsFromData(data: YtData): Comment[] {
  if (!Array.isArray(data.__comments)) return [];
  return data.__comments
    .map((c) => ({ author: c.author, text: String(c.text ?? "").trim(), score: c.likes, depth: 0 }))
    .filter((c) => c.text.length > 0);
}

export async function extractYouTube(doc: Document, url: string): Promise<ExtractionResult> {
  const title =
    doc.querySelector('meta[name="title"]')?.getAttribute("content")?.trim() ||
    doc.title.replace(/ - YouTube$/, "").trim();
  const description =
    doc.querySelector("#watch-description, #description")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
    "";

  // Innertube (most comments) → visible DOM → legacy fixture array.
  let comments = await fetchYouTubeComments(doc).catch(() => [] as Comment[]);
  if (comments.length === 0) comments = commentsFromDom(doc);
  if (comments.length === 0) {
    const data = readYtInitialData(doc);
    if (data) comments = commentsFromData(data);
  }

  const videoUrl = new URL(url);
  const videoId = videoUrl.searchParams.get("v");
  comments = comments.map((c) => {
    if (!c.url || !videoId) return c;
    const link = new URL(c.url, url);
    const lc = link.searchParams.get("lc");
    return lc ? { ...c, url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(lc)}` } : c;
  });
  const countText = doc.querySelector("#count .count-text, ytd-comments-header-renderer #count")?.textContent;
  const platformTotal = parseCount(countText);
  const charCount = description.length + comments.reduce((n, c) => n + c.text.length, 0);
  return {
    url,
    title,
    siteType: "youtube",
    article: description ? { text: description } : null,
    comments,
    stats: { commentCount: comments.length, charCount, ...(platformTotal != null ? { platformTotal } : {}) },
    truncated: false,
  };
}
