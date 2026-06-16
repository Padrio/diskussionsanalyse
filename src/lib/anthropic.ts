import type { Settings, StreamEvent, UiError } from "./types";
import { mapHttpError } from "./errors";
import { parseSSE } from "./sse";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const COUNT_ENDPOINT = `${ENDPOINT}/count_tokens`;

export class AnthropicError extends Error {
  constructor(public uiError: UiError) {
    super(uiError.message);
    this.name = "AnthropicError";
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamArgs {
  settings: Settings;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

function authHeaders(settings: Settings): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/** Single source for the request body shared by streamAnalysis and countTokens.
 *  Both paths MUST send identical model/system/messages/thinking — the count_tokens
 *  preview only mirrors the real call if it is built here (cross-path consistency). */
function messagesBody(settings: Settings, messages: ChatMessage[]) {
  return {
    model: settings.model,
    system: settings.systemPrompt,
    messages,
    thinking: { type: "adaptive" as const },
  };
}

async function toAnthropicError(res: Response): Promise<AnthropicError> {
  let errType: string | undefined;
  try {
    errType = ((await res.json()) as { error?: { type?: string } })?.error?.type;
  } catch {
    /* ignore non-JSON error bodies */
  }
  return new AnthropicError(mapHttpError(res.status, res.headers.get("retry-after"), errType));
}

export async function* streamAnalysis(args: StreamArgs): AsyncGenerator<StreamEvent> {
  const { settings, messages, signal } = args;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: authHeaders(settings),
    body: JSON.stringify({
      ...messagesBody(settings, messages),
      max_tokens: settings.maxOutputTokens,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) throw await toAnthropicError(res);

  let stopReason: string | null = null;
  for await (const ev of parseSSE(res.body)) {
    const type = ev.type as string;
    if (type === "content_block_delta") {
      const delta = ev.delta as { type: string; text?: string; thinking?: string };
      if (delta.type === "text_delta" && delta.text) {
        yield { type: "text", text: delta.text };
      } else if (delta.type === "thinking_delta" && delta.thinking) {
        yield { type: "thinking", text: delta.thinking };
      }
    } else if (type === "message_start") {
      const u = (ev as { message?: { usage?: { input_tokens?: number } } }).message?.usage;
      if (u?.input_tokens != null) yield { type: "usage", inputTokens: u.input_tokens };
    } else if (type === "message_delta") {
      const d = ev as { delta?: { stop_reason?: string }; usage?: { output_tokens?: number } };
      if (d.delta?.stop_reason) stopReason = d.delta.stop_reason;
      if (d.usage?.output_tokens != null) {
        yield { type: "usage", outputTokens: d.usage.output_tokens };
      }
      if (stopReason === "refusal") yield { type: "refusal" };
    } else if (type === "error") {
      const message = (ev as { error?: { message?: string } }).error?.message ?? "Stream-Fehler.";
      throw new AnthropicError({ code: "stream", message, retryable: true });
    }
  }
  yield { type: "done", stopReason };
}

/** Preview the input-token count for the exact request streamAnalysis would send.
 *  Mirrors messagesBody() (model/system/messages/thinking); no max_tokens/stream. */
export async function countTokens(
  settings: Settings,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<number> {
  const res = await fetch(COUNT_ENDPOINT, {
    method: "POST",
    signal,
    headers: authHeaders(settings),
    body: JSON.stringify(messagesBody(settings, messages)),
  });
  if (!res.ok) throw await toAnthropicError(res);
  const data = (await res.json()) as { input_tokens?: number };
  return data.input_tokens ?? 0;
}
