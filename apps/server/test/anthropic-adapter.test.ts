import { expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  content: '{"newTracks":[],"rows":[]}',
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      stream: () => {
        const events = [
          { type: "message_start", message: { id: "msg-test" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: mock.content } },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
          { type: "message_stop" },
        ];
        return {
          request_id: "req-anthropic-test",
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
          finalMessage: async () => ({
            id: "msg-test",
            model: "claude-test",
            stop_reason: "end_turn",
            usage: { input_tokens: 4, output_tokens: 3 },
            content: [{ type: "text", text: mock.content }],
          }),
        };
      },
    };
  },
}));

import { createModelAdapter } from "../src/agent.js";

it("streams and parses Anthropic structured output through the shared adapter", async () => {
  const previous = {
    provider: process.env.AI_PROVIDER,
    key: process.env.ANTHROPIC_API_KEY,
  };
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
  try {
    const entries: any[] = [];
    const adapter = createModelAdapter(() => {}, async (type, payload) => entries.push({ type, payload }));
    await expect(adapter.compose("compose", new AbortController().signal)).resolves.toEqual({ newTracks: [], rows: [] });
    const request = entries.find((entry) => entry.type === "model_request").payload.request;
    expect(request.output_config.format.type).toBe("json_schema");
    expect(entries.find((entry) => entry.type === "model_response").payload).toMatchObject({
      provider: "anthropic",
      requestId: "msg-test",
      content: mock.content,
    });
  } finally {
    if (previous.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.key;
  }
});
