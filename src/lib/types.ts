export type SiteType = "hackernews" | "youtube" | "generic";
export type ModelId = "claude-opus-4-8" | "claude-sonnet-4-6" | "claude-haiku-4-5";
export type Theme = "system" | "light" | "dark";

export interface Comment {
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
  stats: { commentCount: number; charCount: number };
  truncated: boolean;
}

export interface Settings {
  apiKey: string;
  model: ModelId;
  maxInputTokens: number; // truncation cap
  maxOutputTokens: number; // Anthropic max_tokens
  tokenGateThreshold: number; // count_tokens-Bestätigung ab dieser geschätzten Input-Token-Zahl (0 = nie)
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
  | { type: "ANALYZING" }
  | { type: "EXTRACTION_RESULT"; payload: ExtractionResult }
  | { type: "EXTRACTION_ERROR"; payload: string };
