import { expect, it, vi } from "vitest";
import { newSong, frac } from "@eight-bit/core";
import { runAgent } from "../src/agent.js";
import { fake, orchestrationFor } from "./agent-fixtures.js";

it("repairs palette output, binds shuffled rhythm by ID, and skips percussion pitch calls", async () => {
  const song = newSong(crypto.randomUUID());
  const trace: string[] = [];
  const pitch = vi.fn(async (prompt: string) => {
    expect(prompt).toContain('"harmony":"C minor"');
    expect(prompt).toContain('"requiredPitchCount":1');
    const rows = JSON.parse(prompt.split("LOCKED_RHYTHM\n")[1].split("\nPITCH_RULE")[0]);
    return { rows: rows.map((r: any) => ({ rowRef: r.rowRef, pitches: prompt.includes("REPAIR\n") ? Array(r.requiredPitchCount).fill("C2") : ["C2", "Eb2", "G2", "D2"] })) };
  });
  const result = await runAgent({ song, instruction: "drums and bass", selection: {kind:"song"}, signal: new AbortController().signal, progress:()=>{}, trace: async type => { trace.push(type); } }, {
    ...fake,
    orchestrate: async prompt => {
      const plan = orchestrationFor(prompt);
      return {...plan, tasks: plan.tasks.filter((t:any)=>t.track==="t2" || t.track==="t3").map((t:any)=>({...t, harmony:t.track==="t2"?"C minor":null, register:t.track==="t2"?"C2-G2":null, pitchInstruction:t.track==="t2"?"compact motif":null}))};
    },
    rhythm: async prompt => {
      const rows = JSON.parse(prompt.split("TARGET_ROWS\n")[1].split("\nRHYTHM_LANGUAGE")[0]);
      return {rows:rows.map((r:any)=>({rowRef:r.rowRef,pattern:r.beat===1?"x...":"...."})).reverse()};
    },
    pitch,
    compose: async()=>{throw new Error("Unexpected full-notation worker");},
  });
  expect(pitch).toHaveBeenCalledTimes(2);
  expect(trace).toContain("pitch_validation_failed");
  expect(result.next.music.tracks[1].notes).toHaveLength(4);
  expect(result.next.music.tracks[1].notes[0]).toMatchObject({pitch:"C2",start:frac(0),duration:frac(1,4)});
  expect(result.next.music.tracks[2].notes).toHaveLength(4);
  expect(result.next.music.tracks[0].notes).toHaveLength(0);
});

const harmonicPlan = () => ({
  brief: "Four bars of offbeat block chords.",
  tasks: [{
    id: "task-harmony",
    track: "t6",
    instrumentId: "chip_pad",
    startBar: 1,
    endBar: 4,
    type: "harmonic" as const,
    rhythmInstruction: "Play short chord stabs on the offbeats.",
    sections: [{ startBar: 1, endBar: 4, instruction: "Use the same offbeat placement in every bar." }],
    harmony: null,
    register: "C3-C5",
    pitchInstruction: null,
    voicing: "root" as const,
  }],
  newTracks: [],
  progression: [
    { startBeat: 0, endBeat: 4, root: "C", quality: "major" as const },
    { startBeat: 4, endBeat: 8, root: "F", quality: "major" as const },
    { startBeat: 8, endBeat: 12, root: "G", quality: "major" as const },
    { startBeat: 12, endBeat: 16, root: "C", quality: "major" as const },
  ],
});

it("allows silence at chord boundaries and applies the active chord to later attacks", async () => {
  const song = newSong(crypto.randomUUID());
  const result = await runAgent({
    song,
    instruction: "play reggae chord chops",
    selection: { kind: "song" },
    signal: new AbortController().signal,
    progress: () => {},
  }, {
    ...fake,
    orchestrate: async () => harmonicPlan(),
    rhythm: async prompt => {
      expect(prompt).toContain("HARMONY_BOUNDARIES");
      expect(prompt).toContain("first slot may be x or . but never -");
      const rows = JSON.parse(prompt.split("TARGET_ROWS\n")[1].split("\nHARMONY_BOUNDARIES")[0]);
      return { rows: rows.map((row: any) => ({ rowRef: row.rowRef, pattern: "..x." })) };
    },
    pitch: async () => { throw new Error("Harmonic tracks do not use the pitch worker"); },
    compose: async () => { throw new Error("Unexpected full-notation worker"); },
  });

  const harmony = result.next.music.tracks.find(track => track.id === "track-harmony")!;
  expect(harmony.notes).toHaveLength(48);
  expect(harmony.notes.slice(0, 3).map(note => note.kind === "pitched" ? note.pitch : "hit")).toEqual(["C4", "E4", "G4"]);
  expect(harmony.notes[0]).toMatchObject({ start: frac(1, 2), duration: frac(1, 4) });
});

it("retries a harmonic rhythm that holds the previous chord across a boundary", async () => {
  const song = newSong(crypto.randomUUID());
  const trace: Array<{ type: string; payload: unknown }> = [];
  const rhythm = vi.fn(async (prompt: string) => {
    const rows = JSON.parse(prompt.split("TARGET_ROWS\n")[1].split("\nHARMONY_BOUNDARIES")[0]);
    const repairing = prompt.includes("CHORD_CHANGE_CANNOT_HOLD");
    return {
      rows: rows.map((row: any) => ({
        rowRef: row.rowRef,
        pattern: !repairing && row.bar === 2 && row.beat === 1
          ? "-..."
          : row.beat === 1 ? "x..." : row.bar === 1 && row.beat === 4 ? "x---" : "....",
      })),
    };
  });

  const result = await runAgent({
    song,
    instruction: "play sustained block chords",
    selection: { kind: "song" },
    signal: new AbortController().signal,
    progress: () => {},
    trace: async (type, payload) => { trace.push({ type, payload }); },
  }, {
    ...fake,
    orchestrate: async () => harmonicPlan(),
    rhythm,
    pitch: async () => { throw new Error("Harmonic tracks do not use the pitch worker"); },
    compose: async () => { throw new Error("Unexpected full-notation worker"); },
  });

  expect(rhythm).toHaveBeenCalledTimes(2);
  expect(trace.some(entry => entry.type === "rhythm_validation_failed" && JSON.stringify(entry.payload).includes("CHORD_CHANGE_CANNOT_HOLD: beat 4"))).toBe(true);
  expect(result.next.music.tracks.find(track => track.id === "track-harmony")!.notes.length).toBeGreaterThan(0);
});
