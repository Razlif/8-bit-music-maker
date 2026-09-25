import {
  add,
  sub,
  frac,
  cmp,
  eq,
  min,
  max,
  type Fraction,
} from "./fractions.js";
import { INSTRUMENTS, pitchToMidi, midiToPitch } from "./instruments.js";
import type { Note, Song, Track } from "./schema.js";
export type ParsedItem = { token: string; weight: number };
export type NotationRow = {
  trackId: string;
  bar: number;
  beat: number;
  items: ParsedItem[];
};
export class NotationError extends Error {
  code = "NOTATION_ERROR";
}
const fail = (message: string): never => {
  throw new NotationError(message);
};
export function parseRowBody(body: string): ParsedItem[] {
  if (!body.trim()) return fail("empty row");
  const items = body
    .trim()
    .split(/\s+/)
    .map((text) => {
      const match = /^((?:\{[A-G][#b]?[0-8](?:,[A-G][#b]?[0-8]){1,7}\})|[A-G][#b]?[0-8]|rest|hold|hit)(?::([1-9]\d*))?$/.exec(
        text,
      );
      if (!match) return fail("invalid token: " + text);
      const weight = Number(match[2] ?? 1);
      if (!Number.isSafeInteger(weight) || weight > 1_000_000)
        return fail("RHYTHM_COMPLEXITY_LIMIT: weight");
      return { token: match[1], weight };
    });
  if (items.length > 128) return fail("RHYTHM_COMPLEXITY_LIMIT: items");
  return items;
}
export function parseNotation(
  text: string,
  knownTracks: Map<string, Track>,
): NotationRow[] {
  const rows: NotationRow[] = [],
    seen = new Set<string>();
  let bar = 0,
    beat = 0;
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#") || /^(SONG|TRACK) /.test(line)) continue;
    let m = /^BAR ([1-9]\d*)$/.exec(line);
    if (m) {
      bar = Number(m[1]);
      beat = 0;
      continue;
    }
    m = /^beat ([1-4])$/.exec(line);
    if (m) {
      beat = Number(m[1]);
      continue;
    }
    m = /^([A-Za-z0-9_-]+)\s+\[([^\[\]]+)\]$/.exec(line);
    if (!m || !bar || !beat) return fail("invalid row at line " + (i + 1));
    const track = knownTracks.get(m[1]);
    if (!track) return fail("unknown track: " + m[1]);
    const key = [m[1], bar, beat].join("/");
    if (seen.has(key)) return fail("duplicate row: " + key);
    seen.add(key);
    const items = parseRowBody(m[2]),
      instrument = INSTRUMENTS[track.instrumentId];
    if (!instrument) return fail("unknown instrument");
    for (const { token } of items) {
      if (token === "rest") continue;
      if (token.startsWith("{")) {
        if (track.type !== "harmonic" || instrument.kind !== "pitched")
          return fail("chord token requires a harmonic pitched track");
        for (const pitch of token.slice(1, -1).split(",")) {
          const midi = pitchToMidi(pitch);
          if (midi === null || midi < instrument.minMidi! || midi > instrument.maxMidi!)
            return fail("invalid chord pitch " + pitch);
        }
        continue;
      }
      if (instrument.kind === "hit" ? token !== "hit" : token === "hit")
        return fail("incompatible token " + token);
    }
    rows.push({ trackId: track.id, bar, beat, items });
  }
  return rows;
}
const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
export function rowText(track: Track, bar: number, beat: number): string {
  const start = frac((bar - 1) * 4 + beat - 1),
    end = add(start, frac(1));
  const notes = track.notes.filter(
    (n) => cmp(n.start, end) < 0 && cmp(add(n.start, n.duration), start) > 0,
  );
  const eventMap = new Map<string, Note[]>();
  for (const note of notes) {
    const key = track.type === "harmonic"
      ? [note.start.n, note.start.d, note.duration.n, note.duration.d].join("/")
      : note.id;
    eventMap.set(key, [...(eventMap.get(key) ?? []), note]);
  }
  const events = [...eventMap.values()].map((members) => ({
    members,
    start: members[0].start,
    duration: members[0].duration,
  })).sort((a, b) => cmp(a.start, b.start));
  const parts: { token: string; duration: Fraction }[] = [];
  let cursor = start;
  for (const event of events) {
    const left = max(event.start, start),
      right = min(add(event.start, event.duration), end);
    if (cmp(left, cursor) < 0) return fail("OVERLAPPING_NOTES");
    if (cmp(left, cursor) > 0)
      parts.push({ token: "rest", duration: sub(left, cursor) });
    if (
      event.members[0].kind === "hit" &&
      (cmp(event.start, start) < 0 || cmp(add(event.start, event.duration), end) > 0)
    )
      return fail("CROSS_BEAT_HIT");
    parts.push({
      token:
        cmp(event.start, start) < 0
          ? "hold"
          : event.members[0].kind === "hit"
            ? "hit"
            : event.members.length > 1
              ? "{" + event.members.map((n) => n.kind === "pitched" ? n.pitch : fail("invalid chord event")).join(",") + "}"
              : event.members[0].kind === "pitched" ? event.members[0].pitch : fail("invalid event"),
      duration: sub(right, left),
    });
    cursor = right;
  }
  if (cmp(cursor, end) < 0)
    parts.push({ token: "rest", duration: sub(end, cursor) });
  if (parts.length > 128) return fail("RHYTHM_COMPLEXITY_LIMIT: items");
  const denominator = parts.reduce(
    (d, p) => (d / gcd(d, BigInt(p.duration.d))) * BigInt(p.duration.d),
    1n,
  );
  const weights = parts.map(
    (p) => BigInt(p.duration.n) * (denominator / BigInt(p.duration.d)),
  );
  const divisor = weights.reduce((a, b) => gcd(a, b));
  return parts
    .map((p, i) => {
      const weight = weights[i] / divisor;
      if (weight > 1_000_000n) return fail("RHYTHM_COMPLEXITY_LIMIT: weight");
      return p.token + (weight === 1n ? "" : ":" + weight);
    })
    .join(" ");
}
// Compile complete touched tracks with read-only boundary rows, then reconcile IDs.
export function compileRows(
  rows: NotationRow[],
  base: Song,
  allocateId: () => string = () => crypto.randomUUID(),
): Song {
  const next = structuredClone(base),
    replacements = new Map<string, NotationRow>();
  for (const row of rows) {
    if (
      !Number.isInteger(row.bar) ||
      row.bar < 1 ||
      row.bar > base.music.bars ||
      row.beat < 1 ||
      row.beat > 4
    )
      return fail("row outside song");
    if (!base.music.tracks.some((t) => t.id === row.trackId))
      return fail("unknown track");
    const key = [row.trackId, row.bar, row.beat].join("/");
    if (replacements.has(key)) return fail("duplicate row");
    replacements.set(key, row);
  }
  for (const track of next.music.tracks) {
    if (!rows.some((r) => r.trackId === track.id)) continue;
    const original = base.music.tracks.find((t) => t.id === track.id)!;
    const notes: Note[] = [];
    let previous: Note[] | undefined;
    for (let index = 0; index < base.music.bars * 4; index++) {
      const bar = Math.floor(index / 4) + 1,
        beat = (index % 4) + 1;
      const items =
        replacements.get([track.id, bar, beat].join("/"))?.items ??
        parseRowBody(rowText(original, bar, beat));
      const total = items.reduce((sum, item) => sum + item.weight, 0);
      let cursor = frac(index);
      for (const item of items) {
        const duration = frac(item.weight, total),
          kind = INSTRUMENTS[track.instrumentId].kind;
        if (item.token === "rest") previous = undefined;
        else if (item.token === "hold") {
          if (
            kind !== "pitched" ||
            !previous?.length ||
            previous.some((note) => note.kind !== "pitched" || !eq(add(note.start, note.duration), cursor))
          )
            return fail("orphan hold at " + [bar, beat, track.id].join("/"));
          for (const note of previous) note.duration = add(note.duration, duration);
        } else {
          const chord = item.token.startsWith("{") ? item.token.slice(1, -1).split(",") : null;
          if ((kind === "hit") !== (item.token === "hit") || (chord && track.type !== "harmonic"))
            return fail("incompatible token");
          const common = {
            start: cursor,
            duration,
            velocity: 100,
          };
          previous = item.token === "hit"
            ? [{ ...common, id: allocateId(), kind: "hit" }]
            : (chord ?? [item.token]).map((pitch) => ({
                ...common,
                id: allocateId(),
                kind: "pitched" as const,
                pitch: midiToPitch(pitchToMidi(pitch) ?? fail("invalid pitch")),
              }));
          notes.push(...previous);
        }
        cursor = add(cursor, duration);
      }
    }
    for (const note of notes) {
      const match = original.notes.find(
        (n) =>
          n.kind === note.kind &&
          eq(n.start, note.start) &&
          eq(n.duration, note.duration) &&
          (n.kind === "hit" ||
            (note.kind === "pitched" &&
              pitchToMidi(n.pitch) === pitchToMidi(note.pitch))),
      );
      if (match) {
        note.id = match.id;
        note.velocity = match.velocity;
      }
    }
    track.notes = notes;
  }
  return next;
}
export function serializeNotation(song: Song): string {
  const lines = [
    "SONG | meter=4/4 | bpm=" + song.music.bpm,
    ...song.music.tracks.map(
      (t) => "TRACK " + t.id + " | instrument=" + t.instrumentId,
    ),
  ];
  for (let bar = 1; bar <= song.music.bars; bar++) {
    lines.push("BAR " + bar);
    for (let beat = 1; beat <= 4; beat++) {
      lines.push("beat " + beat);
      for (const track of song.music.tracks)
        lines.push("  " + track.id + " [" + rowText(track, bar, beat) + "]");
    }
  }
  return lines.join("\n");
}
export function notationRoundTrip(song: Song): Song {
  return compileRows(
    parseNotation(
      serializeNotation(song),
      new Map(song.music.tracks.map((t) => [t.id, t])),
    ),
    song,
  );
}
