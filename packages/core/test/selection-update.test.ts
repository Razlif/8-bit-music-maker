import { expect, it } from "vitest";
import { newSong, frac, trimUpdateToSelection, type Note } from "../src/index.js";
const note = (id: string, start: number, duration: number, pitch = "C5"): Note =>
  ({ id, start: frac(start), duration: frac(duration), kind: "pitched", pitch, velocity: 100 });

it("keeps whole-song updates and filters track updates including global metadata/new tracks", () => {
  const base = newSong(crypto.randomUUID()), generated = structuredClone(base);
  generated.music.key = { root: "D" };
  generated.music.tracks[0].notes = [note("lead", 0, 1)];
  generated.music.tracks[1].notes = [note("bass", 0, 1, "D2")];
  generated.music.tracks.push({ ...generated.music.tracks[0], id: "new", notes: [] });
  expect(trimUpdateToSelection(base, generated, { kind: "song" })).toEqual(generated);
  const next = trimUpdateToSelection(base, generated, { kind: "tracks", trackIds: ["track-lead"] });
  expect(next.music.tracks[0].notes).toHaveLength(1);
  expect(next.music.tracks.slice(1)).toEqual(base.music.tracks.slice(1));
  expect(next.music.key).toBeNull();
});

it("clips generated notes and preserves original boundary-crossing notes exactly", () => {
  const base = newSong(crypto.randomUUID()), generated = structuredClone(base);
  base.music.tracks[0].notes = [note("protected", 0, 2), note("replace", 2, 1), note("outside", 4, 1)];
  generated.music.tracks[0].notes = [note("new", 0, 8, "D5")];
  const next = trimUpdateToSelection(base, generated, { kind: "regions", regions: [
    { trackIds: ["track-lead"], start: frac(1), end: frac(3) },
    { trackIds: ["track-lead"], start: frac(2), end: frac(7, 2) },
  ] });
  expect(next.music.tracks[0].notes[0]).toEqual(base.music.tracks[0].notes[0]);
  expect(next.music.tracks[0].notes[1]).toMatchObject({ pitch: "D5", start: frac(2), duration: frac(3, 2) });
  expect(next.music.tracks[0].notes[2]).toEqual(base.music.tracks[0].notes[2]);
});

it("supports deletion and disjoint selected note spans without touching neighbors", () => {
  const base = newSong(crypto.randomUUID()), generated = structuredClone(base);
  base.music.tracks[0].notes = [note("a", 0, 1), note("b", 1, 1), note("c", 3, 1)];
  generated.music.tracks[0].notes = [note("new", 3, 2, "E5")];
  const next = trimUpdateToSelection(base, generated, { kind: "notes", noteIds: ["a", "c"] });
  expect(next.music.tracks[0].notes).toHaveLength(2);
  expect(next.music.tracks[0].notes[0]).toEqual(base.music.tracks[0].notes[1]);
  expect(next.music.tracks[0].notes[1]).toMatchObject({ pitch: "E5", start: frac(3), duration: frac(1) });
});

it("clips harmonic voices together without overlapping a protected chord", () => {
  const base = newSong(crypto.randomUUID()), generated = structuredClone(base);
  base.music.tracks[5].notes = [note("a", 0, 2), note("b", 0, 2, "E5")];
  generated.music.tracks[5].notes = [note("c", 0, 8, "D5"), note("d", 0, 8, "F5")];
  const next = trimUpdateToSelection(base, generated, { kind: "regions", regions: [
    { trackIds: ["track-harmony"], start: frac(1), end: frac(4) },
  ] });
  expect(next.music.tracks[5].notes.slice(0, 2)).toEqual(base.music.tracks[5].notes);
  expect(next.music.tracks[5].notes.slice(2).every(n => n.start.n === 2 && n.duration.n === 2)).toBe(true);
});

it("preserves unselected chord voices when selecting an individual note", () => {
  const base = newSong(crypto.randomUUID()), generated = structuredClone(base);
  base.music.tracks[5].notes = [note("a", 0, 1), note("b", 0, 1, "E5")];
  generated.music.tracks[5].notes = [note("c", 0, 1, "D5"), note("d", 0, 1, "F5")];
  const next = trimUpdateToSelection(base, generated, { kind: "notes", noteIds: ["a"] });
  expect(next.music.tracks[5].notes).toContainEqual(base.music.tracks[5].notes[1]);
  expect(next.music.tracks[5].notes).toContainEqual({ ...base.music.tracks[5].notes[0], pitch: "D5" });
});
