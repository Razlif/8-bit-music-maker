import fs from "node:fs/promises";
import path from "node:path";
import { newSong, frac, type Selection } from "@eight-bit/core";
import { runAgent } from "./agent.js";
import { getConfig } from "./config.js";
const config = getConfig();
if (!config.openaiKey) {
  console.log(
    "LIVE_EVAL_PENDING: add OPENAI_API_KEY to the root .env. No model calls made.",
  );
  process.exit(0);
}
const out = path.join(
  config.rootDir,
  ".local",
  "evals",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await fs.mkdir(out, { recursive: true });
const cases = [
  {
    name: "cheerful",
    instruction: "Create a cheerful four-bar four-track loop in C major.",
    selection: { kind: "song" },
  },
  {
    name: "swing",
    instruction: "Create a bass and percussion groove with clear 2:1 swing.",
    selection: {
      kind: "tracks",
      trackIds: ["track-bass", "track-kick", "track-hat"],
    },
  },
  {
    name: "bass-only",
    instruction:
      "Rewrite the bass in this selection. Keep everything else unchanged.",
    selection: {
      kind: "regions",
      regions: [{ start: frac(4), end: frac(12), trackIds: ["track-bass"] }],
    },
  },
  {
    name: "pitch-only",
    instruction:
      "Change the selected note to E5, preserving its timing and every neighbor.",
    selection: { kind: "notes", noteIds: ["fixture-lead"] },
  },
  {
    name: "add-and-edit",
    instruction:
      "Add one answering lead using new_track, and rewrite the permitted bass bar. Preserve other tracks.",
    selection: {
      kind: "regions",
      regions: [{ start: frac(4), end: frac(8), trackIds: ["track-bass"] }],
    },
  },
];
const results = [];
for (const c of cases)
  for (let repeat = 0; repeat < 2; repeat++) {
    const song = newSong(crypto.randomUUID());
    song.music.tracks[0].notes = [
      {
        id: "fixture-lead",
        kind: "pitched",
        pitch: "C5",
        start: frac(0),
        duration: frac(1),
        velocity: 100,
      },
    ];
    song.music.tracks[1].notes = [
      {
        id: "fixture-bass",
        kind: "pitched",
        pitch: "C3",
        start: frac(4),
        duration: frac(1),
        velocity: 100,
      },
    ];
    const events: unknown[] = [],
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), config.runTimeoutMs),
      start = Date.now();
    try {
      const r = await runAgent({
        song,
        instruction: c.instruction,
        selection: c.selection as Selection,
        signal: controller.signal,
        progress: (type, payload) => events.push({ type, payload }),
      });
      if (!r.next) throw new Error("No candidate");
      const filename = c.name + "-" + (repeat + 1) + ".json";
      await fs.writeFile(
        path.join(out, filename),
        JSON.stringify(r.next, null, 2),
      );
      results.push({
        case: c.name,
        repeat,
        valid: true,
        elapsedMs: Date.now() - start,
        repairs: events.filter((e: any) => e.type === "repairing").length,
        events,
        output: filename,
      });
    } catch (e) {
      results.push({
        case: c.name,
        repeat,
        valid: false,
        elapsedMs: Date.now() - start,
        error: (e as any)?.status
          ? "Provider HTTP " + (e as any).status
          : e instanceof Error
            ? e.message
            : "Failed",
        events,
      });
    } finally {
      clearTimeout(timer);
    }
    console.log(
      c.name,
      repeat + 1,
      results[results.length - 1].valid ? "valid" : "failed",
    );
  }
await fs.writeFile(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      composerModel: config.composerModel,
      orchestratorModel: config.orchestratorModel,
      results,
      listening:
        "PENDING: audition the generated outputs; validity is not musical quality.",
    },
    null,
    2,
  ),
);
const passed = results.filter((r) => r.valid).length;
console.log(passed + "/10 valid; results: " + out);
if (passed < 9) process.exitCode = 1;
