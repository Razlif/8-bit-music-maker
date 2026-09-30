import { z } from "zod";
import { add, cmp, eq, frac, value, type Fraction } from "./fractions.js";
import {
  FractionSchema,
  type Note,
  type Selection,
  type Song,
  type Span,
  validateSong,
} from "./schema.js";
import { pitchToMidi } from "./instruments.js";
import { compileRows, parseNotation, serializeNotation } from "./notation.js";
export type NoteField = "pitch" | "start" | "duration" | "velocity";
export type ScopeRule = {
  noteId: string;
  trackId: string;
  fields: NoteField[];
  mayDelete: boolean;
  permittedSpan: Span;
};
export type Scope = {
  id: string;
  songId: string;
  baseRevision: number;
  eventRules: ScopeRule[];
  insertionRegions: Array<Span & { trackId: string }>;
  newTrackRules: Array<{ ref: string; type: "melodic" | "harmonic"; permittedSpan: Span }>;
  removableTrackIds: string[];
  metadataRules: Array<{ target: string; fields: string[] }>;
  requiredRows: Array<{ trackRef: string; bar: number; beat: number }>;
};
const Changes = z
  .object({
    pitch: z.string().optional(),
    start: FractionSchema.optional(),
    duration: FractionSchema.optional(),
    velocity: z.number().int().min(1).max(127).optional(),
  })
  .strict();
