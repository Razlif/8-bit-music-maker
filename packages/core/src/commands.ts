import { z } from "zod";
import { add, cmp, frac, type Fraction } from "./fractions.js";
import { midiToPitch, pitchToMidi, INSTRUMENTS } from "./instruments.js";
import { FractionSchema, validateSong, newSong, type Song } from "./schema.js";
import { serializeNotation } from "./notation.js";
const id = z.string().min(1);
export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reset_song") }).strict(),
  z
    .object({
      type: z.literal("set_mix"),
      trackId: id,
      volumeDb: z.number().min(-60).max(6),
      muted: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("set_tempo"), bpm: z.number().min(40).max(240) })
    .strict(),
  z
    .object({ type: z.literal("rename"), title: z.string().min(1).max(120) })
    .strict(),
  z
    .object({
      type: z.literal("set_key"),
      root: z.string().regex(/^[A-G][#b]?$/),
      mode: z.enum(["major", "minor"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("resize_song"),
      bars: z.number().int().min(1).max(32),
      trim: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_track"),
      instrumentId: id,
      name: z.string().min(1).max(120),
      trackType: z.enum(["melodic", "harmonic"]),
    })
    .strict(),
  z.object({ type: z.literal("remove_track"), trackId: id }).strict(),
  z
    .object({
      type: z.literal("edit_track"),
      trackId: id,
      name: z.string().min(1).max(120),
      instrumentId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("add_note"),
      trackId: id,
      pitch: z.string().nullable(),
      start: FractionSchema,
      duration: FractionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("edit_note"),
      noteId: id,
      pitch: z.string().nullable(),
      start: FractionSchema,
      duration: FractionSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("delete_notes"), noteIds: z.array(id).min(1) })
    .strict(),
  z
    .object({
      type: z.literal("transpose"),
      noteIds: z.array(id),
      semitones: z.number().int().min(-48).max(48),
    })
    .strict(),
]);
export type MusicCommand = z.infer<typeof CommandSchema>;
export function applyCommand(song: Song, input: unknown): Song {
  const command = CommandSchema.parse(input),
    next = structuredClone(song);
  const track = (id: string) => {
    const t = next.music.tracks.find((t) => t.id === id);
    if (!t) throw new Error("UNKNOWN_TRACK");
    return t;
  };
  const note = (id: string) => {
    const n = next.music.tracks
      .flatMap((t) => t.notes)
      .find((n) => n.id === id);
    if (!n) throw new Error("UNKNOWN_NOTE");
    return n;
  };
  switch (command.type) {
    case "reset_song":
      next.music = newSong(next.id).music;
      next.brief = "";
      break;
    case "set_mix":
      Object.assign(track(command.trackId), {
        volumeDb: command.volumeDb,
        muted: command.muted,
      });
      break;
    case "set_tempo":
      next.music.bpm = command.bpm;
      break;
    case "rename":
      next.title = command.title;
      break;
    case "set_key":
      next.music.key = { root: command.root, mode: command.mode };
      break;
    case "resize_song": {
      const end = frac(command.bars * 4),
        crossing = next.music.tracks
          .flatMap((t) => t.notes)
          .some((n) => cmp(add(n.start, n.duration), end) > 0);
      if (crossing && !command.trim)
        throw new Error("TRIM_CONFIRMATION_REQUIRED");
      for (const t of next.music.tracks)
        t.notes = t.notes
          .filter((n) => cmp(n.start, end) < 0)
          .map((n) =>
            cmp(add(n.start, n.duration), end) > 0
              ? {
                  ...n,
                  duration: { n: end.n * n.start.d - n.start.n, d: n.start.d },
                }
              : n,
          );
      next.music.bars = command.bars;
      break;
    }
    case "add_track":
      next.music.tracks.push({
        id: crypto.randomUUID(),
        name: command.name,
        type: command.trackType,
        instrumentId: command.instrumentId,
        instrumentVersion: 1,
        volumeDb: -12,
        muted: false,
        notes: [],
      });
      break;
    case "remove_track":
      track(command.trackId);
      next.music.tracks = next.music.tracks.filter(
        (t) => t.id !== command.trackId,
      );
      break;
    case "edit_track":
      {
        const target = INSTRUMENTS[command.instrumentId];
        if (!target) throw new Error("UNKNOWN_INSTRUMENT");
        const current = track(command.trackId);
        if (current.type === "harmonic" && target.kind !== "pitched")
          throw new Error("HARMONIC_TRACK_REQUIRES_PITCHED_INSTRUMENT");
        for (const note of current.notes) {
          if (note.kind === "hit" && target.kind !== "hit")
            throw new Error("INSTRUMENT_SWAP_WOULD_INVALIDATE_HITS");
          if (note.kind === "pitched" && target.kind !== "pitched")
            throw new Error("INSTRUMENT_SWAP_WOULD_INVALIDATE_NOTES");
          if (note.kind === "pitched") {
            const midi = pitchToMidi(note.pitch);
            if (midi !== null && (midi < target.minMidi! || midi > target.maxMidi!))
              throw new Error("INSTRUMENT_SWAP_OUT_OF_RANGE");
          }
        }
        Object.assign(current, {
        name: command.name,
        instrumentId: command.instrumentId,
        });
      }
      break;
    case "add_note": {
      const t = track(command.trackId),
        common = {
          id: crypto.randomUUID(),
          start: command.start,
          duration: command.duration,
          velocity: 100,
        };
      if (!INSTRUMENTS[t.instrumentId]) throw new Error("UNKNOWN_INSTRUMENT");
      t.notes.push(
        INSTRUMENTS[t.instrumentId].kind === "hit"
          ? { ...common, kind: "hit" }
          : { ...common, kind: "pitched", pitch: command.pitch ?? "C5" },
      );
      break;
    }
    case "edit_note": {
      const n = note(command.noteId);
      n.start = command.start;
      n.duration = command.duration;
      if (n.kind === "pitched") {
        if (!command.pitch) throw new Error("INVALID_PITCH");
        n.pitch = command.pitch;
      }
      break;
    }
    case "delete_notes":
      for (const id of command.noteIds) note(id);
      for (const t of next.music.tracks)
        t.notes = t.notes.filter((n) => !command.noteIds.includes(n.id));
      break;
    case "transpose":
      for (const id of command.noteIds) {
        const n = note(id);
        if (n.kind === "pitched")
          n.pitch = midiToPitch(pitchToMidi(n.pitch)! + command.semitones);
      }
      break;
  }
  const valid = validateSong(next);
  serializeNotation(valid);
  return valid;
}
export function setTrackMix(
  song: Song,
  trackId: string,
  volumeDb: number,
  muted = false,
) {
  return applyCommand(song, { type: "set_mix", trackId, volumeDb, muted });
}
export function transpose(song: Song, trackIds: string[], semitones: number) {
  return applyCommand(song, {
    type: "transpose",
    noteIds: song.music.tracks
      .filter((t) => trackIds.includes(t.id))
      .flatMap((t) => t.notes.map((n) => n.id)),
    semitones,
  });
}
