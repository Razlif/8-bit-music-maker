import { midiToPitch, pitchToMidi } from "./instruments.js";

export const CHORD_QUALITIES = [
  "major", "minor", "diminished", "augmented", "sus2", "sus4",
  "dominant7", "major7", "minor7", "add9", "minorAdd9",
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

const intervals: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  add9: [0, 4, 7, 14],
  minorAdd9: [0, 3, 7, 14],
};

/**
 * Resolve a chord to a close, ascending voicing.
 *
 * `range` is a preferred musical register, not a hard safety boundary. When
 * the requested voicing cannot fit there, `fallbackRange` is used (normally
 * the instrument's actual playable range). This lets the composer ask for a
 * useful register without making a valid chord fail just because one tone
 * needs to spill into a nearby octave.
 */
export function resolveChord(
  root: string,
  quality: ChordQuality,
  range: string,
  voicing: "root" | "first" | "second" | "third" = "root",
  fallbackRange?: string,
): string[] {
  const parseRange = (text: string) => {
    const [low, high, ...extra] = text.split("-");
    if (!low || !high || extra.length) throw new Error("INVALID_CHORD_REGISTER: " + text);
    const lowMidi = pitchToMidi(low), highMidi = pitchToMidi(high);
    if (lowMidi === null || highMidi === null || lowMidi > highMidi)
      throw new Error("INVALID_CHORD_REGISTER_OR_ROOT");
    return { lowMidi, highMidi };
  };
  const preferred = parseRange(range), fallback = fallbackRange ? parseRange(fallbackRange) : undefined;
  const rootMidi = pitchToMidi(root + "3");
  if (rootMidi === null)
    throw new Error("INVALID_CHORD_REGISTER_OR_ROOT");
  const tones = intervals[quality];
  const inversion = voicing === "root" ? 0 : voicing === "first" ? 1 : voicing === "second" ? 2 : 3;
  if (inversion >= tones.length) throw new Error("VOICING_NOT_AVAILABLE: " + voicing + " " + quality);
  const voicedIntervals = [...tones.slice(inversion), ...tones.slice(0, inversion).map((n) => n + 12)];
  const pitchClass = rootMidi % 12;
  const find = (bounds: { lowMidi: number; highMidi: number }) => {
    let best: number[] | undefined, distance = Infinity;
    for (let midi = bounds.lowMidi; midi <= bounds.highMidi; midi++) {
      if (midi % 12 !== pitchClass) continue;
      const candidate = voicedIntervals.map((offset) => midi + offset);
      if (candidate.some((note) => note > bounds.highMidi)) continue;
      const cost = Math.abs(midi - Math.max(bounds.lowMidi, Math.min(bounds.highMidi, bounds.lowMidi + 12)));
      if (cost < distance) { best = candidate; distance = cost; }
    }
    return best;
  };
  const best = find(preferred) ?? (fallback ? find(fallback) : undefined);
  if (!best) throw new Error("CHORD_DOES_NOT_FIT_PLAYABLE_RANGE: " + root + " " + quality + " " + (fallbackRange ?? range));
  return best.map(midiToPitch);
}
