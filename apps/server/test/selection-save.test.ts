import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { fake } from "./agent-fixtures.js";

it.each(["json", "notation"])("applies only the selected track at the HTTP save boundary (%s)", async rhythmFormat => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chip-selection-"));
  const adapter = { ...fake, rhythm: async (...args: Parameters<NonNullable<typeof fake.rhythm>>) => {
    const output = await fake.rhythm!(...args) as { rows: Array<{ rowRef: string; events: Array<{ token: string; weight: number }> }> };
    return rhythmFormat === "json" ? output : { rows: output.rows.map(row => ({
      rowRef: row.rowRef,
      pattern: row.events.map(e => `${e.token === "attack" ? "x" : e.token === "hold" ? "-" : "."}:${e.weight}`).join(" "),
    })) };
  } };
  const instance = await createApp({ rootDir: process.cwd(), songsDir: root, port: 3999, runTimeoutMs: 15000, composerModel: "test", orchestratorModel: "test" }, adapter);
  try {
    const song = await instance.library.create();
    const response = await instance.app.inject({ method: "POST", url: `/api/songs/${song.id}/runs`, payload: {
      instruction: "compose all tracks", selection: { kind: "tracks", trackIds: [song.music.tracks[0].id] }, rhythmFormat, expectedRevision: song.revision,
    } });
    const runId = response.json().runId;
    for (let i = 0; i < 200; i++) {
      const run = (await instance.app.inject({ method: "GET", url: `/api/runs/${runId}` })).json();
      if (run.status !== "running") { expect(run.status, JSON.stringify(run.error)).toBe("completed"); break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const saved = await instance.library.load(song.id);
    expect(saved.music.tracks[0].notes.length).toBeGreaterThan(0);
    expect(saved.music.tracks.slice(1)).toEqual(song.music.tracks.slice(1));
    expect(saved.music.key).toEqual(song.music.key);
    const trace = (await instance.app.inject({ method: "GET", url: `/api/runs/${runId}/trace` })).json();
    expect(trace.events.some((e: any) => e.type === "selection_applied")).toBe(true);
  } finally { await instance.app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
