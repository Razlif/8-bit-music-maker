import * as Tone from "tone";
import { encodeWav } from "./audio";

export type EffectVoice = {
  kind: "tone" | "noise";
  waveform: "sine" | "square" | "triangle" | "sawtooth" | null;
  startMs: number;
  durationMs: number;
  frequencyStart: number | null;
  frequencyEnd: number | null;
  gainStart: number;
  gainEnd: number;
  pan: number;
  shaping?: { attackMs: number; releaseMs: number; filter: "lowpass" | "highpass" | "bandpass"; cutoffStart: number; cutoffEnd: number; resonance: number; vibratoHz: number; vibratoCents: number } | null;
};

export type EffectRecipe = {
  name: string;
  description: string;
  durationMs: number;
  voices: EffectVoice[];
};

type EffectNode = { dispose: () => void; stop?: (time?: number) => void };

function noiseBuffer(durationMs: number) {
  const context = Tone.getContext().rawContext;
  const sampleRate = context.sampleRate || 44100;
  const buffer = context.createBuffer(
    1,
    Math.ceil((durationMs / 1000) * sampleRate) + 1,
    sampleRate,
  );
  const data = buffer.getChannelData(0);
  let seed = 0x6d2b79f5;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    data[index] = ((value ^ (value >>> 14)) >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

function scheduleVoice(
  voice: EffectVoice,
  output: Tone.ToneAudioNode,
  offset = 0,
): EffectNode[] {
  const start = offset + voice.startMs / 1000;
  const duration = voice.durationMs / 1000;
  const destination = new Tone.Panner(voice.pan).connect(output);
  const gain = new Tone.Gain(voice.gainStart).connect(destination);
  gain.gain.setValueAtTime(voice.gainStart, start);
  gain.gain.linearRampToValueAtTime(voice.gainEnd, start + duration);
  const extra: EffectNode[] = [];
  let input: Tone.ToneAudioNode = gain;
  if (voice.shaping) {
    const shape = voice.shaping;
    const attack = Math.min(shape.attackMs / 1000, duration / 2);
    const release = Math.min(shape.releaseMs / 1000, duration - attack);
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(voice.gainStart, start + attack);
    gain.gain.linearRampToValueAtTime(voice.gainEnd, start + duration - release);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    const filter = new Tone.Filter(shape.cutoffStart, shape.filter).connect(gain);
    filter.Q.value = shape.resonance;
    filter.frequency.setValueAtTime(shape.cutoffStart, start);
    filter.frequency.exponentialRampToValueAtTime(shape.cutoffEnd, start + duration);
    input = filter;
    extra.push(filter);
  }

  if (voice.kind === "noise") {
    const source = new Tone.Player(noiseBuffer(voice.durationMs)).connect(input);
    source.start(start);
    source.stop(start + duration);
    return [source, ...extra, gain, destination];
  }

  const source = new Tone.Oscillator(
    voice.frequencyStart ?? 220,
    voice.waveform ?? "sine",
  ).connect(input);
  if (voice.shaping?.vibratoHz && voice.shaping.vibratoCents) {
    const vibrato = new Tone.LFO(voice.shaping.vibratoHz, -voice.shaping.vibratoCents, voice.shaping.vibratoCents).connect(source.detune);
    vibrato.start(start).stop(start + duration);
    extra.push(vibrato);
  }
  source.frequency.setValueAtTime(voice.frequencyStart ?? 220, start);
  source.frequency.linearRampToValueAtTime(
    voice.frequencyEnd ?? voice.frequencyStart ?? 220,
    start + duration,
  );
  source.start(start);
  source.stop(start + duration);
  return [source, ...extra, gain, destination];
}

export class EffectPlayer {
  private nodes: EffectNode[] = [];
  private timer: number | null = null;

  async play(recipe: EffectRecipe) {
    await Tone.start();
    this.stop();
    const master = new Tone.Gain(0.7).toDestination();
    this.nodes = [master];
    const start = Tone.now();
    for (const voice of recipe.voices)
      this.nodes.push(...scheduleVoice(voice, master, start));
    this.timer = window.setTimeout(() => this.stop(), recipe.durationMs + 250);
  }

  stop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    for (const node of this.nodes) {
      try {
        node.stop?.();
      } catch {
        // A scheduled Tone source may already have finished.
      }
      node.dispose();
    }
    this.nodes = [];
  }
}

export async function exportEffectWav(recipe: EffectRecipe): Promise<Blob> {
  const rate = 44100;
  const frames = Math.round((recipe.durationMs / 1000) * rate);
  const rendered = await Tone.Offline(
    () => {
      const master = new Tone.Gain(0.7).toDestination();
      for (const voice of recipe.voices) scheduleVoice(voice, master);
    },
    recipe.durationMs / 1000 + 0.1,
    2,
    rate,
  );
  const channels = [0, 1].map((channel) =>
    rendered.getChannelData(channel).slice(0, frames),
  );
  rendered.dispose();
  return new Blob([encodeWav(channels, rate)], { type: "audio/wav" });
}
