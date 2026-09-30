import { cmp, frac, max, min, sub } from "./fractions.js";
import { noteEnd, resolveScope } from "./scope.js";
import { validateSong, type Note, type Selection, type Song, type Span } from "./schema.js";

// Project a completed arrangement onto the user's selection at the save boundary.
// The model can compose with full context; it cannot enlarge the applied selection.
export function trimUpdateToSelection(base: Song, generated: Song, selection: Selection): Song {
  if (selection.kind === "song") return validateSong(generated);
  resolveScope(base, selection); // Reject stale/unknown selection IDs before applying.
  const next = structuredClone(base);
  for (const track of next.music.tracks) {
    const replacement = generated.music.tracks.find(t => t.id === track.id);
    if (!replacement) continue;
    const spans: Span[] = selection.kind === "tracks"
      ? selection.trackIds.includes(track.id) ? [{ start: frac(0), end: frac(base.music.bars * 4) }] : []
      : selection.kind === "regions"
        ? selection.regions.filter(r => r.trackIds.includes(track.id))
        : track.notes.filter(n => selection.noteIds.includes(n.id)).map(n => ({ start: n.start, end: noteEnd(n) }));
    // Merge touching/overlapping ranges so a note is never inserted twice.
    const merged: Span[] = [];
    for (const span of [...spans].sort((a, b) => cmp(a.start, b.start))) {
      const last = merged.at(-1);
      if (last && cmp(span.start, last.end) <= 0) last.end = max(last.end, span.end);
      else merged.push({ ...span });
    }
    if (!merged.length) continue;
    const protectedNotes = track.notes.filter(n =>
      (selection.kind === "notes" && !selection.noteIds.includes(n.id)) ||
      !merged.some(s => cmp(n.start, s.start) >= 0 && cmp(noteEnd(n), s.end) <= 0));
    // A single selected voice of a block chord can be replaced only by notes
    // with the same timing as its unselected sibling voices.
    const selectedVoices = selection.kind === "notes" && track.type === "harmonic"
      ? track.notes.filter(n => selection.noteIds.includes(n.id) && protectedNotes.some(p =>
        cmp(p.start, n.start) === 0 && cmp(noteEnd(p), noteEnd(n)) === 0)) : [];
    let windows = merged;
    for (const note of protectedNotes) {
      windows = windows.flatMap(s => {
        if (cmp(noteEnd(note), s.start) <= 0 || cmp(note.start, s.end) >= 0) return [s];
        const parts: Span[] = [];
        if (cmp(s.start, note.start) < 0) parts.push({ start: s.start, end: note.start });
        if (cmp(noteEnd(note), s.end) < 0) parts.push({ start: noteEnd(note), end: s.end });
        return parts;
      });
    }
    const inserted: Note[] = replacement.notes.flatMap(n => windows.flatMap(s => {
      const start = max(n.start, s.start), end = min(noteEnd(n), s.end);
      return cmp(start, end) < 0
        ? [{ ...n, id: crypto.randomUUID(), start, duration: sub(end, start) }] : [];
    }));
    for (const original of selectedVoices) {
      const chosen = replacement.notes.find(n => n.kind === "pitched" &&
        cmp(n.start, original.start) === 0 && cmp(noteEnd(n), noteEnd(original)) === 0 &&
        !protectedNotes.concat(inserted, selectedVoices.filter(p => p.id !== original.id)).some(p => p.kind === "pitched" && p.pitch === n.pitch && cmp(p.start, n.start) === 0));
      const voice = chosen ? { ...chosen, id: original.id } : original;
      inserted.push(voice);
    }
    track.notes = [...protectedNotes, ...inserted].sort((a, b) => cmp(a.start, b.start));
  }
  return validateSong(next);
}
