import type { ChatMessage } from "./anthropic";
import type { Convo, HistoryRecord, ModelId } from "./types";

/** The ONE place the API message array is built — shared by the live analysis,
 *  follow-ups, and reopened history entries. Order: the content prompt, the
 *  analysis, then each answered follow-up as a user/assistant pair. An
 *  unanswered question contributes only its user turn. */
export function conversationMessages(c: Convo): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: "user", content: c.userMessage },
    { role: "assistant", content: c.analysis },
  ];
  for (const t of c.qa) {
    msgs.push({ role: "user", content: t.q });
    if (t.a) msgs.push({ role: "assistant", content: t.a });
  }
  return msgs;
}

/** A new question includes only completed prior pairs; a partial empty answer
 * must never become an extra user turn ahead of the new question. */
export function followupMessages(c: Convo, question: string): ChatMessage[] {
  return [
    ...conversationMessages({ ...c, qa: c.qa.filter((turn) => !!turn.a && turn.status !== "partial") }),
    { role: "user", content: question },
  ];
}

/** Remove one oldest answered pair while retaining the original analysis and
 * the new final user question. */
export function dropOldestFollowup(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > 3 ? [...messages.slice(0, 2), ...messages.slice(4)] : messages;
}

export interface RecordMeta {
  id: string;
  model: ModelId;
  createdAt: number;
  updatedAt: number;
}

/** Project a live convo into a persistable record. Only the header metadata
 *  ({url,title,siteType,stats}) is kept from the extraction; the full content
 *  lives in `userMessage`, which is all `conversationMessages` needs to continue. */
export function recordFromConvo(c: Convo, meta: RecordMeta): HistoryRecord {
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    url: c.extraction.url,
    title: c.extraction.title,
    siteType: c.extraction.siteType,
    stats: c.extraction.stats,
    model: meta.model,
    userMessage: c.userMessage,
    analysis: c.analysis,
    qa: c.qa.map((t) => ({ ...t })),
    sources: c.sources?.map((s) => ({ ...s })),
    coverage: c.extraction.coverage,
    usage: c.usage ? { ...c.usage } : undefined,
    status: c.status,
  };
}

/** Rehydrate a convo from a record. The extraction is reconstructed minimally
 *  (no article/comments are stored) — enough for the header/export render; it is
 *  NOT sufficient for "Erneut", which the sidebar disables for restored chats. */
export function convoFromRecord(r: HistoryRecord): Convo {
  return {
    extraction: {
      url: r.url,
      title: r.title,
      siteType: r.siteType,
      stats: r.stats,
      article: null,
      comments: [],
      truncated: false,
      ...(r.coverage ? { coverage: r.coverage } : {}),
    },
    userMessage: r.userMessage,
    analysis: r.analysis,
    qa: r.qa.map((t) => ({ ...t })),
    sources: r.sources?.map((s) => ({ ...s })),
    usage: r.usage ? { ...r.usage } : undefined,
    status: r.status,
  };
}
