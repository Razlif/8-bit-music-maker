export type InstrumentKind = "pitched" | "hit";
export type Instrument = {
  id: string;
  name: string;
  kind: InstrumentKind;
  minMidi?: number;
  maxMidi?: number;
  description: string;
};
export const INSTRUMENTS: Record<string, Instrument> = {
  chip_bass: {
    id: "chip_bass",
    name: "Chip Bass",
    kind: "pitched",
    minMidi: 24,
    maxMidi: 60,
    description: "Warm triangle bass with a steady sustain",
  },
  bright_lead: {
    id: "bright_lead",
    name: "Bright Lead",
    kind: "pitched",
    minMidi: 48,
    maxMidi: 96,
    description: "Bright square-wave lead",
  },
  soft_lead: {
    id: "soft_lead",
    name: "Soft Lead",
    kind: "pitched",
    minMidi: 48,
    maxMidi: 96,
    description: "Mellow triangle lead",
  },
  pluck: {
    id: "pluck",
    name: "Pluck",
    kind: "pitched",
    minMidi: 36,
    maxMidi: 96,
    description: "Short pulse pluck",
  },
  chip_pad: {
    id: "chip_pad",
    name: "Chip Pad",
    kind: "pitched",
    minMidi: 36,
    maxMidi: 84,
    description: "Soft sustained polyphonic pulse pad for block chords",
  },
  kick: {
    id: "kick",
    name: "Kick",
    kind: "hit",
    description: "Short downward-pitched kick",
  },
  snare: {
    id: "snare",
    name: "Snare",
    kind: "hit",
    description: "Noise snare with tonal body",
  },
  closed_hat: {
    id: "closed_hat",
    name: "Closed Hi-Hat",
    kind: "hit",
    description: "Short filtered noise hat",
  },
};
export const listInstruments = () => Object.values(INSTRUMENTS);
const pitchPattern = /^([A-G])([#b]?)([0-8])$/;
const semitones: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
export function pitchToMidi(pitch: string): number | null {
  const m = pitchPattern.exec(pitch);
  if (!m) return null;
  return (
    (Number(m[3]) + 1) * 12 +
    semitones[m[1]] +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0)
  );
}
export function midiToPitch(midi: number): string {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
