import { z } from "zod";
import { pitchToMidi, midiToPitch, INSTRUMENTS } from "./instruments.js";
import { add, cmp, frac, type Fraction } from "./fractions.js";
export const FractionSchema = z
  .object({ n: z.number().int().safe(), d: z.number().int().safe().positive() })
  .strict();
export const NoteSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1),
      kind: z.literal("pitched"),
      pitch: z.string(),
      start: FractionSchema,
      duration: FractionSchema,
      velocity: z.number().int().min(1).max(127),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal("hit"),
      start: FractionSchema,
      duration: FractionSchema,
      velocity: z.number().int().min(1).max(127),
    })
    .strict(),
]);
export const TrackSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().min(1).max(120),
    type: z.enum(["melodic", "harmonic"]).default("melodic"),
    instrumentId: z.string(),
    instrumentVersion: z.literal(1),
    volumeDb: z.number().min(-60).max(6),
    muted: z.boolean(),
    notes: z.array(NoteSchema),
  })
  .strict();
export const SongSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    brief: z.string().max(4000),
    music: z
      .object({
        bpm: z.number().min(40).max(240),
        meter: z.tuple([z.literal(4), z.literal(4)]),
        bars: z.number().int().min(1).max(32),
        key: z
          .object({
            root: z.string().regex(/^[A-G][#b]?$/),
            mode: z.string().min(1).max(40),
          })
          .strict()
          .nullable(),
        tracks: z.array(TrackSchema).max(8),
      })
      .strict(),
  })
  .strict();
export type FractionValue = Fraction;
export type Note = z.infer<typeof NoteSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Song = z.infer<typeof SongSchema>;
export type Span = { start: Fraction; end: Fraction };
export type Selection =
  | { kind: "song" }
  | { kind: "tracks"; trackIds: string[] }
  | { kind: "regions"; regions: Array<Span & { trackIds: string[] }> }
  | { kind: "notes"; noteIds: string[] };
export function validateSong(song: unknown): Song {
  const result = SongSchema.strict().safeParse(song);
  if (!result.success) throw new Error("INVALID_SONG: " + result.error.message);
  const s = result.data,
    ids = new Set<string>(),
    end = frac(s.music.bars * 4);
  for (const t of s.music.tracks) {
    if (ids.has(t.id)) throw new Error("DUPLICATE_ID");
    ids.add(t.id);
    const inst = INSTRUMENTS[t.instrumentId];
    if (!Object.hasOwn(INSTRUMENTS, t.instrumentId))
      throw new Error("UNKNOWN_INSTRUMENT");
    for (const n of t.notes) {
      if (ids.has(n.id)) throw new Error("DUPLICATE_ID");
      ids.add(n.id);
      n.start = frac(n.start.n, n.start.d);
      n.duration = frac(n.duration.n, n.duration.d);
      if (
        cmp(n.start, frac(0)) < 0 ||
        n.duration.n <= 0 ||
        cmp(add(n.start, n.duration), end) > 0
      )
        throw new Error("NOTE_OUT_OF_BOUNDS");
      if (n.kind === "pitched") {
        const midi = pitchToMidi(n.pitch);
        if (
          midi === null ||
          inst.kind !== "pitched" ||
          midi < inst.minMidi! ||
          midi > inst.maxMidi!
        )
          throw new Error("INVALID_PITCH");
        n.pitch = midiToPitch(midi);
      } else {
        if (inst.kind !== "hit") throw new Error("HIT_ON_PITCHED_TRACK");
        if (
          cmp(
            add(n.start, n.duration),
            frac(Math.floor(n.start.n / n.start.d) + 1),
          ) > 0
        )
          throw new Error("CROSS_BEAT_HIT");
      }
    }
    if (t.type === "melodic") {
      const notes = [...t.notes].sort((a, b) => cmp(a.start, b.start));
      for (let i = 1; i < notes.length; i++)
        if (
          cmp(add(notes[i - 1].start, notes[i - 1].duration), notes[i].start) > 0
        )
          throw new Error("OVERLAPPING_NOTES");
    } else if (inst.kind !== "pitched" || t.notes.some((note) => note.kind !== "pitched")) {
      throw new Error("HARMONIC_TRACK_REQUIRES_PITCHED_INSTRUMENT");
    } else {
      const groups = new Map<string, Note[]>();
      for (const note of t.notes) {
        const key = [note.start.n, note.start.d, note.duration.n, note.duration.d].join("/");
        groups.set(key, [...(groups.get(key) ?? []), note]);
      }
      for (const chord of groups.values())
        if (new Set(chord.map((note) => note.kind === "pitched" ? pitchToMidi(note.pitch) : -1)).size !== chord.length)
          throw new Error("INVALID_HARMONIC_EVENT");
      const events = [...groups.values()].map((chord) => chord[0]).sort((a, b) => cmp(a.start, b.start));
      for (let i = 1; i < events.length; i++)
        if (cmp(add(events[i - 1].start, events[i - 1].duration), events[i].start) > 0)
          throw new Error("OVERLAPPING_CHORD_EVENTS");
    }
  }
  return s;
}
export function newSong(id: string, now = new Date().toISOString()): Song {
  const track = (
    trackId: string,
    name: string,
    instrumentId: string,
    type: Track["type"] = "melodic",
  ): Track => ({
    id: trackId,
    name,
    type,
    instrumentId,
    instrumentVersion: 1,
    volumeDb: -12,
    muted: false,
    notes: [],
  });
  return {
    schemaVersion: 1,
    id,
    title: "Untitled Loop",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    brief: "",
    music: {
      bpm: 120,
      meter: [4, 4],
      bars: 4,
      key: null,
      tracks: [
        track("track-lead", "Lead", "soft_lead"),
        track("track-bass", "Bass", "chip_bass"),
        track("track-kick", "Kick", "kick"),
        track("track-hat", "Hi-Hat", "closed_hat"),
        track("track-snare", "Snare", "snare"),
        track("track-harmony", "Harmony", "chip_pad", "harmonic"),
      ],
    },
  };
}
