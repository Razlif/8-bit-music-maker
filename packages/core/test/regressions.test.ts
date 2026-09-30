import { describe, it, expect } from "vitest";
import {
  newSong,
  frac,
  add,
  resolveScope,
  validateCandidate,
  emptyCandidate,
  buildCandidate,
  compileRows,
  parseNotation,
  serializeNotation,
  notationRoundTrip,
  validateSong,
  applyCommand,
  type Note,
} from "../src/index.js";
const fixture = () => {
  const s = newSong(crypto.randomUUID());
  s.music.tracks[0].notes = [
    {
      id: "a",
      kind: "pitched",
      pitch: "C5",
      start: frac(0),
      duration: frac(1),
      velocity: 73,
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
  return s;
};
describe("scope regressions", () => {
  it("accepts an unchanged protected neighbor; rejects deleting it", () => {
    const s = fixture(),
      scope = resolveScope(s, { kind: "notes", noteIds: ["a"] }, "pitch"),
      c = emptyCandidate(scope);
    expect(() =>
      validateCandidate(s, scope, c, structuredClone(s)),
    ).not.toThrow();
    const next = structuredClone(s);
    next.music.tracks[0].notes.pop();
    expect(() => validateCandidate(s, scope, c, next)).toThrow(
      /protected event b/,
    );
  });
  it("protects same-track notes outside the selected time and all mix metadata", () => {
    const s = fixture(),
      scope = resolveScope(s, {
        kind: "regions",
        regions: [{ start: frac(0), end: frac(1), trackIds: ["track-lead"] }],
      }),
      c = emptyCandidate(scope);
    const next = structuredClone(s);
    next.music.tracks[0].notes[1].pitch = "E5";
    expect(() => validateCandidate(s, scope, c, next)).toThrow(/protected/);
    const mix = structuredClone(s);
    mix.music.tracks[0].volumeDb = 0;
    expect(() => validateCandidate(s, scope, c, mix)).toThrow(/volumeDb/);
  });
  it("rejects moving identity to another track and new notes in protected silence", () => {
    const s = fixture(),
      scope = resolveScope(s, { kind: "notes", noteIds: ["a"] }, "pitch"),
      c = emptyCandidate(scope);
    const next = structuredClone(s);
    next.music.tracks[1].notes.push(next.music.tracks[0].notes.pop()!);
    expect(() => validateCandidate(s, scope, c, next)).toThrow();
    const silence = structuredClone(s);
    silence.music.tracks[0].notes.push({
      ...silence.music.tracks[0].notes[0],
      id: "x",
      start: frac(4),
    });
    expect(() => validateCandidate(s, scope, c, silence)).toThrow(/inserted/);
  });
  it("preserves exact IDs and velocity in a full-beat pitch-only rewrite", () => {
    const s = fixture(),
      scope = resolveScope(s, { kind: "notes", noteIds: ["a"] }, "pitch"),
      c = emptyCandidate(scope);
    c.rowReplacements = [
      { trackRef: "track-lead", bar: 1, beat: 1, body: "[E5]" },
    ];
    const next = buildCandidate(s, scope, c).next;
    expect(next.music.tracks[0].notes[0]).toMatchObject({
      id: "a",
      pitch: "E5",
      velocity: 73,
    });
    expect(next.music.tracks[0].notes[1]).toEqual(s.music.tracks[0].notes[1]);
  });
  it("rejects missing rows, duplicate operations and unapproved tracks", () => {
    const s = fixture(),
      scope = resolveScope(s, { kind: "tracks", trackIds: ["track-lead"] }),
      c = emptyCandidate(scope);
    c.rowReplacements = [
      { trackRef: "track-lead", bar: 1, beat: 1, body: "[rest]" },
    ];
    expect(() => buildCandidate(s, scope, c)).toThrow(/MISSING_REQUIRED/);
    c.rowReplacements.push(c.rowReplacements[0]);
    expect(() => buildCandidate(s, scope, c)).toThrow(/DUPLICATE/);
    c.rowReplacements = [];
    c.newTracks = [
      { ref: "new_lead", name: "New", instrumentId: "bright_lead" },
    ];
    expect(() => buildCandidate(s, scope, c)).toThrow(/SCOPE/);
  });
  it("atomically creates a permitted new track and rewrites an existing beat", () => {
    const s = fixture(),
      scope = resolveScope(s, {
        kind: "regions",
        regions: [{ start: frac(0), end: frac(1), trackIds: ["track-lead"] }],
      }),
      c = emptyCandidate(scope);
    scope.newTrackRules = [
      { ref: "new_lead", type: "melodic", permittedSpan: { start: frac(0), end: frac(1) } },
    ];
    scope.requiredRows.push({ trackRef: "new_lead", bar: 1, beat: 1 });
    c.newTracks = [
      { ref: "new_lead", name: "Answer", type: "melodic", instrumentId: "soft_lead" },
    ];
    c.rowReplacements = [
      { trackRef: "track-lead", bar: 1, beat: 1, body: "[E5]" },
      { trackRef: "new_lead", bar: 1, beat: 1, body: "[G5]" },
    ];
    const r = buildCandidate(s, scope, c);
    expect(r.next.music.tracks).toHaveLength(7);
    expect(r.next.music.tracks[6].notes[0]).toMatchObject({ pitch: "G5" });
    expect(s.music.tracks).toHaveLength(6);
  });
  it("rejects boundary-crossing note changes and stale scopes", () => {
    const s = fixture();
    s.music.tracks[0].notes[0].duration = frac(3, 2);
    const scope = resolveScope(s, {
        kind: "regions",
        regions: [{ start: frac(1), end: frac(2), trackIds: ["track-lead"] }],
      }),
      c = emptyCandidate(scope);
    c.rowReplacements = [
      { trackRef: "track-lead", bar: 1, beat: 2, body: "[hold]" },
    ];
    expect(() => buildCandidate(s, scope, c)).toThrow(/protected/);
    c.baseRevision++;
    expect(() => buildCandidate(s, scope, c)).toThrow(/STALE/);
  });
});
describe("exact notation regressions", () => {
  it("merges two-beat triplets and cross-bar holds; preserves IDs on round-trip", () => {
    const s = newSong(crypto.randomUUID()),
      text =
        "BAR 1\nbeat 1\ntrack-lead [C5:2 D5]\nbeat 2\ntrack-lead [hold E5:2]\nbeat 4\ntrack-lead [G5]\nBAR 2\nbeat 1\ntrack-lead [hold rest]";
    const next = compileRows(
      parseNotation(text, new Map(s.music.tracks.map((t) => [t.id, t]))),
      s,
    );
    expect(next.music.tracks[0].notes.map((n) => n.duration)).toEqual([
      frac(2, 3),
      frac(2, 3),
      frac(2, 3),
      frac(3, 2),
    ]);
    expect(notationRoundTrip(next)).toEqual(next);
  });
  it("clips per-beat weights exactly for a 3/2-beat note", () => {
    const s = fixture();
    s.music.tracks[0].notes[0].duration = frac(3, 2);
    expect(serializeNotation(s)).toContain("track-lead [hold rest]");
    expect(notationRoundTrip(s)).toEqual(s);
  });
  it("round-trips sevenths and repeated attacks without merging them", () => {
    const s = newSong(crypto.randomUUID());
    const rows = parseNotation(
      "BAR 1\nbeat 1\ntrack-lead [C5 C5 C5 C5 C5 C5 C5]",
      new Map(s.music.tracks.map((t) => [t.id, t])),
    );
    const next = compileRows(rows, s);
    expect(next.music.tracks[0].notes).toHaveLength(7);
    expect(notationRoundTrip(next)).toEqual(next);
  });
  it("rejects orphan holds, cross-beat drums and serialization complexity", () => {
    const s = fixture();
    expect(() =>
      compileRows(
        parseNotation(
          "BAR 1\nbeat 1\ntrack-lead [rest hold]",
          new Map(s.music.tracks.map((t) => [t.id, t])),
        ),
        s,
      ),
    ).toThrow(/orphan/);
    s.music.tracks[2].notes = [
      {
        id: "k",
        kind: "hit",
        start: frac(0),
        duration: frac(2),
        velocity: 100,
      },
    ];
    expect(() => validateSong(s)).toThrow(/CROSS_BEAT/);
    s.music.tracks[2].notes = [];
    s.music.tracks[0].notes[0].duration = frac(1, 1000002);
    expect(() => serializeNotation(s)).toThrow(/RHYTHM_COMPLEXITY/);
  });
  it("rejects unsafe fractions and duplicate track IDs", () => {
    expect(() => frac(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    const s = fixture();
    s.music.tracks[1].id = s.music.tracks[0].id;
    expect(() => validateSong(s)).toThrow(/DUPLICATE/);
  });
  it("manual move preserves fractional offsets; invalid edits leave the source unchanged", () => {
    const s = fixture();
    s.music.tracks[0].notes[0].start = frac(1, 3);
    s.music.tracks[0].notes[0].duration = frac(1, 3);
    const next = applyCommand(s, {
      type: "edit_note",
      noteId: "a",
      pitch: "C5",
      start: add(frac(1, 3), frac(1, 4)),
      duration: frac(1, 3),
    });
    expect(next.music.tracks[0].notes[0].start).toEqual(frac(7, 12));
    expect(() =>
      applyCommand(s, { type: "transpose", noteIds: ["a"], semitones: 48 }),
    ).toThrow();
    expect(s.music.tracks[0].notes[0].pitch).toBe("C5");
  });
});
