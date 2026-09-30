import { expect, it } from "vitest";
import { newSong, resolveScope, emptyCandidate } from "@eight-bit/core";
import { diagnoseCandidate } from "../src/diagnostics.js";
import { runAgent } from "../src/agent.js";
import { fake } from "./agent-fixtures.js";

it("locates bad tokens, missing brackets, duplicate and missing rows", () => {
  const song = newSong(crypto.randomUUID()), scope = resolveScope(song, { kind: "song" });
  const first = scope.requiredRows[0];
  const diagnostic = diagnoseCandidate({ ...emptyCandidate(scope), scopeId: song.id, rowReplacements: [
    { ...first, body: "[C5 BAD]" }, { ...first, beat: 2, body: "[C5 rest" }, { ...first, body: "[rest]" },
  ] }, scope, song, new Error("STALE_SCOPE"));
  expect(diagnostic.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "scopeId", expected: scope.id, received: song.id }),
    expect.objectContaining({ path: "rowReplacements[0].body", column: 5, token: "BAD" }),
    expect.objectContaining({ path: "rowReplacements[1].body", column: 9 }),
    expect.objectContaining({ path: "rowReplacements[2]", message: "Duplicate row" }),
    expect.objectContaining({ path: "rowReplacements", missingRows: expect.any(Array) }),
  ]));
});

it("keeps dispatcher context separate from worker notation", async () => {
  const song = newSong(crypto.randomUUID()), traces: any[] = [];
  await runAgent({ song, instruction: "compose", selection: { kind: "tracks", trackIds: [song.music.tracks[0].id] }, progress: () => {}, signal: new AbortController().signal, trace: async (type, payload) => traces.push({ type, payload }) }, fake);
  const planning = traces.find((entry) => entry.type === "planning_context")?.payload.text as string;
  expect(planning).toContain("INSTRUMENT_CATALOG");
  expect(planning).toContain("UI_SELECTION");
  expect(planning).toContain('"track":"t1"');
  expect(planning).not.toContain("RHYTHM_TUTORIAL");
  expect(traces.some((entry) => entry.type === "rhythm_grid")).toBe(true);
  expect(traces.some((entry) => entry.type === "aggregate_validation_passed")).toBe(true);
});
