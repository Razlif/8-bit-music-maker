import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { newSong } from "@eight-bit/core";
import { runAgent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { fake } from "./agent-fixtures.js";

const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
const sheet = {
  title: "Test tune",
  key: "C major",
  timeSignature: "4/4",
  tempo: "",
  parts: [{ name: "Melody", bars: ["C4:1 D4:1 E4:2", "G4:4", "A4:4", "B4:4", "C5:4"] }],
  notes: "",
};

it("transcribes an uploaded sheet once and hands it to the dispatcher and workers", async () => {
  const prompts = { orchestrate: "", rhythm: [] as string[], pitch: [] as string[] };
  const reads: any[] = [];
  const song = newSong(crypto.randomUUID());
  await runAgent(
    { song, instruction: "transcribe", selection: { kind: "song" }, sheet: { filename: "tune.pdf", data: pdf }, signal: new AbortController().signal, progress: () => {} },
    {
      ...fake,
      readSheet: async (file, bars) => {
        reads.push({ file, bars });
        return sheet;
      },
      orchestrate: (input, ...rest) => {
        prompts.orchestrate = input;
        return fake.orchestrate(input, ...rest);
      },
      rhythm: (input, ...rest) => {
        prompts.rhythm.push(input);
        return fake.rhythm!(input, ...rest);
      },
      pitch: (input, ...rest) => {
        prompts.pitch.push(input);
        return fake.pitch!(input, ...rest);
      },
    },
  );
  expect(reads).toEqual([{ file: { filename: "tune.pdf", data: pdf }, bars: song.music.bars }]);
  expect(prompts.orchestrate).toContain("SHEET_MUSIC");
  expect(prompts.orchestrate).toContain("C4:1 D4:1 E4:2");
  // Bars beyond the song are not offered to the dispatcher.
  expect(prompts.orchestrate).not.toContain("C5:4");
  for (const prompt of [...prompts.rhythm, ...prompts.pitch]) expect(prompt).toContain("SHEET_EXCERPT");
  expect(prompts.rhythm.length).toBeGreaterThan(0);
});

it("fails clearly when the PDF holds no music, and leaves requests without a sheet untouched", async () => {
  const base = { song: newSong(crypto.randomUUID()), instruction: "compose", selection: { kind: "song" as const }, signal: new AbortController().signal, progress: () => {} };
  await expect(
    runAgent({ ...base, sheet: { filename: "letter.pdf", data: pdf } }, { ...fake, readSheet: async () => ({ ...sheet, parts: [], notes: "A letter." }) }),
  ).rejects.toThrow("SHEET_UNREADABLE");
  let prompt = "";
  await runAgent(base, { ...fake, orchestrate: (input, ...rest) => ((prompt = input), fake.orchestrate(input, ...rest)) });
  expect(prompt).not.toContain("SHEET");
});

it("rejects an upload that is not a PDF", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chip-sheet-"));
  const { app, library } = await createApp({ rootDir: process.cwd(), songsDir: root, port: 3998, runTimeoutMs: 15000, composerModel: "test", orchestratorModel: "test" }, fake);
  try {
    const song = await library.create();
    const response = await app.inject({
      method: "POST",
      url: `/api/songs/${song.id}/runs`,
      payload: { instruction: "transcribe", selection: { kind: "song" }, expectedRevision: 0, sheet: { filename: "notes.txt", data: Buffer.from("plain text").toString("base64") } },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json())).toContain("not a PDF");
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
