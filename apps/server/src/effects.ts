import { z } from "zod";

const EffectVoiceSchema = z
  .object({
    kind: z.enum(["tone", "noise"]),
    waveform: z.enum(["sine", "square", "triangle", "sawtooth"]).nullable(),
    startMs: z.number().int().min(0).max(10000),
    durationMs: z.number().int().min(20).max(5000),
    frequencyStart: z.number().min(20).max(12000).nullable(),
    frequencyEnd: z.number().min(20).max(12000).nullable(),
    gainStart: z.number().min(0).max(1),
    gainEnd: z.number().min(0).max(1),
    pan: z.number().min(-1).max(1),
    shaping: z.object({
      attackMs: z.number().min(1).max(1000),
      releaseMs: z.number().min(1).max(2000),
      filter: z.enum(["lowpass", "highpass", "bandpass"]),
      cutoffStart: z.number().min(40).max(16000),
      cutoffEnd: z.number().min(40).max(16000),
      resonance: z.number().min(0.1).max(8),
      vibratoHz: z.number().min(0).max(30),
      vibratoCents: z.number().min(0).max(200),
    }).strict().nullable(),
  })
  .strict();

export const EffectRecipeSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(240),
    durationMs: z.number().int().min(80).max(10000),
    voices: z.array(EffectVoiceSchema).min(1).max(16),
  })
  .strict();

export type EffectRecipe = z.infer<typeof EffectRecipeSchema>;

export function validateEffectRecipe(recipe: EffectRecipe) {
  for (const [index, voice] of recipe.voices.entries()) {
    if (voice.shaping && voice.shaping.attackMs + voice.shaping.releaseMs > voice.durationMs)
      throw new Error(`EFFECT_ENVELOPE_OUT_OF_BOUNDS: voice ${index} attack plus release exceeds durationMs`);
    if (voice.startMs + voice.durationMs > recipe.durationMs)
      throw new Error(
        `EFFECT_RECIPE_OUT_OF_BOUNDS: voice ${index} ends after durationMs`,
      );
    if (voice.kind === "tone" &&
      (!voice.waveform || voice.frequencyStart === null || voice.frequencyEnd === null))
      throw new Error(`EFFECT_RECIPE_TONE_FIELDS: voice ${index}`);
    if (voice.kind === "noise" &&
      (voice.waveform !== null || voice.frequencyStart !== null || voice.frequencyEnd !== null))
      throw new Error(`EFFECT_RECIPE_NOISE_FIELDS: voice ${index}`);
  }
  return recipe;
}

export const EFFECT_SYSTEM =
  "You are a sound-effect designer. Return exactly one compact JSON object matching the effect recipe contract. Do not return code, prose outside JSON, or unsupported audio instructions. Use only deterministic oscillator tones and seeded noise layers.";

export function effectPrompt(instruction: string) {
  return `REQUEST
${instruction}

RECIPE CONTRACT
Return one compact JSON object: name, description, durationMs, voices.
Use 1-16 layers, choosing only as many as the effect needs. All times are milliseconds.
Each voice ends within durationMs. Tone voices require waveform and frequencies.
Noise voices use null waveform and null frequencies. Every voice includes shaping (object or null).
gainStart is peak after attack; gainEnd is level before release. Release ends at silence.
Attack plus release must fit voice duration. Vibrato applies to tones only.
With shaping=null, gainStart fades directly to gainEnd. End basic voices at zero.
Keep most layered gains around 0.1-0.3. Use stereo placement sparingly.

DESIGN
Give the effect an attack, body and tail. Match the request; avoid generic buzzes.
Explosion: bright short noise crack, dark noise body, low sine drop, rumble tail.
Magic: staggered harmonically related tones, long releases, subtle vibrato, quiet delayed copies.
Horn: stable fundamental, quieter harmonics, gentle vibrato and release.
Laser: sharp pitch drop and resonant filter sweep.
Wind: filtered noise with slow attack and long release.
Use staggered notes for phrases, delayed quiet copies for echoes, and overlapping layers for texture.

COMPLETE OUTPUT EXAMPLE
{"name":"Soft laser","description":"A quick descending zap with a dark tail.","durationMs":400,"voices":[{"kind":"tone","waveform":"triangle","startMs":0,"durationMs":400,"frequencyStart":1800,"frequencyEnd":120,"gainStart":0.3,"gainEnd":0.08,"pan":0,"shaping":{"attackMs":3,"releaseMs":100,"filter":"lowpass","cutoffStart":8000,"cutoffEnd":600,"resonance":1,"vibratoHz":0,"vibratoCents":0}}]}`;
}

const tone = (
  waveform: "sine" | "square" | "triangle" | "sawtooth",
  startMs: number,
  durationMs: number,
  frequencyStart: number,
  frequencyEnd: number,
  gainStart: number,
  gainEnd = 0,
  pan = 0,
) => ({
  kind: "tone" as const,
  waveform,
  startMs,
  durationMs,
  frequencyStart,
  frequencyEnd,
  gainStart,
  gainEnd,
  pan,
  shaping: { attackMs: 3, releaseMs: Math.min(80, durationMs / 3), filter: "lowpass" as const, cutoffStart: 10000, cutoffEnd: 2500, resonance: 0.7, vibratoHz: 4, vibratoCents: 8 },
});
const noise = (startMs: number, durationMs: number, gainStart: number, gainEnd = 0, pan = 0) => ({
  kind: "noise" as const,
  waveform: null,
  startMs,
  durationMs,
  frequencyStart: null,
  frequencyEnd: null,
  gainStart,
  gainEnd,
  pan,
  shaping: { attackMs: 2, releaseMs: Math.min(120, durationMs / 3), filter: "lowpass" as const, cutoffStart: 7000, cutoffEnd: 250, resonance: 0.7, vibratoHz: 0, vibratoCents: 0 },
});

export function exampleEffectRecipe(instruction: string): EffectRecipe {
  const request = instruction.toLowerCase();
  if (request.includes("explosion") || request.includes("boom")) {
    return {
      name: "Pixel explosion",
      description: "A noisy burst with a falling low-end tail.",
      durationMs: 900,
      voices: [
        noise(0, 650, 0.85, 0, 0),
        tone("sawtooth", 0, 540, 180, 34, 0.42, 0),
        tone("square", 28, 240, 92, 28, 0.25, 0, -0.2),
      ],
    };
  }
  if (request.includes("horn") || request.includes("fanfare")) {
    return {
      name: "Arcade horn",
      description: "A brassy two-note signal with a quick release.",
      durationMs: 700,
      voices: [
        tone("sawtooth", 0, 360, 220, 250, 0.38, 0, -0.1),
        tone("square", 0, 360, 440, 500, 0.18, 0, 0.1),
        tone("sawtooth", 360, 280, 330, 290, 0.42, 0, 0),
      ],
    };
  }
  if (request.includes("jump") || request.includes("coin") || request.includes("power")) {
    return {
      name: "Power jump",
      description: "A fast rising chirp for a successful leap.",
      durationMs: 520,
      voices: [
        tone("square", 0, 260, 260, 620, 0.38, 0, -0.1),
        tone("triangle", 170, 350, 520, 1040, 0.35, 0, 0.12),
      ],
    };
  }
  return {
    name: "Magic sparkle",
    description: "A bright ascending twinkle with a soft tail.",
    durationMs: 760,
    voices: [
      tone("sine", 0, 190, 620, 900, 0.5),
      tone("triangle", 170, 230, 980, 1500, 0.42, 0, 0.2),
      tone("sine", 380, 260, 1540, 1180, 0.32, 0, -0.2),
    ],
  };
}
