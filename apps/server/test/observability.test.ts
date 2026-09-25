import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newSong, emptyCandidate, type Scope } from "@eight-bit/core";
const mock = vi.hoisted(() => ({ content: "", calls: 0, interrupt: false }));
vi.mock("openai", () => ({ default: class {
  static APIError = class extends Error {};
  responses = { create: () => ({ withResponse: async () => {
    mock.calls++;
    return { response: { headers: new Headers({ "x-request-id": "req-test" }) }, data: (async function* () {
      yield { type: "response.reasoning_summary_text.delta", delta: "Planning a bass line.", item_id: "rs1", summary_index: 0 };
      yield { type: "response.output_text.delta", delta: mock.content, item_id: "msg1" };
      if (mock.interrupt) throw new Error("connection interrupted");
      yield { type: "response.completed", response: { id: "response1", status: "completed", model: "test-model", usage: { total_tokens: 12 }, output: [
        { type: "reasoning", encrypted_content: "DO_NOT_CAPTURE", summary: [{ type: "summary_text", text: "Planning a bass line." }] },
        { type: "message", content: [{ type: "output_text", text: mock.content }] },
      ] } };
    })() };
  } }) };
} }));
import { createModelAdapter, runAgent, type ModelAdapter } from "../src/agent.js";
import { createApp } from "../src/app.js";

it("captures exact requests before the provider and malformed responses before parsing", async () => {
  const entries: any[] = [];
  mock.calls = 0; mock.content = "not-json";
  const adapter = createModelAdapter(() => {}, async (type, payload) => {
    if (type === "model_request") expect(mock.calls).toBe(0);
    entries.push({ type, payload });
  });
  await expect(adapter.compose('{"instruction":"compose"}', new AbortController().signal)).rejects.toThrow();
  expect(entries.map(e => e.type)).toContain("model_parse_error");
  expect(entries[0].payload.request.input[1].content).toContain('"instruction":"compose"');
  expect(entries[0].payload.request.text.format.type).toBe("json_schema");
  expect(entries.find(e => e.type === "model_response").payload).toMatchObject({ requestId: "req-test", content: "not-json" });
  expect(JSON.stringify(entries)).not.toContain("Authorization");
  expect(JSON.stringify(entries)).not.toContain("DO_NOT_CAPTURE");
});

it("streams summaries before completion and saves partial output on interruption", async () => {
  const entries: any[] = [], updates: any[] = [];
  mock.content = '{"kind":'; mock.interrupt = true;
  try {
    const adapter = createModelAdapter((type, payload) => updates.push({ type, payload }), async (type, payload) => { entries.push({ type, payload }); });
    await expect(adapter.compose("compose", new AbortController().signal)).rejects.toThrow("connection interrupted");
    expect(updates.find(e => e.type === "model_stream").payload.summary).toBe("Planning a bass line.");
    expect(entries.find(e => e.type === "model_error").payload.partialOutput).toBe(mock.content);
    expect(entries.some(e => e.type === "model_response")).toBe(false);
  } finally { mock.interrupt = false; }
});

it("does not call the provider when request checkpointing fails", async () => {
  mock.calls = 0;
  const adapter = createModelAdapter(() => {}, async () => { throw new Error("disk full"); });
  await expect(adapter.compose("test", new AbortController().signal)).rejects.toThrow("disk full");
  expect(mock.calls).toBe(0);
});

import { fake } from "./agent-fixtures.js";
it("rejects malformed dispatcher output before any worker runs", async () => {
  const entries: any[] = [];
  await expect(runAgent({ song: newSong(crypto.randomUUID()), instruction: "compose", selection: { kind: "song" },
    signal: new AbortController().signal, progress: () => {}, trace: async (type, payload) => { entries.push({ type, payload }); },
  }, { ...fake, orchestrate: async () => ({ invalid: true }) })).rejects.toThrow();
  expect(entries.some((entry) => entry.type === "planning_context")).toBe(true);
});

it("persists trace history across server restart with the starting snapshot and validation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chip-trace-"));
  const config = { rootDir: process.cwd(), songsDir: root, port: 3999, runTimeoutMs: 15000, composerModel: "test", orchestratorModel: "test" };
  let instance = await createApp(config, fake);
  try {
    const song = await instance.library.create();
    const response = await instance.app.inject({ method: "POST", url: `/api/songs/${song.id}/runs`, payload: { instruction: "compose", selection: { kind: "song" }, expectedRevision: 0 } });
    const { runId } = response.json();
    expect(runId).toBeTruthy();
    await vi.waitFor(async () => expect((await instance.app.inject(`/api/runs/${runId}`)).json().status).toBe("completed"), { timeout: 10000 });
    const url = `/api/songs/${song.id}/runs/${runId}/trace`;
    const trace = (await instance.app.inject(url)).json();
    expect(trace.trace[0].payload.song.id).toBe(song.id);
    expect(trace.trace.some((e: any) => e.type === "aggregate_validation_passed")).toBe(true);
    await instance.app.close();
    instance = await createApp(config, fake);
    expect((await instance.app.inject(url)).json().status).toBe("completed");
    expect((await instance.app.inject(`/api/songs/${song.id}/runs`)).json()[0].id).toBe(runId);
  } finally { await instance.app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
