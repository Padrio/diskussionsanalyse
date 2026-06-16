import type { Settings, StreamEvent, UiError } from "./types";
import { mapHttpError } from "./errors";
import { parseSSE } from "./sse";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

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

export async function* streamAnalysis(args: StreamArgs): AsyncGenerator<StreamEvent> {
  const { settings, messages, signal } = args;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: settings.maxOutputTokens,
      system: settings.systemPrompt,
      messages,
      thinking: { type: "adaptive" },
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    let errType: string | undefined;
    try {
      errType = ((await res.json()) as { error?: { type?: string } })?.error?.type;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new AnthropicError(mapHttpError(res.status, res.headers.get("retry-after"), errType));
  }

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
