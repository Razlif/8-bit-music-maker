import {
  INSTRUMENTS,
  pitchToMidi,
  type Scope,
  type Song,
} from "@eight-bit/core";
import { z } from "zod";

// Undo only the transport adapter: don't teach the model our internal changes envelope.
export function rejectedModelOutput(candidate: unknown): unknown {
  const c = candidate as any;
  if (typeof c?.malformedOutput === "string") return c.malformedOutput;
  if (!c || !Array.isArray(c.eventUpdates)) return candidate;
  return {
    scopeId: c.scopeId,
    baseRevision: c.baseRevision,
    newTracks: c.newTracks,
    eventUpdates: c.eventUpdates.map((u: any) => ({
      noteId: u.noteId,
      pitch: u.changes?.pitch ?? u.pitch,
    })),
    rowReplacements: c.rowReplacements,
  };
}

/** Diagnostic preflight only. buildCandidate remains the authority for accepting music. */
export function diagnoseCandidate(
  candidate: unknown,
  scope: Scope,
  song: Song,
  error: unknown,
) {
  const c = candidate as any;
  const issues: any[] = [];
  const issue = (path: string, message: string, detail: object = {}) =>
    issues.push({ path, message, ...detail });
  if (c?.malformedOutput)
    issue("output", c.parseError, { received: c.malformedOutput });
  if (c?.scopeId !== scope.id)
    issue(
      "scopeId",
      "Copy the edit scope ID exactly; do not use the song ID or invent an ID.",
      { expected: scope.id, received: c?.scopeId ?? null },
    );
  if (c?.baseRevision !== scope.baseRevision)
    issue("baseRevision", "Copy the snapshot revision exactly.", {
      expected: scope.baseRevision,
      received: c?.baseRevision ?? null,
    });
  const rows = Array.isArray(c?.rowReplacements) ? c.rowReplacements : [];
  const key = (r: any) => JSON.stringify([r?.trackRef, r?.bar, r?.beat]);
  const seen = new Set<string>();
  rows.forEach((r: any, index: number) => {
    const prefix = `rowReplacements[${index}]`;
    if (seen.has(key(r))) issue(prefix, "Duplicate row", { row: r });
    seen.add(key(r));
    if (!scope.requiredRows.some((x) => key(x) === key(r)))
      issue(prefix, "Row is outside the required output coverage", { row: r });
    if (typeof r?.body !== "string")
      return issue(prefix + ".body", "Expected a bracketed beat string");
    const body = r.body;
    if (!/^\s*\[[^\[\]\r\n]+\]\s*$/.test(body)) {
      const column = !body.trimStart().startsWith("[")
        ? body.search(/\S/) + 1
        : !body.trimEnd().endsWith("]")
          ? body.length + 1
          : Math.max(
              1,
              body.slice(body.indexOf("[") + 1).search(/[\[\]\r\n]/) +
                body.indexOf("[") +
                2,
            );
      return issue(
        prefix + ".body",
        "Use exactly one outer bracket pair, no nesting/newlines, and at least one token. Example: [C5:2 rest]",
        {
          trackRef: r.trackRef,
          bar: r.bar,
          beat: r.beat,
          column,
          received: body,
        },
      );
    }
    const start = body.indexOf("[") + 1;
    const tokens = [
      ...body.slice(start, body.lastIndexOf("]")).matchAll(/\S+/g),
    ];
    if (tokens.length > 32)
      issue(
        prefix + ".body",
        "Generated beat rows may contain at most 32 items",
        { count: tokens.length },
      );
    const track = song.music.tracks.find((t) => t.id === r.trackRef);
    const newTrack = Array.isArray(c?.newTracks)
      ? c.newTracks.find((t: any) => t.ref === r.trackRef)
      : undefined;
    const instrument =
      INSTRUMENTS[track?.instrumentId ?? newTrack?.instrumentId];
    for (const token of tokens) {
      const match = /^([A-G][#b]?[0-8]|rest|hold|hit)(?::([1-9]\d*))?$/.exec(
        token[0],
      );
      const location = {
        trackRef: r.trackRef,
        bar: r.bar,
        beat: r.beat,
        column: start + token.index! + 1,
        token: token[0],
      };
      if (!match) {
        issue(
          prefix + ".body",
          "Invalid token. Use a pitch (C5, G#3, Bb4), rest, hold or hit, optionally followed by :positiveInteger.",
          location,
        );
        continue;
      }
      const weight = Number(match[2] ?? 1);
      if (!Number.isSafeInteger(weight) || weight > 1000000)
        issue(
          prefix + ".body",
          "Weight must be an integer between 1 and 1000000",
          location,
        );
      if (!instrument || match[1] === "rest") continue;
      if (instrument.kind === "hit" ? match[1] !== "hit" : match[1] === "hit")
        issue(
          prefix + ".body",
          "This token does not match the track's pitched/percussion instrument",
          location,
        );
      const midi = pitchToMidi(match[1]);
      if (
        instrument.kind === "pitched" &&
        midi !== null &&
        midi !== undefined &&
        (midi < instrument.minMidi! || midi > instrument.maxMidi!)
      )
        issue(prefix + ".body", "Pitch outside instrument range", {
          ...location,
          minMidi: instrument.minMidi,
          maxMidi: instrument.maxMidi,
        });
    }
  });
  const missingRows = scope.requiredRows.filter((r) => !seen.has(key(r)));
  if (missingRows.length && (!c?.eventUpdates?.length || rows.length))
    issue(
      "rowReplacements",
      "Return every required beat row, including unchanged/rest rows. These rows are missing:",
      { missingRows },
    );
  if (error instanceof z.ZodError)
    issues.push(
      ...error.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    );
  return {
    validatorError:
      error instanceof Error ? error.message : "Invalid candidate",
    issues,
  };
}
