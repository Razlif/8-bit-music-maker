import { describe, expect, it } from "vitest";
import {
  add,
  cmp,
  frac,
  newSong,
  parseRowBody,
  serializeNotation,
  notationRoundTrip,
  validateSong,
  resolveScope,
  validateCandidate,
  listInstruments,
  applyCommand,
} from "../src/index.js";
describe("core music contracts", () => {
  it("resets musical content to defaults without replacing song identity or history", () => {
    const song = newSong(crypto.randomUUID());
    song.title = "Keep my title";
    song.revision = 7;
    song.brief = "Old request";
    song.music.bars = 16;
    song.music.bpm = 150;
    song.music.tracks[0].notes.push({ id: "old-note", kind: "pitched", pitch: "C5", start: frac(0), duration: frac(1), velocity: 100 });
    const result = applyCommand(song, { type: "reset_song" });
    expect(result.music).toEqual(newSong(song.id).music);
    expect(result.title).toBe(song.title);
    expect(result.id).toBe(song.id);
    expect(result.revision).toBe(7);
    expect(result.brief).toBe("");
    expect(song.music.tracks[0].notes).toHaveLength(1);
  });
  it("does exact fraction arithmetic", () => {
    expect(add(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 2 });
    expect(cmp(frac(2, 3), frac(4, 6))).toBe(0);
  });
  it("parses weighted rows and rejects malformed syntax", () => {
    expect(parseRowBody("C5:3 D5:2")).toEqual([
      { token: "C5", weight: 3 },
      { token: "D5", weight: 2 },
    ]);
    expect(() => parseRowBody("C5 [D5]")).toThrow();
  });
  it("serializes a new song through canonical notation", () => {
    const s = newSong(crypto.randomUUID());
    const copy = notationRoundTrip(s);
    expect(copy.music.tracks).toHaveLength(6);
    expect(copy.music.tracks.map(({ name, type, instrumentId }) => [name, type, instrumentId])).toEqual([
      ["Lead", "melodic", "soft_lead"],
      ["Bass", "melodic", "chip_bass"],
      ["Kick", "melodic", "kick"],
      ["Hi-Hat", "melodic", "closed_hat"],
      ["Snare", "melodic", "snare"],
      ["Harmony", "harmonic", "chip_pad"],
    ]);
    expect(serializeNotation(s)).toContain("BAR 4");
  });
  it("keeps reviewed active sounds separate from candidates and retired presets", () => {
    const active = listInstruments().map(({ id }) => id);
    expect(active).toContain("saw_lead");
    expect(active).toContain("fm_bell");
    expect(active).not.toContain("bright_lead");
    expect(listInstruments(true).map(({ id }) => id)).toContain("bright_lead");
    expect(listInstruments(true).map(({ id }) => id)).toContain("synth_brass");
  });
  it("creates a harmonic track when the track contract requests it", () => {
    const song = newSong(crypto.randomUUID());
    const next = applyCommand(song, {
      type: "add_track",
      name: "Harmony Pad",
      instrumentId: "chip_pad",
      trackType: "harmonic",
    });
    expect(next.music.tracks.at(-1)).toMatchObject({
      name: "Harmony Pad",
      instrumentId: "chip_pad",
      type: "harmonic",
    });
  });
  it("rejects instrument swaps that would invalidate existing notes", () => {
    const song = newSong(crypto.randomUUID());
    song.music.tracks[0].notes = [{
      id: "lead-note",
      kind: "pitched",
      pitch: "C5",
      start: frac(0),
      duration: frac(1),
      velocity: 100,
    }];
    expect(() => applyCommand(song, {
      type: "edit_track",
      trackId: song.music.tracks[0].id,
      name: song.music.tracks[0].name,
      instrumentId: "kick",
    })).toThrow(/INSTRUMENT_SWAP_WOULD_INVALIDATE_NOTES/);
  });
  it("rejects overlapping pitched notes", () => {
    const s = newSong(crypto.randomUUID());
    s.music.tracks[0].notes = [
      {
        id: "a",
        kind: "pitched",
        pitch: "C5",
        start: frac(0),
        duration: frac(1),
        velocity: 100,
      },
      {
        id: "b",
        kind: "pitched",
        pitch: "D5",
        start: frac(1, 2),
        duration: frac(1),
        velocity: 100,
      },
    ];
    expect(() => validateSong(s)).toThrow(/OVERLAPPING/);
  });
  it("allows adjacent sustained chord events but rejects actual overlap", () => {
    const s = newSong(crypto.randomUUID()),
      harmony = s.music.tracks.find((track) => track.type === "harmonic")!;
    harmony.notes = [
      ...(["D3", "F3", "A3"] as const).map((pitch, index) => ({
        id: "chord-a-" + index,
        kind: "pitched" as const,
        pitch,
        start: frac(0),
        duration: frac(4),
        velocity: 100,
      })),
      ...(["A#2", "D3", "F3"] as const).map((pitch, index) => ({
        id: "chord-b-" + index,
        kind: "pitched" as const,
        pitch,
        start: frac(4),
        duration: frac(4),
        velocity: 100,
      })),
    ];
    expect(() => validateSong(s)).not.toThrow();
    harmony.notes[3].start = frac(3);
    expect(() => validateSong(s)).toThrow(/OVERLAPPING_CHORD_EVENTS/);
  });
  it("protects a note outside a selected scope", () => {
    const s = newSong(crypto.randomUUID());
    s.music.tracks[0].notes = [
      {
        id: "a",
        kind: "pitched",
        pitch: "C5",
        start: frac(0),
        duration: frac(1),
        velocity: 100,
      },
      {
        id: "b",
        kind: "pitched",
        pitch: "D5",
        start: frac(2),
        duration: frac(1),
        velocity: 100,
      },
    ];
    const scope = resolveScope(s, { kind: "notes", noteIds: ["a"] }, "pitch");
    const next = structuredClone(s);
    next.music.tracks[0].notes[1].pitch = "E5";
    const candidate = {
      scopeId: scope.id,
      baseRevision: s.revision,
      newTracks: [],
      eventUpdates: [],
      deletedNoteIds: [],
      removedTrackIds: [],
      rowReplacements: [],
      metadataChanges: [],
    };
    expect(() => validateCandidate(s, scope, candidate, next)).toThrow(
      /SCOPE_VIOLATION/,
    );
  });
});
