import { expect, test } from "vitest";
import { parseSSE } from "../src/lib/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
      else ctrl.close();
    },
  });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out: unknown[] = [];
  for await (const ev of parseSSE(s)) out.push(ev);
  return out;
}

test("parses well-formed events", async () => {
  const out = await collect(
    streamOf([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
    ]),
  );
  expect(out).toEqual([
    { type: "message_start" },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
  ]);
});

test("reassembles events split across chunks", async () => {
  const out = await collect(streamOf(['data: {"ty', 'pe":"x"}\n', "\n"]));
  expect(out).toEqual([{ type: "x" }]);
});

test("stops at [DONE]", async () => {
  const out = await collect(
    streamOf(['data: {"type":"a"}\n\n', "data: [DONE]\n\n", 'data: {"type":"b"}\n\n']),
  );
  expect(out).toEqual([{ type: "a" }]);
});
