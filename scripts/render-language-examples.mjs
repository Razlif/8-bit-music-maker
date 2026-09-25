// Tutorial-only parser and offline audio renderer. No third-party dependencies.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'examples', 'audio');
const rate = 44100;
const gcd = (a, b) => b ? gcd(b, a % b) : a;
function fraction(n, d = 1) {
  assert(Number.isSafeInteger(n) && Number.isSafeInteger(d) && d > 0);
  const g = gcd(Math.abs(n), d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const same = (a, b) => a.n === b.n && a.d === b.d;
const value = f => f.n / f.d;
const instruments = {
  bright_lead: { pitched: true, min: 48, max: 96 },
  chip_bass: { pitched: true, min: 24, max: 60 },
  kick: { pitched: false },
  closed_hat: { pitched: false },
};
function pitch(token) {
  const m = /^([A-G])([#b]?)([0-8])$/.exec(token);
  if (!m) return null;
  return (Number(m[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function parse(source) {
  const tracks = new Map();
  const rows = new Map();
  let bpm, bar = 0, beat = 0;
  for (const [i, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const fail = message => { throw new Error(`Line ${i + 1}: ${message}`); };
    let m;
    if ((m = /^SONG \| meter=4\/4 \| bpm=(\d+)$/.exec(line))) {
      if (bpm || tracks.size || bar) fail('song header must appear once, first');
      bpm = Number(m[1]);
      if (bpm < 40 || bpm > 240) fail('prototype tempo range is 40–240');
    } else if ((m = /^TRACK ([a-z][a-z0-9_]*) \| instrument=([a-z_]+)$/.exec(line))) {
      if (!bpm || bar || tracks.has(m[1]) || !instruments[m[2]]) fail('invalid track declaration');
      tracks.set(m[1], m[2]);
      if (tracks.size > 8) fail('at most eight tracks');
    } else if ((m = /^BAR (\d+)$/.exec(line))) {
      if (!tracks.size || Number(m[1]) !== bar + 1 || (bar && beat !== 4)) fail('bars must be consecutive and complete');
      bar = Number(m[1]); beat = 0;
    } else if ((m = /^beat ([1-4])$/.exec(line))) {
      if (!bar || Number(m[1]) !== beat + 1) fail('beats must be consecutive');
      beat = Number(m[1]);
    } else if ((m = /^([a-z][a-z0-9_]*) \[([^\[\]]+)\]$/.exec(line))) {
      if (!bar || !beat || !tracks.has(m[1])) fail('invalid row location or track');
      const key = `${bar}/${beat}/${m[1]}`;
      if (rows.has(key)) fail('duplicate row');
      const items = m[2].trim().split(/\s+/).map(text => {
        const token = /^([A-G][#b]?[0-8]|rest|hold|hit)(?::([1-9]\d*))?$/.exec(text);
        if (!token) fail(`invalid token ${text}`);
        const weight = Number(token[2] ?? 1);
        if (weight > 64) fail('prototype weight limit is 64');
        return { token: token[1], weight };
      });
      if (items.length > 32) fail('prototype row limit is 32 items');
      rows.set(key, items);
    } else fail(`unrecognized syntax: ${line}`);
  }
  assert(bpm && bar && beat === 4, 'incomplete song');
  const events = [];
  for (const [track, instrument] of tracks) {
    let previous = null;
    for (let b = 1; b <= bar; b++) for (let t = 1; t <= 4; t++) {
      const location = `bar ${b}, beat ${t}, ${track}`;
      const items = rows.get(`${b}/${t}/${track}`);
      assert(items, `missing ${location}`);
      const total = items.reduce((sum, item) => sum + item.weight, 0);
      let cursor = fraction((b - 1) * 4 + t - 1);
      for (const item of items) {
        const duration = fraction(item.weight, total);
        const end = add(cursor, duration);
        const preset = instruments[instrument];
        if (item.token === 'rest') previous = null;
        else if (item.token === 'hold') {
          assert(preset.pitched && previous && same(previous.end, cursor), `orphan/invalid hold at ${location}`);
          previous.end = end;
        } else {
          const midi = pitch(item.token);
          assert(preset.pitched ? midi !== null && midi >= preset.min && midi <= preset.max : item.token === 'hit', `invalid note for ${instrument} at ${location}`);
          previous = { track, instrument, midi, start: cursor, end };
          events.push(previous);
        }
        cursor = end;
      }
      assert(same(cursor, fraction((b - 1) * 4 + t)), `incorrect total at ${location}`);
    }
  }
  return { bpm, bars: bar, events, tracks: Object.fromEntries(tracks) };
}

function render(song, repetitions = 2) {
  const beatSeconds = 60 / song.bpm;
  const cycle = song.bars * 4 * beatSeconds;
  const samples = new Float32Array(Math.round((cycle * repetitions + 0.15) * rate));
  let seed = 1234567;
  const noise = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (let repetition = 0; repetition < repetitions; repetition++) for (const event of song.events) {
    const onset = repetition * cycle + value(event.start) * beatSeconds;
    const duration = value(subtract(event.end, event.start)) * beatSeconds;
    const pitched = instruments[event.instrument].pitched;
    const audible = pitched ? duration : event.instrument === 'kick' ? 0.16 : 0.055;
    const first = Math.round(onset * rate);
    const count = Math.round(audible * rate);
    const frequency = pitched ? 440 * 2 ** ((event.midi - 69) / 12) : 0;
    let previousNoise = 0;
    for (let i = 0; i < count && first + i < samples.length; i++) {
      const t = i / rate;
      let signal;
      if (pitched) {
        // Harmonic sums below Nyquist avoid the worst naive square-wave aliasing.
        let wave = 0;
        for (let h = 1; h <= 19 && h * frequency < rate * 0.45; h += 2) {
          const scale = event.instrument === 'chip_bass' ? ((h % 4 === 1 ? 1 : -1) / (h * h)) : 1 / h;
          wave += Math.sin(2 * Math.PI * frequency * h * t) * scale;
        }
        const envelope = Math.min(1, t / 0.004, Math.max(0, (audible - t) / 0.012));
        signal = wave * envelope * (event.instrument === 'chip_bass' ? 0.20 : 0.15);
      } else if (event.instrument === 'kick') {
        const phase = 2 * Math.PI * (48 * t + 110 * 0.025 * (1 - Math.exp(-t / 0.025)));
        signal = Math.sin(phase) * Math.exp(-t * 28) * Math.min(1, t / 0.002) * 0.38;
      } else {
        const n = noise();
        signal = (n - previousNoise) * 0.065 * Math.exp(-t * 80) * Math.min(1, t / 0.001);
        previousNoise = n;
      }
      samples[first + i] += signal;
    }
  }
  return samples;
}

function writeWav(filename, samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  let peak = 0, energy = 0;
  samples.forEach((sample, i) => {
    assert(Number.isFinite(sample) && Math.abs(sample) < 1, 'nonfinite sample or clipping');
    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  });
  assert(peak > 0.01, 'silent output');
  fs.writeFileSync(path.join(out, filename), buffer);
  return { file: filename, seconds: samples.length / rate, peak, rms: Math.sqrt(energy / samples.length) };
}

const tutorial = fs.readFileSync(path.join(root, 'LANGUAGE-TUTORIAL.md'), 'utf8');
const blocks = [...tutorial.matchAll(/```song (\w+)\r?\n([\s\S]*?)```/g)];
assert.equal(blocks.length, 4);
const songs = Object.fromEntries(blocks.map(([, id, source]) => [id, parse(source)]));
// Verify intended timing distinctions, sustained note merging, and validation failures.
const leads = id => songs[id].events.filter(e => e.track === 'lead');
assert(same(leads('straight')[1].start, fraction(1, 2)));
assert(same(leads('gentle')[1].start, fraction(3, 5)));
assert(same(leads('swing')[1].start, fraction(2, 3)));
const tiedG = leads('phrase').find(e => same(e.start, fraction(3)));
assert(same(tiedG.end, fraction(9, 2)));
const crossBeatD = leads('phrase').find(e => same(e.start, fraction(17, 3)));
assert(same(subtract(crossBeatD.end, crossBeatD.start), fraction(2, 3)));
assert.throws(() => parse(blocks[0][2].replace('[C5 E5]', '[hold E5]')), /hold/);
assert.throws(() => parse(blocks[0][2].replace('[C5 E5]', '[C5:0 E5]')), /invalid token/);
assert.throws(() => parse(blocks[0][2].replace('  kick [hit]', '')), /missing/);

fs.mkdirSync(out, { recursive: true });
const names = { straight: '01-straight.wav', gentle: '02-gentle-swing.wav', swing: '03-triplet-swing.wav', phrase: '04-mixed-phrase.wav' };
const audio = {};
const manifest = [];
for (const [id, song] of Object.entries(songs)) {
  audio[id] = render(song);
  manifest.push({ id, ...writeWav(names[id], audio[id]), bpm: song.bpm, bars: song.bars, repetitions: 2, tracks: song.tracks, events: song.events });
}
const gap = Math.round(rate * 0.45);
const sequence = ['straight', 'gentle', 'swing'];
const comparison = new Float32Array(sequence.reduce((sum, id) => sum + audio[id].length, 0) + gap * 2);
let offset = 0;
for (const id of sequence) { comparison.set(audio[id], offset); offset += audio[id].length + gap; }
manifest.push({ id: 'comparison', ...writeWav('00-timing-comparison.wav', comparison), order: sequence });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.map(({ events, ...summary }) => summary), null, 2));
console.log('Validated exact onset ratios, cross-beat/bar holds, malformed inputs, and nonclipping/non-silent PCM.');
