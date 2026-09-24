import type { Comment, ExtractionResult } from "./types";
import { estimateTokens } from "./tokens";

const TRUNCATION_NOTICE =
  "[HINWEIS: Inhalt wurde aus Längengründen gekürzt — Analyse beruht auf einer Teilmenge. Keine Mehrheits- oder Prozentbehauptungen über die Gesamtdiskussion.]";

function formatComment(c: Comment): string {
  const meta = [
    c.id ? `[${c.id}]` : null,
    c.author ?? "anonym",
    c.score != null ? `${c.score}▲` : null,
    `Ebene ${c.depth}`,
  ].filter(Boolean).join(" · ");
  return `> [${meta}]\n${c.text}`;
}

export function buildUserMessage(x: ExtractionResult): string {
  const captured = x.coverage?.captured ?? x.stats.commentCount;
  const selected = x.comments.length;
  const head = [
    `QUELLE: ${x.url}`,
    `TITEL: ${x.title}`,
    `TYP: ${x.siteType}`,
    `ABDECKUNG: ${selected} von ${captured} erfassten Kommentaren ausgewählt${x.stats.platformTotal != null ? ` (Plattform gesamt: ${x.stats.platformTotal})` : ""}.`,
    "Belege konkrete Aussagen mit Kommentar-IDs wie [C1]. Verwende nur vorhandene IDs.",
    x.truncated || (x.stats.platformTotal != null && captured < x.stats.platformTotal) ? TRUNCATION_NOTICE : null,
  ].filter(Boolean).join("\n");
  const article = x.article
    ? `\n\n=== BEITRAG / ARTIKEL ===\n${x.article.byline ? x.article.byline + "\n\n" : ""}${x.article.text}`
    : "";
  const comments = selected
    ? `\n\n=== KOMMENTARE (${selected}) ===\n${x.comments.map(formatComment).join("\n\n")}`
    : "";
  return head + article + comments;
}

/** Stable IDs and the captured count survive budget trimming. */
export function identifyComments(x: ExtractionResult): ExtractionResult {
  return {
    ...x,
    comments: x.comments.map((c, i) => ({ ...c, id: c.id ?? `C${i + 1}` })),
    coverage: x.coverage ?? {
      captured: x.comments.length,
      selected: x.comments.length,
      articleTruncated: false,
    },
  };
}

function rootIndices(comments: Comment[]): number[] {
  const roots: number[] = [];
  const stack: number[] = [];
  comments.forEach((c, i) => {
    while (stack.length && comments[stack[stack.length - 1]].depth >= c.depth) stack.pop();
    roots.push(stack[0] ?? i);
    stack.push(i);
  });
  return roots;
}

/** Preserve all content below budget. When large, reserve most space for a
 * deterministic spread of comments across threads and preserve source order. */
export function applyBudget(x: ExtractionResult, maxInputTokens: number): ExtractionResult {
  const identified = identifyComments(x);
  if (estimateTokens(buildUserMessage(identified)) <= maxInputTokens) return identified;

  const contentBudget = Math.max(0, maxInputTokens - 240);
  const maxArticleTokens = identified.comments.length ? Math.floor(contentBudget * 0.3) : contentBudget;
  const originalArticle = identified.article?.text ?? "";
  const articleChars = Math.min(originalArticle.length, maxArticleTokens * 4);
  const article = identified.article
    ? { ...identified.article, text: originalArticle.slice(0, articleChars) }
    : null;
  let commentBudget = contentBudget - estimateTokens(article?.text ?? "");
  const maxCommentChars = Math.max(400, Math.min(2400, Math.floor(contentBudget * 4 * 0.08)));
  const comments = identified.comments.map((c) =>
    c.text.length > maxCommentChars
      ? { ...c, text: c.text.slice(0, maxCommentChars).trimEnd() + " […]" }
      : c,
  );
  const roots = rootIndices(comments);
  const groups = new Map<number, number[]>();
  comments.forEach((_, i) => groups.set(roots[i], [...(groups.get(roots[i]) ?? []), i]));
  const queues = [...groups.values()].map((indices) =>
    indices.sort((a, b) =>
      (comments[b].score ?? 0) - (comments[a].score ?? 0) ||
      comments[a].depth - comments[b].depth || a - b,
    ),
  );
  const kept = new Set<number>();
  const selectedByThread = new Map<number, number>();
  const selectedByAuthor = new Map<string, number>();
  while (true) {
    for (const queue of queues) {
      while (queue.length && kept.has(queue[0])) queue.shift();
    }
    const active = queues.filter((queue) => queue.length);
    if (!active.length) break;
    active.sort((a, b) =>
      (selectedByThread.get(roots[a[0]]) ?? 0) - (selectedByThread.get(roots[b[0]]) ?? 0) ||
      (selectedByAuthor.get(comments[a[0]].author ?? "anonym") ?? 0) -
      (selectedByAuthor.get(comments[b[0]].author ?? "anonym") ?? 0) ||
      (comments[b[0]].score ?? 0) - (comments[a[0]].score ?? 0) ||
      a[0] - b[0],
    );
    const index = active[0].shift()!;
    const chain = [index];
    if (roots[index] !== index) {
      for (let i = index - 1; i >= roots[index]; i--) {
        if (comments[i].depth < comments[chain[chain.length - 1]].depth) chain.push(i);
        if (i === roots[index]) break;
      }
    }
    const fresh = chain.filter((i) => !kept.has(i));
    const cost = fresh.reduce((n, i) => n + estimateTokens(formatComment(comments[i])) + 2, 0);
    if (cost > commentBudget) continue;
    fresh.forEach((i) => {
      kept.add(i);
      const author = comments[i].author ?? "anonym";
      selectedByAuthor.set(author, (selectedByAuthor.get(author) ?? 0) + 1);
    });
    selectedByThread.set(roots[index], (selectedByThread.get(roots[index]) ?? 0) + 1);
    commentBudget -= cost;
  }
  const selected = comments.filter((_, i) => kept.has(i));
  return {
    ...identified,
    article,
    comments: selected,
    truncated: true,
    coverage: {
      captured: identified.coverage!.captured,
      selected: selected.length,
      articleTruncated: articleChars < originalArticle.length,
      shortenedComments: selected.filter((c) =>
        c.text !== identified.comments.find((original) => original.id === c.id)?.text,
      ).length,
    },
  };
}
