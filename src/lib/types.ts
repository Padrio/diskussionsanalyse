export type SiteType = "hackernews" | "youtube" | "generic";
export type ModelId =
  | "claude-fable-5-1"
  | "claude-opus-5-5"
  | "claude-sonnet-5"
  | "claude-haiku-4-5"
  | "claude-opus-4-8"
  | "claude-sonnet-4-6";
export type Theme = "system" | "light" | "dark";

export interface Comment {
  id?: string; // stable source ID, assigned at extraction or preparation
  url?: string; // verified deep link to this comment, when available
  author?: string;
  text: string; // normalized to plain text / markdown
  score?: number; // HN points, YT likes, …
  depth: number; // 0 = top-level
}

export interface ExtractionResult {
  url: string;
  title: string;
  siteType: SiteType;
  lang?: string;
  article: { text: string; byline?: string } | null;
  comments: Comment[];
  stats: { commentCount: number; charCount: number; platformTotal?: number };
  truncated: boolean;
  coverage?: { captured: number; selected: number; articleTruncated: boolean; shortenedComments?: number };
}

/** In-memory chat: the live analysis + follow-up thread (owned by the sidebar). */
export interface Convo {
  extraction: ExtractionResult;
  userMessage: string; // the built content message sent for the analysis
  analysis: string; // streamed analysis markdown
  qa: { q: string; a: string; status?: "complete" | "partial" }[];
  sources?: Comment[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number; analysisOutputTokens?: number };
  status?: "running" | "complete" | "partial";
}

/** One persisted analysis (+ its follow-up thread). `model` is display-only —
 *  the request path always reads model/system from the current Settings, so a
 *  reopened chat continues under whatever is configured now (single-path rule). */
export interface HistoryRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  url: string;
  title: string;
  siteType: SiteType;
  stats: { commentCount: number; charCount: number };
  model: ModelId;
  userMessage: string; // full content prompt → enables continuation
  analysis: string;
  qa: { q: string; a: string; status?: "complete" | "partial" }[];
  sources?: Comment[];
  coverage?: ExtractionResult["coverage"];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number; analysisOutputTokens?: number };
  status?: "running" | "complete" | "partial";
}

/** Lightweight projection for the history list/search (no heavy content fields). */
export type HistorySummary = Omit<HistoryRecord, "userMessage" | "analysis" | "qa">;

export interface Settings {
  apiKey: string;
  model: ModelId;
  maxInputTokens: number; // truncation cap
  maxOutputTokens: number; // Anthropic max_tokens
  systemPrompt: string; // default = bundled meta-prompt
  language: string; // hint only; default "Deutsch"
  theme: Theme;
}

export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "usage"; outputTokens?: number; inputTokens?: number }
  | { type: "refusal"; explanation?: string }
  | { type: "done"; stopReason: string | null };

export interface UiError {
  code: string; // e.g. "auth", "rate_limit"
  message: string; // German UI text
  retryable: boolean;
  retryAfterSec?: number;
  openOptions?: boolean; // surface "Einstellungen öffnen"
}

// Background → sidebar live messages
export type RuntimeMessage =
  | { type: "ANALYZING"; windowId: number; jobId: string }
  | { type: "EXTRACTION_RESULT"; payload: ExtractionResult; windowId: number; jobId: string }
  | { type: "EXTRACTION_ERROR"; payload: string; windowId: number; jobId: string };
