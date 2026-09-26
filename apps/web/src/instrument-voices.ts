import * as Tone from "tone";
import type { Note, Track } from "@eight-bit/core";

export type InstrumentVoice = {
  gain: Tone.Volume;
  trigger: (note: Note, duration: number, time: number) => void;
  dispose: () => void;
};

type Triggerable = {
  connect: (destination: Tone.ToneAudioNode) => Triggerable;
  triggerAttackRelease: (
    note: string | number,
    duration: number,
    time?: number,
    velocity?: number,
  ) => void;
  dispose: () => void;
};

type PresetOscillator = "sine" | "square" | "triangle" | "sawtooth";

const pitchedOscillator = (id: string): PresetOscillator => {
  if (["saw_lead", "synth_brass", "warm_strings"].includes(id)) return "sawtooth";
  if (["soft_lead", "chip_bass", "chip_pad", "dream_pad"].includes(id)) return "triangle";
  if (id === "reed_organ") return "square";
  return "square";
};

function pitchedVoice(id: string): Triggerable {
  if (id === "fm_bell" || id === "electric_piano" || id === "glass_bell") {
    const bell = new Tone.FMSynth({
      harmonicity: id === "glass_bell" ? 5.2 : id === "electric_piano" ? 2.4 : 3.5,
      modulationIndex: id === "glass_bell" ? 14 : id === "electric_piano" ? 6 : 9,
      oscillator: { type: "sine" },
      modulation: { type: "square" },
      envelope: {
        attack: 0.002,
        decay: id === "glass_bell" ? 1.5 : id === "electric_piano" ? 0.6 : 1.1,
        sustain: id === "electric_piano" ? 0.18 : 0,
        release: id === "glass_bell" ? 0.55 : 0.25,
      },
    });
    return bell as unknown as Triggerable;
  }
  if (id === "choir_pad") {
    return new Tone.AMSynth({
      harmonicity: 2,
      oscillator: { type: "sine" },
      envelope: { attack: 0.16, decay: 0.2, sustain: 0.72, release: 0.55 },
      modulation: { type: "triangle" },
      modulationEnvelope: { attack: 0.3, decay: 0.2, sustain: 0.4, release: 0.5 },
    }) as unknown as Triggerable;
  }
  const pluck = id === "pluck" || id === "harp_pluck";
  const warm = id === "warm_strings" || id === "dream_pad";
  const synth = new Tone.Synth({
    oscillator: { type: pitchedOscillator(id) },
    envelope: {
      attack: id === "synth_brass" ? 0.015 : warm ? 0.12 : 0.004,
      decay: id === "synth_brass" ? 0.14 : pluck ? 0.09 : warm ? 0.3 : 0.025,
      sustain: id === "reed_organ" ? 0.82 : pluck ? 0.06 : warm ? 0.62 : 0.55,
      release: id === "synth_brass" ? 0.08 : pluck ? 0.16 : warm ? 0.38 : 0.004,
    },
  });
  return synth as unknown as Triggerable;
}

export function createInstrumentVoice(
  track: Track,
  output: Tone.ToneAudioNode,
): InstrumentVoice {
  const gain = new Tone.Volume(track.volumeDb).connect(output);
  gain.mute = track.muted;

  if (track.type === "harmonic") {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: pitchedOscillator(track.instrumentId) },
      envelope: {
        attack: track.instrumentId === "dream_pad" ? 0.16 : 0.08,
        decay: 0.12,
        sustain: track.instrumentId === "dream_pad" ? 0.78 : 0.72,
        release: track.instrumentId === "dream_pad" ? 0.55 : 0.3,
      },
      volume: -5,
    }).connect(gain);
    return {
      gain,
      trigger: (n, d, t) => {
        if (n.kind === "pitched")
          synth.triggerAttackRelease(n.pitch, Math.max(0.001, d - 0.004), t, n.velocity / 127);
      },
      dispose: () => {
        synth.dispose();
        gain.dispose();
      },
    };
  }

  if (track.instrumentId === "kick" || track.instrumentId === "low_tom") {
    const synth = new Tone.MembraneSynth({
      pitchDecay: track.instrumentId === "kick" ? 0.035 : 0.08,
      octaves: track.instrumentId === "kick" ? 5 : 2.5,
      envelope: {
        attack: 0.001,
        decay: track.instrumentId === "kick" ? 0.15 : 0.35,
        sustain: 0,
        release: 0.03,
      },
    }).connect(gain);
    return {
      gain,
      trigger: (n, _d, t) =>
        synth.triggerAttackRelease(track.instrumentId === "kick" ? "C1" : "C2", track.instrumentId === "kick" ? 0.08 : 0.22, t, n.velocity / 127),
      dispose: () => {
        synth.dispose();
        gain.dispose();
      },
    };
  }

  if (["snare", "closed_hat", "open_hat", "shaker", "clap", "crash"].includes(track.instrumentId)) {
    const hat = track.instrumentId === "closed_hat" || track.instrumentId === "open_hat" || track.instrumentId === "shaker" || track.instrumentId === "crash";
    const filter = new Tone.Filter(
      track.instrumentId === "shaker" ? 8000 : hat ? 6500 : 1800,
      "highpass",
    ).connect(gain);
    const noise = new Tone.NoiseSynth({
      noise: { type: track.instrumentId === "crash" ? "white" : "white" },
      envelope: {
        attack: 0.001,
        decay:
          track.instrumentId === "crash" ? 0.7 :
          track.instrumentId === "open_hat" ? 0.16 :
          track.instrumentId === "shaker" ? 0.045 :
          track.instrumentId === "clap" ? 0.08 :
          hat ? 0.035 : 0.12,
        sustain: 0,
        release: 0.01,
      },
    }).connect(filter);
    const body = ["snare", "clap"].includes(track.instrumentId)
      ? new Tone.Synth({
          oscillator: { type: track.instrumentId === "clap" ? "square" : "triangle" },
          envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 },
        }).connect(gain)
      : null;
    return {
      gain,
      trigger: (n, _d, t) => {
        noise.triggerAttackRelease(track.instrumentId === "crash" ? 0.55 : track.instrumentId === "open_hat" ? 0.15 : 0.05, t, n.velocity / 127);
        if (body) body.triggerAttackRelease(track.instrumentId === "clap" ? "C5" : "D3", 0.045, t, n.velocity / 254);
      },
      dispose: () => {
        noise.dispose();
        body?.dispose();
        filter.dispose();
        gain.dispose();
      },
    };
  }

  if (track.instrumentId === "woodblock") {
    const synth = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
    }).connect(gain);
    return {
      gain,
      trigger: (n, _d, t) => synth.triggerAttackRelease("C6", 0.055, t, n.velocity / 127),
      dispose: () => {
        synth.dispose();
        gain.dispose();
      },
    };
  }

  const synth = pitchedVoice(track.instrumentId).connect(gain) as unknown as Triggerable;
  return {
    gain,
    trigger: (n, d, t) => {
      if (n.kind === "pitched")
        synth.triggerAttackRelease(n.pitch, Math.max(0.001, d - 0.004), t, n.velocity / 127);
    },
    dispose: () => {
      synth.dispose();
      gain.dispose();
    },
  };
}
