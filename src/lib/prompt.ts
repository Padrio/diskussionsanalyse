import type { Comment, ExtractionResult } from "./types";
import { estimateTokens } from "./tokens";

const TRUNCATION_NOTICE =
  "[HINWEIS: Inhalt wurde aus Längengründen gekürzt — Analyse beruht auf einer Teilmenge.]";

function formatComment(c: Comment): string {
  const meta = [
    c.author ?? "anonym",
    c.score != null ? `${c.score}▲` : null,
    `Ebene ${c.depth}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `> [${meta}]\n${c.text}`;
}

export function buildUserMessage(x: ExtractionResult): string {
  const head = [
    `QUELLE: ${x.url}`,
    `TITEL: ${x.title}`,
    `TYP: ${x.siteType}`,
    x.truncated ? TRUNCATION_NOTICE : null,
  ]
    .filter(Boolean)
    .join("\n");

  const article = x.article
    ? `\n\n=== BEITRAG / ARTIKEL ===\n${
        x.article.byline ? x.article.byline + "\n\n" : ""
      }${x.article.text}`
    : "";

  const comments = x.comments.length
    ? `\n\n=== KOMMENTARE (${x.comments.length}) ===\n${x.comments
        .map(formatComment)
        .join("\n\n")}`
    : "";

  return head + article + comments;
}

/** Keep the article whole; greedily keep highest-scored comments under the token cap. */
export function applyBudget(x: ExtractionResult, maxInputTokens: number): ExtractionResult {
  if (estimateTokens(buildUserMessage(x)) <= maxInputTokens) {
    return { ...x, truncated: false };
  }
  const articleTokens = x.article ? estimateTokens(x.article.text) : 0;
  const overhead = 200; // header + section markers, generous
  let budget = maxInputTokens - articleTokens - overhead;

  const ranked = [...x.comments].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.depth - b.depth,
  );
  const kept: Comment[] = [];
  for (const c of ranked) {
    const cost = estimateTokens(formatComment(c));
    if (cost > budget) continue;
    budget -= cost;
    kept.push(c);
  }
  return {
    ...x,
    comments: kept,
    stats: { ...x.stats, commentCount: kept.length },
    truncated: true,
  };
}
