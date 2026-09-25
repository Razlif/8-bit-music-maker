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

/** Resolve a chord to a close, ascending root-position voicing in the given range. */
export function resolveChord(
  root: string,
  quality: ChordQuality,
  range: string,
  voicing: "root" | "first" | "second" | "third" = "root",
): string[] {
  const [low, high, ...extra] = range.split("-");
  if (!low || !high || extra.length) throw new Error("INVALID_CHORD_REGISTER: " + range);
  const lowMidi = pitchToMidi(low), highMidi = pitchToMidi(high), rootMidi = pitchToMidi(root + "3");
  if (lowMidi === null || highMidi === null || rootMidi === null || lowMidi > highMidi)
    throw new Error("INVALID_CHORD_REGISTER_OR_ROOT");
  const tones = intervals[quality];
  const inversion = voicing === "root" ? 0 : voicing === "first" ? 1 : voicing === "second" ? 2 : 3;
  if (inversion >= tones.length) throw new Error("VOICING_NOT_AVAILABLE: " + voicing + " " + quality);
  const voicedIntervals = [...tones.slice(inversion), ...tones.slice(0, inversion).map((n) => n + 12)];
  const pitchClass = rootMidi % 12, target = Math.max(lowMidi, Math.min(highMidi, lowMidi + 12));
  let best: number[] | undefined, distance = Infinity;
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    if (midi % 12 !== pitchClass) continue;
    const candidate = voicedIntervals.map((offset) => midi + offset);
    if (candidate.some((note) => note > highMidi)) continue;
    const cost = Math.abs(midi - target);
    if (cost < distance) { best = candidate; distance = cost; }
  }
  if (!best) throw new Error("CHORD_DOES_NOT_FIT_REGISTER: " + root + " " + quality + " " + range);
  return best.map(midiToPitch);
}
