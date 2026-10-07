import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ lines: [] as unknown[], calls: [] as any[], stdin: "" }));
vi.mock("node:child_process", () => ({
  spawn: (bin: string, args: string[], options: any) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.kill = () => true;
    child.stdin.on("data", (chunk: Buffer) => (mock.stdin += chunk));
    mock.calls.push({ bin, args, options });
    child.stdout.end(mock.lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    child.stdout.on("end", () => {
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  },
}));

import { createModelAdapter } from "../src/agent.js";

const names = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "AI_COMPOSER_MODEL", "CLAUDE_BIN"] as const;
const original = new Map(names.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of names) {
    const value = original.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mock.calls = [];
  mock.stdin = "";
});
const run = (lines: unknown[]) => {
  mock.lines = lines;
  process.env.AI_PROVIDER = "claude-subscription";
  process.env.ANTHROPIC_API_KEY = "must-not-reach-the-cli";
  process.env.AI_COMPOSER_MODEL = "";
  process.env.CLAUDE_BIN = "";
  const entries: any[] = [];
  const adapter = createModelAdapter(() => {}, async (type, payload) => entries.push({ type, payload }));
  return { entries, result: adapter.compose("compose", new AbortController().signal) };
};

it("runs structured output through the Claude Code CLI without an API key", async () => {
  const { entries, result } = run([
    { type: "system", subtype: "init", session_id: "session-test" },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"newTracks":[]' } } },
    { type: "result", subtype: "success", is_error: false, structured_output: { newTracks: [], rows: [] }, usage: { output_tokens: 3 } },
  ]);
  await expect(result).resolves.toEqual({ newTracks: [], rows: [] });
  const [{ bin, args, options }] = mock.calls;
  expect(bin).toBe("claude");
  expect(args).toEqual(expect.arrayContaining(["-p", "--json-schema", "--model", "haiku"]));
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(mock.stdin).toBe("compose");
  expect(entries.find((entry) => entry.type === "model_response").payload).toMatchObject({
    provider: "claude-subscription",
    requestId: "session-test",
    status: "completed",
    content: '{"newTracks":[],"rows":[]}',
  });
});

it("surfaces a Claude Code login failure as a provider error", async () => {
  const { result } = run([
    { type: "result", subtype: "success", is_error: true, api_error_status: 401, result: "Not logged in" },
  ]);
  await expect(result).rejects.toMatchObject({ message: "PROVIDER_ERROR: Not logged in", status: 401 });
});
