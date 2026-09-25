import type { ModelAdapter } from "../src/agent.js";
export const snippetOf = (prompt: string): any[] => JSON.parse(prompt.split("EDITABLE_SNIPPET\n")[1].split("\nOUTPUT_CONTRACT")[0]);
export const orchestrationFor = (prompt: string) => {
  const context = JSON.parse(prompt.split("SONG_CONTEXT\n")[1].split("\nINSTRUMENT_CATALOG")[0]);
  return {
    brief: "Use each existing track across the loop.",
    tasks: context.tracks.map((track: any) => {
      const hit = ["kick", "snare", "closed_hat"].includes(track.instrument);
      return {
        id: `task-${track.track}`,
        track: track.track,
        instrumentId: track.instrument,
        startBar: 1,
        endBar: context.bars,
        type: "melodic",
        rhythmInstruction: hit ? "sparse quarter-note attacks with space" : "quarter-note pulse with a small repeated cell",
        sections: [{ startBar: 1, endBar: context.bars, instruction: "repeat a clear one-bar cell and return at the end" }],
        harmony: hit ? null : "C major",
        register: hit ? null : track.instrument === "chip_bass" ? "C2-G2" : "C4-G4",
        pitchInstruction: hit ? null : "use a compact resolving motif",
        voicing: null,
      };
    }),
    newTracks: [],
    progression: [],
  };
};
export const planFor = orchestrationFor;
export const testPlan = orchestrationFor("SONG_CONTEXT\n{\"bars\":1,\"tracks\":[]}\nINSTRUMENT_CATALOG");
export const fake: ModelAdapter = {
  plan: async () => ({ brief: "legacy test plan", targets: [{ track: "t1", startBar: 1, endBar: 1 }], newTrack: null, harmony: "C major", groove: "pulse", motif: "cell", development: "return", workOrders: [{ id: "w1", track: "t1", startBar: 1, endBar: 1, rhythmBrief: "pulse", pitchBrief: "motif" }] }),
  orchestrate: async prompt => orchestrationFor(prompt),
  rhythm: async prompt => {
    const start = prompt.lastIndexOf("TARGET_ROWS\n") + "TARGET_ROWS\n".length;
    const end = prompt.indexOf("\nRHYTHM_LANGUAGE", start);
    const rows = JSON.parse(prompt.slice(start, end));
    const hit = /instrumentId":"(?:kick|snare|closed_hat)/.test(prompt);
    return { rows: rows.map((row: any) => ({ rowRef: row.rowRef, pattern: row.beat === 1 ? (hit ? "x..." : "x---") : "...." })) };
  },
  pitch: async prompt => {
    const rows = JSON.parse(prompt.split("LOCKED_RHYTHM\n")[1].split("\nPITCH_RULE")[0]);
    const note = prompt.includes('"instrumentId":"chip_bass"') ? "C2" : "C4";
    return { rows: rows.map((row: any) => ({ rowRef: row.rowRef, pitches: Array(row.requiredPitchCount).fill(note) })) };
  },
  compose: async prompt => {
    const rows = snippetOf(prompt);
    return { newTracks: [], rows: rows.map(r => ({ rowRef: r.rowRef, body: r.body })) };
  },
};
