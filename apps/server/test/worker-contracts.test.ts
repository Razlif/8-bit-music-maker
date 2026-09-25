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
