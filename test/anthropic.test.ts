import { afterEach, expect, test, vi } from "vitest";
import { countTokens, streamAnalysis } from "../src/lib/anthropic";
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
  expect(evs).toContainEqual({ type: "usage", inputTokens: 345, outputTokens: 1 });
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

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("countTokens returns input_tokens", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse('{"input_tokens":1234}')));
  const n = await countTokens({ ...DEFAULT_SETTINGS, apiKey: "k" }, [{ role: "user", content: "hi" }]);
  expect(n).toBe(1234);
});

test("countTokens maps 401 to AnthropicError", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse('{"error":{"type":"authentication_error"}}', 401)));
  await expect(
    countTokens({ ...DEFAULT_SETTINGS, apiKey: "bad" }, [{ role: "user", content: "x" }]),
  ).rejects.toMatchObject({ uiError: { code: "auth" } });
});

test("countTokens body mirrors streamAnalysis body minus max_tokens/stream (cross-path)", async () => {
  const settings = { ...DEFAULT_SETTINGS, apiKey: "k" };
  const messages = [{ role: "user" as const, content: "hi" }];

  const streamSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
    sseResponse('data: {"type":"message_stop"}\n\n'),
  );
  vi.stubGlobal("fetch", streamSpy);
  await drain({ settings, messages });
  const streamBody = JSON.parse(streamSpy.mock.calls[0][1]!.body as string);

  const countSpy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse('{"input_tokens":1}'));
  vi.stubGlobal("fetch", countSpy);
  await countTokens(settings, messages);
  const countUrl = countSpy.mock.calls[0][0];
  const countBody = JSON.parse(countSpy.mock.calls[0][1]!.body as string);

  expect(countUrl).toBe("https://api.anthropic.com/v1/messages/count_tokens");
  expect(countBody).toEqual({
    model: streamBody.model,
    system: streamBody.system,
    messages: streamBody.messages,
    thinking: streamBody.thinking,
  });
  expect(countBody).not.toHaveProperty("max_tokens");
  expect(countBody).not.toHaveProperty("stream");
  expect(streamBody.max_tokens).toBe(settings.maxOutputTokens);
  expect(streamBody.stream).toBe(true);
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
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.stream).toBe(true);
  expect(body.thinking).toEqual({ type: "adaptive" });
  expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  expect(body).not.toHaveProperty("temperature");
  expect(body).not.toHaveProperty("budget_tokens");
});

test("Haiku requests omit unsupported adaptive thinking in both API paths", async () => {
  const settings = { ...DEFAULT_SETTINGS, model: "claude-haiku-4-5" as const };
  const messages = [{ role: "user" as const, content: "hi" }];
  const spy = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith("/count_tokens")
      ? jsonResponse('{"input_tokens":1}')
      : sseResponse('data: {"type":"message_stop"}\n\n'),
  );
  vi.stubGlobal("fetch", spy);

  await drain({ settings, messages });
  await countTokens(settings, messages);

  for (const [, init] of spy.mock.calls) {
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body).not.toHaveProperty("thinking");
  }
});
