import { afterEach, expect, test, vi } from "vitest";
import { streamAnalysis } from "../src/lib/anthropic";
import { DEFAULT_SETTINGS } from "../src/lib/storage";
import type { StreamEvent } from "../src/lib/types";

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
afterEach(() => vi.restoreAllMocks());

async function drain(args: Parameters<typeof streamAnalysis>[0]) {
  const evs: StreamEvent[] = [];
  for await (const e of streamAnalysis(args)) evs.push(e);
  return evs;
}

test("maps text deltas, usage and done", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      sseResponse(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hallo"}}\n\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
    ),
  );
  const evs = await drain({ settings: { ...DEFAULT_SETTINGS, apiKey: "k" }, messages: [{ role: "user", content: "hi" }] });
  expect(evs).toContainEqual({ type: "text", text: "Hallo" });
  expect(evs).toContainEqual({ type: "usage", outputTokens: 12 });
  expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
});

test("emits input tokens from message_start", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      sseResponse(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":345,"output_tokens":1}}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
    ),
  );
  const evs = await drain({ settings: { ...DEFAULT_SETTINGS, apiKey: "k" }, messages: [{ role: "user", content: "hi" }] });
  expect(evs).toContainEqual({ type: "usage", inputTokens: 345 });
});

test("emits refusal when stop_reason is refusal", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      sseResponse(
        'data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}\n\n',
      ),
    ),
  );
  const evs = await drain({ settings: { ...DEFAULT_SETTINGS, apiKey: "k" }, messages: [{ role: "user", content: "x" }] });
  expect(evs.some((e) => e.type === "refusal")).toBe(true);
});

test("throws AnthropicError with mapped UiError on 401", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"error":{"type":"authentication_error"}}', { status: 401 })),
  );
  await expect(
    drain({ settings: { ...DEFAULT_SETTINGS, apiKey: "bad" }, messages: [{ role: "user", content: "x" }] }),
  ).rejects.toMatchObject({ uiError: { code: "auth" } });
});

test("sends correct headers and body shape", async () => {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
    sseResponse('data: {"type":"message_stop"}\n\n'),
  );
  vi.stubGlobal("fetch", spy);
  await drain({ settings: { ...DEFAULT_SETTINGS, apiKey: "secret" }, messages: [{ role: "user", content: "hi" }] });
  const init = spy.mock.calls[0][1]!;
  const headers = init.headers as Record<string, string>;
  expect(headers["x-api-key"]).toBe("secret");
  expect(headers["anthropic-version"]).toBe("2023-06-01");
  expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  const body = JSON.parse(init.body as string);
  expect(body.model).toBe("claude-opus-4-8");
  expect(body.stream).toBe(true);
  expect(body.thinking).toEqual({ type: "adaptive" });
  expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  expect(body).not.toHaveProperty("temperature");
  expect(body).not.toHaveProperty("budget_tokens");
});
