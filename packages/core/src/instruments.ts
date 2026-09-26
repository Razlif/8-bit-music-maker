export type InstrumentKind = "pitched" | "hit";
export type InstrumentAvailability = "production" | "candidate" | "retired";
export type Instrument = {
  id: string;
  name: string;
  kind: InstrumentKind;
  availability?: InstrumentAvailability;
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
    availability: "retired",
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
  pulse_lead: {
    id: "pulse_lead",
    name: "Pulse Lead",
    kind: "pitched",
    availability: "candidate",
    minMidi: 48,
    maxMidi: 96,
    description: "Focused square-wave lead with a crisp arcade attack",
  },
  saw_lead: {
    id: "saw_lead",
    name: "Saw Lead",
    kind: "pitched",
    availability: "production",
    minMidi: 48,
    maxMidi: 96,
    description: "Bright buzzy lead for heroic melodies",
  },
  fm_bell: {
    id: "fm_bell",
    name: "FM Bell",
    kind: "pitched",
    availability: "production",
    minMidi: 48,
    maxMidi: 96,
    description: "Metallic bell for magical and sparkling phrases",
  },
  glass_bell: {
    id: "glass_bell",
    name: "Glass Bell",
    kind: "pitched",
    availability: "candidate",
    minMidi: 60,
    maxMidi: 108,
    description: "Small crystalline bell with a quick decay",
  },
  synth_brass: {
    id: "synth_brass",
    name: "Synth Brass",
    kind: "pitched",
    availability: "candidate",
    minMidi: 48,
    maxMidi: 84,
    description: "Punchy brass-like stabs and held fanfares",
  },
  reed_organ: {
    id: "reed_organ",
    name: "Reed Organ",
    kind: "pitched",
    availability: "candidate",
    minMidi: 36,
    maxMidi: 96,
    description: "Steady square-edged organ for chords and counterpoint",
  },
  warm_strings: {
    id: "warm_strings",
    name: "Warm Strings",
    kind: "pitched",
    availability: "candidate",
    minMidi: 36,
    maxMidi: 96,
    description: "Soft sustained string-like pad",
  },
  dream_pad: {
    id: "dream_pad",
    name: "Dream Pad",
    kind: "pitched",
    availability: "production",
    minMidi: 36,
    maxMidi: 84,
    description: "Wide slow pad for background harmony",
  },
  choir_pad: {
    id: "choir_pad",
    name: "Choir Pad",
    kind: "pitched",
    availability: "candidate",
    minMidi: 36,
    maxMidi: 84,
    description: "Hollow vocal-like pad for ancient and fantasy moods",
  },
  harp_pluck: {
    id: "harp_pluck",
    name: "Harp Pluck",
    kind: "pitched",
    availability: "candidate",
    minMidi: 48,
    maxMidi: 108,
    description: "Short bright pluck for arpeggios and ornaments",
  },
  electric_piano: {
    id: "electric_piano",
    name: "Electric Piano",
    kind: "pitched",
    availability: "production",
    minMidi: 36,
    maxMidi: 96,
    description: "Soft percussive keys with a small bell overtone",
  },
  open_hat: {
    id: "open_hat",
    name: "Open Hi-Hat",
    kind: "hit",
    availability: "production",
    description: "Longer noisy hat for transitions and lift",
  },
  low_tom: {
    id: "low_tom",
    name: "Low Tom",
    kind: "hit",
    availability: "production",
    description: "Rounded tuned drum for fills",
  },
  clap: {
    id: "clap",
    name: "Clap",
    kind: "hit",
    availability: "candidate",
    description: "Short bright noise burst with a wooden body",
  },
  shaker: {
    id: "shaker",
    name: "Shaker",
    kind: "hit",
    availability: "candidate",
    description: "Short high-passed noise tick",
  },
  woodblock: {
    id: "woodblock",
    name: "Woodblock",
    kind: "hit",
    availability: "production",
    description: "Dry tuned click for rhythmic punctuation",
  },
  crash: {
    id: "crash",
    name: "Crash",
    kind: "hit",
    availability: "production",
    description: "Long noisy cymbal accent",
  },
};
export const isActiveInstrument = (instrument: Instrument) =>
  instrument.availability !== "candidate" && instrument.availability !== "retired";

export const listInstruments = (includeCandidates = false) =>
  Object.values(INSTRUMENTS).filter(
    (instrument) => includeCandidates || isActiveInstrument(instrument),
  );
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
