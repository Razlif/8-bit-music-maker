import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { exampleEffectRecipe } from "../src/effects.js";
import { fake } from "./agent-fixtures.js";

it("returns a safe deterministic example recipe when no model key is configured", async () => {
  const songsDir = await fs.mkdtemp(path.join(os.tmpdir(), "chip-effects-"));
  const instance = await createApp({
    rootDir: path.resolve("../.."),
    songsDir,
    port: 3001,
    runTimeoutMs: 15000,
    composerModel: "test",
    orchestratorModel: "test",
  });
  try {
    const response = await instance.app.inject({
      method: "POST",
      url: "/api/effects/recipe",
      payload: { instruction: "magic sparkle" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("example");
    expect(body.recipe.name).toBe("Magic sparkle");
    expect(body.recipe.voices.length).toBeGreaterThan(0);
    expect(body.recipe.voices.every((voice: any) =>
      voice.startMs + voice.durationMs <= body.recipe.durationMs,
    )).toBe(true);
  } finally {
    await instance.app.close();
    await fs.rm(songsDir, { recursive: true, force: true });
  }
});

it("does not abort a normal AI recipe request when the request body closes", async () => {
  const songsDir = await fs.mkdtemp(path.join(os.tmpdir(), "chip-effects-ai-"));
  const instance = await createApp(
    {
      rootDir: path.resolve("../.."),
      songsDir,
      port: 3001,
      runTimeoutMs: 15000,
      composerModel: "test",
      orchestratorModel: "test",
    },
    {
      ...fake,
      effect: async (_input, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        if (signal.aborted) throw new Error("CANCELLED");
        return exampleEffectRecipe("magic sparkle");
      },
    },
  );
  try {
    const response = await instance.app.inject({
      method: "POST",
      url: "/api/effects/recipe",
      payload: { instruction: "make a sparkle" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe("ai");
  } finally {
    await instance.app.close();
    await fs.rm(songsDir, { recursive: true, force: true });
  }
});
