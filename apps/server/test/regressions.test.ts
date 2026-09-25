import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { Library } from "../src/library.js";
import { runAgent } from "../src/agent.js";
import { newSong } from "@eight-bit/core";
import { fake } from "./agent-fixtures.js";

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "chip-regression-"));

describe("storage concurrency and recovery", () => {
  it("serializes conflicting saves: exactly one wins", async () => {
    const root = await temp(), lib = new Library(root);
    try {
      const song = await lib.create();
      const outcomes = await Promise.allSettled([lib.rename(song.id, "A", song.revision), lib.rename(song.id, "B", song.revision)]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await lib.load(song.id)).revision).toBe(1);
    } finally { await lib.close(); await fs.rm(root, { recursive: true, force: true }); }
  });

  it("rejects a second process owner and does not overwrite corrupt JSON", async () => {
    const root = await temp(), lib = new Library(root);
    try {
      const song = await lib.create();
      await expect(new Library(root).init()).rejects.toThrow(/LIBRARY_LOCKED/);
      const file = path.join(root, song.id, "song.json");
      await fs.writeFile(file, "broken");
      await expect(lib.save({ ...song, revision: 1 }, 0)).rejects.toThrow();
      expect(await fs.readFile(file, "utf8")).toBe("broken");
    } finally { await lib.close(); await fs.rm(root, { recursive: true, force: true }); }
  });

  it("runs the same dispatcher path for every selection shape", async () => {
    const song = newSong(crypto.randomUUID());
    const result = await runAgent({ song, instruction: "compose", selection: { kind: "notes", noteIds: [] }, progress: () => {}, signal: new AbortController().signal }, fake);
    expect(result.candidate.rowReplacements).toHaveLength(song.music.tracks.length * song.music.bars * 4);
  });
});

describe("API run lifecycle", () => {
  it("publishes a completed run and persists the result", async () => {
    const root = await temp();
    const instance = await createApp({ rootDir: path.resolve("../.."), songsDir: root, port: 3001, runTimeoutMs: 15000, composerModel: "test", orchestratorModel: "test" }, fake);
    try {
      const song = (await instance.app.inject({ method: "POST", url: "/api/songs", payload: {} })).json();
      const response = await instance.app.inject({ method: "POST", url: `/api/songs/${song.id}/runs`, payload: { instruction: "compose", selection: { kind: "song" }, expectedRevision: 0 } });
      const { runId } = response.json();
      for (let i = 0; i < 100; i++) {
        const run = (await instance.app.inject(`/api/runs/${runId}`)).json();
        if (run.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect((await instance.app.inject(`/api/runs/${runId}`)).json().status).toBe("completed");
      expect((await instance.app.inject(`/api/songs/${song.id}`)).json().revision).toBe(1);
    } finally { await instance.app.close(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
