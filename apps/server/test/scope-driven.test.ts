import { expect, it, vi } from "vitest";
import { newSong } from "@eight-bit/core";
import { arrangementScope, runAgent, partitionRows, requestScope, type RunInput } from "../src/agent.js";
import { fake, orchestrationFor } from "./agent-fixtures.js";

const input = (song = newSong(crypto.randomUUID())): RunInput => ({
  song,
  instruction: "write a groove",
  selection: { kind: "tracks", trackIds: [song.music.tracks[0].id] },
  signal: new AbortController().signal,
  progress: () => {},
});

it("uses whole-song AI scope even when the UI has a manual track selection", async () => {
  const req = input(), orchestrate = vi.fn(fake.orchestrate);
  const result = await runAgent(req, { ...fake, orchestrate });
  expect(orchestrate).toHaveBeenCalledTimes(1);
  expect(result.candidate.rowReplacements).toHaveLength(req.song.music.tracks.length * req.song.music.bars * 4);
  expect(result.next.music.tracks.every((track) => track.notes.length > 0 || track.instrumentId === "closed_hat")).toBe(true);
});

it("keeps worker passages track-local and bounded", async () => {
  const song = newSong(crypto.randomUUID()); song.music.bars = 8;
  const rhythm = vi.fn(fake.rhythm), pitch = vi.fn(fake.pitch);
  const result = await runAgent({ ...input(song), selection: { kind: "song" } }, { ...fake, rhythm, pitch });
  expect(rhythm).toHaveBeenCalledTimes(12);
  expect(pitch).toHaveBeenCalledTimes(4);
  for (const call of rhythm.mock.calls) {
    const start = call[0].lastIndexOf("TARGET_ROWS\n") + "TARGET_ROWS\n".length;
    const rows = JSON.parse(call[0].slice(start).split(/\n[A-Z_]+\n/)[0]);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(new Set(rows.map((row: any) => row.track))).toHaveLength(1);
  }
  expect(result.candidate.rowReplacements).toHaveLength(8 * 4 * song.music.tracks.length);
});

it("supports multiple new tracks in one orchestration", async () => {
  const song = newSong(crypto.randomUUID());
  const orchestrate = async (prompt: string) => {
    const plan = orchestrationFor(prompt);
    return {
      ...plan,
      tasks: plan.tasks.slice(0, 2).concat([
        { id: "task-new1", track: "new1", instrumentId: "soft_lead", type: "melodic", startBar: 1, endBar: 4, rhythmInstruction: "short syncopated phrase", sections: [{ startBar: 1, endBar: 4, instruction: "repeat and vary" }], harmony: "C major", register: "C4-G4", pitchInstruction: "answer the lead", voicing: null },
        { id: "task-new2", track: "new2", instrumentId: "snare", type: "melodic", startBar: 1, endBar: 4, rhythmInstruction: "beats 2 and 4", sections: [{ startBar: 1, endBar: 4, instruction: "steady backbeat" }], harmony: null, register: null, pitchInstruction: null, voicing: null },
      ]),
      newTracks: [
        { ref: "new1", name: "Counter", instrumentId: "soft_lead", type: "melodic", startBar: 1, endBar: 4 },
        { ref: "new2", name: "Snare", instrumentId: "snare", type: "melodic", startBar: 1, endBar: 4 },
      ],
      progression: [],
    };
  };
  const result = await runAgent({ ...input(song), selection: { kind: "song" } }, { ...fake, orchestrate });
  expect(result.next.music.tracks).toHaveLength(8);
  expect(result.candidate.newTracks).toHaveLength(2);
});

it("rejects non-contiguous dispatcher sections before workers run", async () => {
  const song = newSong(crypto.randomUUID());
  const orchestrate = async (prompt: string) => {
    const plan = orchestrationFor(prompt);
    plan.tasks[0].sections = [{ startBar: 1, endBar: 1, instruction: "only the first bar" }];
    return plan;
  };
  await expect(runAgent({ ...input(song), selection: { kind: "song" } }, { ...fake, orchestrate })).rejects.toThrow("INCOMPLETE_TASK_SECTIONS");
});

it("bounds a 32-bar song into four-bar worker passages", () => {
  const req = input(); req.song.music.bars = 32;
  expect(partitionRows(requestScope(req)).every((rows) => rows.length <= 32)).toBe(true);
});

it("rejects a ninth track deterministically", () => {
  const req = input();
  while (req.song.music.tracks.length < 8) req.song.music.tracks.push({ ...structuredClone(req.song.music.tracks[0]), id: crypto.randomUUID() });
  const plan = {
    brief: "too many tracks",
    tasks: [{ id: "task-new1", track: "new1", instrumentId: "soft_lead", type: "melodic", startBar: 1, endBar: 1, rhythmInstruction: "pulse", sections: [{ startBar: 1, endBar: 1, instruction: "pulse" }], harmony: "C major", register: "C4-G4", pitchInstruction: "short", voicing: null }],
    newTracks: [{ ref: "new1", name: "Ninth", instrumentId: "soft_lead", type: "melodic", startBar: 1, endBar: 1 }],
    progression: [],
  };
  expect(() => arrangementScope(req, requestScope(req), plan)).toThrow("TRACK_LIMIT");
});