export const CandidateSchema = z
  .object({
    scopeId: z.string(),
    baseRevision: z.number().int().nonnegative(),
    newTracks: z.array(
      z
        .object({
          ref: z.string(),
          name: z.string().min(1).max(120),
          instrumentId: z.string(),
          type: z.enum(["melodic", "harmonic"]).default("melodic"),
        })
        .strict(),
    ),
    eventUpdates: z.array(
      z.object({ noteId: z.string(), changes: Changes }).strict(),
    ),
    deletedNoteIds: z.array(z.string()),
    removedTrackIds: z.array(z.string()),
    rowReplacements: z.array(
      z
        .object({
          trackRef: z.string(),
          bar: z.number().int().min(1).max(32),
          beat: z.number().int().min(1).max(4),
          body: z.string().max(10000),
        })
        .strict(),
    ),
    metadataChanges: z.array(
      z.object({ target: z.string(), changes: z.record(z.unknown()) }).strict(),
    ),
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;
export const emptyCandidate = (scope: Scope): Candidate => ({
  scopeId: scope.id,
  baseRevision: scope.baseRevision,
  newTracks: [],
  eventUpdates: [],
  deletedNoteIds: [],
  removedTrackIds: [],
  rowReplacements: [],
  metadataChanges: [],
});
export function noteEnd(n: Note) {
  return add(n.start, n.duration);
}
const allNotes = (song: Song) =>
  song.music.tracks.flatMap((track) => track.notes.map((n) => ({ track, n })));
const violation = (message: string): never => {
  throw new Error("SCOPE_VIOLATION: " + message);
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const sameNote = (a: Note, b: Note) =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.velocity === b.velocity &&
  eq(a.start, b.start) &&
  eq(a.duration, b.duration) &&
  (a.kind === "hit" ||
    (b.kind === "pitched" && pitchToMidi(a.pitch) === pitchToMidi(b.pitch)));
export function resolveScope(
  song: Song,
  selection: Selection,
  operation: "compose" | "pitch" | "mix" = "compose",
): Scope {
  const rules: ScopeRule[] = [],
    regions: Array<Span & { trackIds: string[] }> =
      selection.kind === "song"
        ? [
            {
              start: frac(0),
              end: frac(song.music.bars * 4),
              trackIds: song.music.tracks.map((t) => t.id),
            },
          ]
        : selection.kind === "tracks"
          ? [
              {
                start: frac(0),
                end: frac(song.music.bars * 4),
                trackIds: selection.trackIds,
              },
            ]
          : selection.kind === "regions"
            ? selection.regions
            : [];
  if (selection.kind === "notes") {
    if (
      !selection.noteIds.length ||
      new Set(selection.noteIds).size !== selection.noteIds.length
    )
      throw new Error("INVALID_SELECTION");
    for (const id of selection.noteIds) {
      const found = allNotes(song).find((x) => x.n.id === id);
      if (!found) throw new Error("UNKNOWN_NOTE");
      rules.push({
        noteId: id,
        trackId: found.track.id,
        fields:
          operation === "pitch"
            ? ["pitch"]
            : ["pitch", "start", "duration", "velocity"],
        mayDelete: operation === "compose",
        permittedSpan: { start: found.n.start, end: noteEnd(found.n) },
      });
    }
  }
  for (const region of regions) {
    if (
      cmp(region.start, frac(0)) < 0 ||
      cmp(region.end, frac(song.music.bars * 4)) > 0 ||
      cmp(region.start, region.end) >= 0 ||
      region.trackIds.some((id) => !song.music.tracks.some((t) => t.id === id))
    )
      throw new Error("INVALID_SELECTION");
    for (const { track, n } of allNotes(song))
      if (
        region.trackIds.includes(track.id) &&
        cmp(n.start, region.start) >= 0 &&
        cmp(noteEnd(n), region.end) <= 0 &&
        !rules.some((r) => r.noteId === n.id)
      )
        rules.push({
          noteId: n.id,
          trackId: track.id,
          fields:
            operation === "pitch"
              ? ["pitch"]
              : operation === "mix"
                ? []
                : ["pitch", "start", "duration", "velocity"],
          mayDelete: operation === "compose",
          permittedSpan: region,
        });
  }
  const coverage = new Map<
    string,
    { trackRef: string; bar: number; beat: number }
  >();
  const cover = (trackRef: string, span: Span) => {
    for (
      let b = Math.floor(value(span.start));
      b < Math.ceil(value(span.end));
      b++
    ) {
      const row = { trackRef, bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1 };
      coverage.set(JSON.stringify(row), row);
    }
  };
  for (const r of regions) for (const id of r.trackIds) cover(id, r);
  for (const r of rules) cover(r.trackId, r.permittedSpan);
  return {
    id: crypto.randomUUID(),
    songId: song.id,
    baseRevision: song.revision,
    eventRules: rules,
    insertionRegions:
      operation === "compose"
        ? regions.flatMap((r) =>
            r.trackIds.map((trackId) => ({
              start: r.start,
              end: r.end,
              trackId,
            })),
          )
        : [],
    newTrackRules: [],
    removableTrackIds: [],
    metadataRules:
      operation === "mix"
        ? [...new Set(regions.flatMap((r) => r.trackIds))].map((id) => ({
            target: "track:" + id,
            fields: ["volumeDb", "muted"],
          }))
        : operation === "compose"
          ? [{ target: "song", fields: ["key"] }]
          : [],
    requiredRows: [...coverage.values()],
  };
}
export function validateCandidate(
  base: Song,
  scope: Scope,
  candidate: Candidate,
  next: Song,
) {
  if (
    scope.songId !== base.id ||
    scope.baseRevision !== base.revision ||
    candidate.scopeId !== scope.id ||
    candidate.baseRevision !== base.revision
  )
    throw new Error("STALE_SCOPE");
  for (const k of [
    "schemaVersion",
    "id",
    "createdAt",
    "updatedAt",
    "revision",
  ] as const)
    if (!same(base[k], next[k])) violation("immutable " + k);
  const metadata = (
    target: string,
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ) => {
    const allowed =
      scope.metadataRules.find((r) => r.target === target)?.fields ?? [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (!same(a[key], b[key]) && !allowed.includes(key))
        violation(target + "." + key);
  };
  metadata(
    "song",
    {
      title: base.title,
      brief: base.brief,
      bpm: base.music.bpm,
      meter: base.music.meter,
      bars: base.music.bars,
      key: base.music.key,
    },
    {
      title: next.title,
      brief: next.brief,
      bpm: next.music.bpm,
      meter: next.music.meter,
      bars: next.music.bars,
      key: next.music.key,
    },
  );
  for (const track of base.music.tracks) {
    const other = next.music.tracks.find((t) => t.id === track.id);
    if (!other) {
      if (!scope.removableTrackIds.includes(track.id))
        violation("removed track " + track.id);
      continue;
    }
    const { notes: an, ...a } = track,
      { notes: bn, ...b } = other;
    metadata("track:" + track.id, a, b);
  }
  const oldOrder = base.music.tracks
    .filter((t) => next.music.tracks.some((n) => n.id === t.id))
    .map((t) => t.id);
  if (
    !same(
      oldOrder,
      next.music.tracks
        .filter((t) => base.music.tracks.some((n) => n.id === t.id))
        .map((t) => t.id),
    )
  )
    violation("track ordering");
  for (const track of next.music.tracks)
    if (
      !base.music.tracks.some((t) => t.id === track.id) &&
      !scope.newTrackRules.some((r) => r.ref === track.id)
    )
      violation("new track " + track.id);
  const before = allNotes(base),
    after = allNotes(next);
  for (const { track, n } of before) {
    if (
      !next.music.tracks.some((t) => t.id === track.id) &&
      scope.removableTrackIds.includes(track.id)
    )
      continue;
    const found = after.find((x) => x.n.id === n.id),
      rule = scope.eventRules.find((r) => r.noteId === n.id);
    if (!rule) {
      if (!found || found.track.id !== track.id || !sameNote(n, found.n))
        violation("protected event " + n.id);
      continue;
    }
    if (!found) {
      if (!rule.mayDelete) violation("deleted " + n.id);
      continue;
    }
    const b = found.n;
    if (found.track.id !== rule.trackId || n.kind !== b.kind)
      violation("event identity " + n.id);
    for (const field of [
      "pitch",
      "start",
      "duration",
      "velocity",
    ] as NoteField[]) {
      const aVal = (n as any)[field],
        bVal = (b as any)[field];
      const equal =
        field === "start" || field === "duration"
          ? eq(aVal, bVal)
          : field === "pitch"
            ? aVal === bVal ||
              pitchToMidi(aVal ?? "") === pitchToMidi(bVal ?? "")
            : aVal === bVal;
      if (!equal && !rule.fields.includes(field)) violation(n.id + "." + field);
    }
    if (
      cmp(b.start, rule.permittedSpan.start) < 0 ||
      cmp(noteEnd(b), rule.permittedSpan.end) > 0
    )
      violation(n.id + " outside span");
  }
  for (const { track, n } of after)
    if (!before.some((x) => x.n.id === n.id)) {
      const regions = [
        ...scope.insertionRegions,
        ...scope.newTrackRules.map((r) => ({
          ...r.permittedSpan,
          trackId: r.ref,
        })),
      ];
      if (
        !regions.some(
          (r) =>
            r.trackId === track.id &&
            cmp(n.start, r.start) >= 0 &&
            cmp(noteEnd(n), r.end) <= 0,
        )
      )
        violation("inserted " + n.id);
    }
}
export function buildCandidate(
  base: Song,
  scope: Scope,
  input: unknown,
): { candidate: Candidate; next: Song; scope: Scope } {
  const candidate = CandidateSchema.parse(input),
    resolved = structuredClone(scope);
  if (
    candidate.scopeId !== scope.id ||
    candidate.baseRevision !== scope.baseRevision
  )
    throw new Error("STALE_SCOPE");
  let next = structuredClone(base);
  const refs = new Map<string, string>(),
    seen = new Set<string>();
  const once = (key: string) => {
    if (seen.has(key)) throw new Error("DUPLICATE_OPERATION: " + key);
    seen.add(key);
  };
  for (const d of candidate.newTracks) {
    once("track:" + d.ref);
    if (
      !scope.newTrackRules.some((r) => r.ref === d.ref) ||
      base.music.tracks.some((t) => t.id === d.ref)
    )
      violation("new track " + d.ref);
    const id = crypto.randomUUID();
    refs.set(d.ref, id);
    const trackRule = scope.newTrackRules.find((r) => r.ref === d.ref)!;
    if (trackRule.type !== d.type) violation("new track type " + d.ref);
    resolved.newTrackRules.find((r) => r.ref === d.ref)!.ref = id;
    next.music.tracks.push({
      id,
      name: d.name,
      type: d.type,
      instrumentId: d.instrumentId,
      instrumentVersion: 1,
      volumeDb: -12,
      muted: false,
      notes: [],
    });
  }
  const rows = candidate.rowReplacements;
  for (const r of rows) {
    once("row:" + JSON.stringify([r.trackRef, r.bar, r.beat]));
    if (
      !scope.requiredRows.some(
        (x) =>
          x.trackRef === r.trackRef && x.bar === r.bar && x.beat === r.beat,
      )
    )
      violation("row not in output contract");
  }
  if (
    rows.length ||
    (!candidate.eventUpdates.length &&
      !candidate.deletedNoteIds.length &&
      !candidate.metadataChanges.length &&
      !candidate.removedTrackIds.length)
  )
    for (const required of scope.requiredRows)
      if (
        !rows.some(
          (r) =>
            r.trackRef === required.trackRef &&
            r.bar === required.bar &&
            r.beat === required.beat,
        )
      )
        throw new Error("MISSING_REQUIRED_ROW: " + JSON.stringify(required));
  for (const id of [
    ...candidate.deletedNoteIds,
    ...candidate.eventUpdates.map((u) => u.noteId),
  ]) {
    once("event:" + id);
    const old = allNotes(base).find((x) => x.n.id === id);
    if (!old) throw new Error("UNKNOWN_NOTE");
    if (
      rows.some(
        (r) =>
          r.trackRef === old.track.id &&
          cmp(old.n.start, frac((r.bar - 1) * 4 + r.beat)) < 0 &&
          cmp(noteEnd(old.n), frac((r.bar - 1) * 4 + r.beat - 1)) > 0,
      )
    )
      throw new Error("CONFLICTING_OPERATIONS");
  }
  const text = rows
    .map(
      (r) =>
        "BAR " +
        r.bar +
        "\nbeat " +
        r.beat +
        "\n" +
        (refs.get(r.trackRef) ?? r.trackRef) +
        " " +
        r.body,
    )
    .join("\n");
  next = compileRows(
    parseNotation(text, new Map(next.music.tracks.map((t) => [t.id, t]))),
    next,
  );
  // Pitch-only row rewrites retain selected identities by exact timing, never by index.
  for (const rule of scope.eventRules.filter((r) => !r.mayDelete)) {
    const old = allNotes(base).find((x) => x.n.id === rule.noteId)!.n,
      track = next.music.tracks.find((t) => t.id === rule.trackId)!;
    if (!track.notes.some((n) => n.id === old.id)) {
      const matches = track.notes.filter(
        (n) =>
          eq(n.start, old.start) &&
          eq(n.duration, old.duration) &&
          n.kind === old.kind,
      );
      if (matches.length === 1) {
        matches[0].id = old.id;
        matches[0].velocity = old.velocity;
      }
    }
  }
  for (const u of candidate.eventUpdates) {
    const n = allNotes(next).find((x) => x.n.id === u.noteId)!.n;
    Object.assign(n, u.changes);
  }
  for (const id of candidate.deletedNoteIds)
    for (const t of next.music.tracks)
      t.notes = t.notes.filter((n) => n.id !== id);
  for (const id of candidate.removedTrackIds) {
    once("remove:" + id);
    if (!scope.removableTrackIds.includes(id)) violation("remove track");
    next.music.tracks = next.music.tracks.filter((t) => t.id !== id);
  }
  for (const m of candidate.metadataChanges) {
    once("meta:" + m.target);
    const allowed =
      scope.metadataRules.find((r) => r.target === m.target)?.fields ?? [];
    for (const [field, val] of Object.entries(m.changes)) {
      if (!allowed.includes(field)) violation(m.target + "." + field);
      if (m.target === "song") {
        if (field === "title" || field === "brief") (next as any)[field] = val;
        else (next.music as any)[field] = val;
      } else {
        const t = next.music.tracks.find((t) => "track:" + t.id === m.target);
        if (!t) throw new Error("UNKNOWN_TRACK");
        (t as any)[field] = val;
      }
    }
  }
  next = validateSong(next);
  serializeNotation(next);
  validateCandidate(base, resolved, candidate, next);
  return { candidate, next, scope: resolved };
}
export function musicalDiff(base: Song, next: Song) {
  const before = allNotes(base),
    after = allNotes(next);
  return {
    inserted: after
      .filter((x) => !before.some((y) => y.n.id === x.n.id))
      .map((x) => x.n.id),
    removed: before
      .filter((x) => !after.some((y) => y.n.id === x.n.id))
      .map((x) => x.n.id),
    changed: after
      .filter((x) => {
        const old = before.find((y) => y.n.id === x.n.id);
        return old && !sameNote(old.n, x.n);
      })
      .map((x) => x.n.id),
  };
}
