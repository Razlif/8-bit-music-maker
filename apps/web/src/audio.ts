import * as Tone from "tone";
import { value, type Song, type Track } from "@eight-bit/core";
import { createInstrumentVoice } from "./instrument-voices.js";
function session(song: Song, analyse = false) {
  const limiter = new Tone.Limiter(-1).toDestination(),
    master = new Tone.Gain(0.35).connect(limiter);
  const voices = new Map(
    song.music.tracks.map((t) => [t.id, createInstrumentVoice(t, master)]),
  );
  const meters = new Map<string, Tone.Meter>();
  const fft = analyse ? new Tone.FFT(256) : undefined;
  if (fft) limiter.connect(fft);
  if (analyse) voices.forEach((v, id) => {
    const meter = new Tone.Meter({ smoothing: 0.7 });
    v.gain.connect(meter);
    meters.set(id, meter);
  });
  return {
    meters,
    fft,
    voices,
    master,
    dispose: () => {
      voices.forEach((v) => v.dispose());
      meters.forEach((m) => m.dispose());
      fft?.dispose();
      master.dispose();
      limiter.dispose();
    },
  };
}
export type LoopRange = { start: number; end: number };
export class Player {
  private current?: ReturnType<typeof session>;
  private pending?: number;
  private range: LoopRange = { start: 0, end: 16 };
  private bpm = 120;
  private solo = new Set<string>();
  private mixTracks: Track[] = [];
  private retired = new Set<ReturnType<typeof session>>();
  playing = false;
  async play(song: Song, range?: LoopRange) {
    await Tone.start();
    this.start(song, range);
  }
  private start(
    song: Song,
    range?: LoopRange,
    boundaryTime?: number,
    offsetBeats = 0,
  ) {
    const transport = Tone.getTransport();
    if (boundaryTime === undefined) this.stop();
    else {
      transport.stop(boundaryTime);
      transport.cancel();
      const old = this.current;
      if (old) {
        old.master.gain.setValueAtTime(0, boundaryTime);
        this.retired.add(old);
        Tone.getContext().setTimeout(
          () => {
            if (this.retired.delete(old)) old.dispose();
          },
          Math.max(0, boundaryTime - Tone.now()) + 0.05,
        );
      }
    }
    this.range = range ?? { start: 0, end: song.music.bars * 4 };
    this.bpm = song.music.bpm;
    this.current = session(song, true);
    const beat = 60 / song.music.bpm;
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = (this.range.end - this.range.start) * beat;
    for (const t of song.music.tracks)
      for (const n of t.notes) {
        const left = Math.max(value(n.start), this.range.start),
          right = Math.min(value(n.start) + value(n.duration), this.range.end);
        if (right <= left) continue;
        const v = this.current.voices.get(t.id)!;
        transport.schedule(
          (time) => v.trigger(n, (right - left) * beat, time),
          (left - this.range.start) * beat,
        );
        if (
          boundaryTime !== undefined &&
          left < offsetBeats &&
          right > offsetBeats
        )
          transport.scheduleOnce(
            (time) => v.trigger(n, (right - offsetBeats) * beat, time),
            (offsetBeats - this.range.start) * beat,
          );
      }
    if (this.mixTracks.length)
      this.mix(
        song.music.tracks.map((t) => {
          const mix = this.mixTracks.find((m) => m.id === t.id);
          return mix ? { ...t, volumeDb: mix.volumeDb, muted: mix.muted } : t;
        }),
        this.solo,
      );
    transport.start(
      boundaryTime ?? "+0.03",
      Math.max(0, offsetBeats - this.range.start) * beat,
    );
    this.playing = true;
  }
  switchAtBar(song: Song) {
    if (!this.playing) return;
    const transport = Tone.getTransport();
    if (this.pending !== undefined) transport.clear(this.pending);
    const bar = (4 * 60) / this.bpm,
      next = (Math.floor(transport.seconds / bar) + 1) * bar;
    this.pending = transport.scheduleOnce(
      (time) => {
        const offset =
          (this.range.start + (next * this.bpm) / 60) % (song.music.bars * 4);
        this.start(song, undefined, time, offset);
      },
      next >= Number(transport.loopEnd) ? 0 : next,
    );
  }
  mix(tracks: Track[], solo: Set<string> = new Set()) {
    this.mixTracks = tracks;
    this.solo = new Set(solo);
    for (const t of tracks) {
      const v = this.current?.voices.get(t.id);
      if (v) {
        v.gain.mute = false;
        v.gain.volume.rampTo(
          t.muted || (solo.size > 0 && !solo.has(t.id)) ? -100 : t.volumeDb,
          0.015,
        );
      }
    }
  }
  level(trackId: string): number {
    const v = this.current?.meters.get(trackId)?.getValue();
    return typeof v === "number" ? v : v ? Math.max(...v) : -Infinity;
  }
  spectrum(): number[] {
    const bins = this.current?.fft?.getValue();
    return Array.from({ length: 16 }, (_, i) => {
      if (!bins) return 0;
      const start = Math.floor(Math.pow(256, i / 16));
      const end = Math.max(start + 1, Math.floor(Math.pow(256, (i + 1) / 16)));
      let peak = -Infinity;
      for (let j = start; j < end && j < bins.length; j++) peak = Math.max(peak, bins[j]);
      return Math.max(0, Math.min(1, (peak + 80) / 70));
    });
  }
  get beat() {
    return (
      this.range.start +
      (this.playing ? (Tone.getTransport().seconds * this.bpm) / 60 : 0)
    );
  }
  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    this.current?.dispose();
    this.retired.forEach((s) => s.dispose());
    this.retired.clear();
    this.current = undefined;
    this.pending = undefined;
    this.playing = false;
  }
}
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
): ArrayBuffer {
  const frames = channels[0].length,
    buffer = new ArrayBuffer(44 + frames * 4),
    view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  const fade = Math.round(sampleRate * 0.005);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < 2; c++) {
      const gain = Math.min(1, i / fade, (frames - 1 - i) / fade),
        sample = Math.max(-1, Math.min(1, channels[c][i] * gain));
      view.setInt16(
        44 + (i * 2 + c) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}
export async function exportWav(song: Song): Promise<Blob> {
  const rate = 44100,
    frames = Math.round(((song.music.bars * 4 * 60) / song.music.bpm) * rate),
    seconds = frames / rate;
  // Shared presets and master chain; transient solo never enters this snapshot.
  const rendered = await Tone.Offline(
    () => {
      const s = session(song),
        beat = 60 / song.music.bpm;
      for (const track of song.music.tracks)
        for (const n of track.notes)
          s.voices
            .get(track.id)!
            .trigger(n, value(n.duration) * beat, value(n.start) * beat);
    },
    seconds + 0.1,
    2,
    rate,
  );
  const channels = [0, 1].map((c) =>
    rendered.getChannelData(c).slice(0, frames),
  );
  rendered.dispose();
  return new Blob([encodeWav(channels, rate)], { type: "audio/wav" });
}
