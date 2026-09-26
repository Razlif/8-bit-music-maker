import { test, expect } from "@playwright/test";
test("manual notes, selections, mixer, export and reload without API credentials", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Untitled Loop" }),
  ).toBeVisible();
  await page.locator(".library-drawer > summary").click();
  page.once("dialog", (dialog) => dialog.accept("Manual regression"));
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manual regression" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Compose ↗" })).toBeDisabled();
  await page.locator(".library-drawer > summary").click();
  await expect(page.getByLabel("Piano roll")).not.toBeVisible();
  await page.locator(".note-drawer > summary").click();
  const roll = page.getByLabel("Piano roll");
  await roll.click({ position: { x: 110, y: 85 } });
  await expect(roll.locator("[data-id]:not([data-resize])")).toHaveCount(1);
  await expect(page.locator("p[role=status]")).toContainText("Saved");
  const note = roll.locator("[data-id]:not([data-resize])").first(),
    before = await note.getAttribute("x");
  const box = (await note.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y + 5, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => note.getAttribute("x")).not.toBe(before);
  await expect(page.locator("p[role=status]")).toContainText("Saved");
  const fader = page.getByRole("slider", { name: "Soft Lead volume" });
  await fader.focus();
  await fader.press("ArrowRight");
  await expect(page.locator(".fader output").first()).toHaveText("-11 dB");
  await page.getByRole("button", { name: "Play song", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop playback" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Solo Soft Lead", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mute Soft Lead", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop playback" }).click();
  await page
    .getByRole("button", { name: "Mute Soft Lead", exact: true })
    .click();
  await expect(page.locator("p[role=status]")).toContainText("Saved");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: /Manual regression/ }).click();
  await expect(page.getByLabel("Piano roll")).not.toBeVisible();
  await page.locator(".note-drawer > summary").click();
  await expect(
    page.getByLabel("Piano roll").locator("[data-id]:not([data-resize])"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("slider", { name: "Soft Lead volume" }),
  ).toHaveValue("-11");
  await page.setViewportSize({ width: 600, height: 900 });
  await page.screenshot({
    path: "test-results/studio-narrow.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("audio engine repeats, mixes live, and exports exact stereo PCM with mute/gain", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  const result = await page.evaluate(async () => {
    // Application modules, not substitute synthesizers, under a real browser audio context.
    const { Player, exportWav } = await import("/src/audio.ts");
    const Tone = await import("/node_modules/.vite/deps/tone.js");
    const response = await fetch("/api/songs"),
      list = await response.json();
    const song = await (
      await fetch("/api/songs/" + list[list.length - 1].id)
    ).json();
    song.music.bars = 1;
    song.music.bpm = 240;
    song.music.tracks[0].notes = [
      {
        id: "test-note",
        kind: "pitched",
        pitch: "C5",
        start: { n: 0, d: 1 },
        duration: { n: 1, d: 1 },
        velocity: 100,
      },
    ];
    let attacks = 0;
    const player = new Player();
    await player.play(song);
    const lead = (player as any).current.voices.get(song.music.tracks[0].id);
    const original = lead.trigger;
    lead.trigger = (...args: any[]) => {
      attacks++;
      return original(...args);
    };
    await new Promise((r) => setTimeout(r, 2350));
    const repeated = attacks;
    player.mix(song.music.tracks.map((t: any) => ({ ...t, volumeDb: -30 })));
    await new Promise((r) => setTimeout(r, 50));
    const gain = (player as any).current.voices.get(song.music.tracks[0].id)
      .gain.volume.value;
    const firstSession = (player as any).current;
    const candidate = structuredClone(song);
    candidate.music.bpm = 200;
    player.switchAtBar(candidate);
    await new Promise((r) => setTimeout(r, 1700));
    const switched = (player as any).current !== firstSession;
    player.stop();
    const stopped = attacks;
    await new Promise((r) => setTimeout(r, 1100));
    const afterStop = attacks;

    const measure = async (s: any) => {
      const buffer = await (await exportWav(s)).arrayBuffer(),
        v = new DataView(buffer);
      let peak = 0,
        energy = 0;
      for (let i = 44; i < buffer.byteLength; i += 2) {
        const x = v.getInt16(i, true);
        peak = Math.max(peak, Math.abs(x));
        energy += x * x;
      }
      return {
        bytes: buffer.byteLength,
        channels: v.getUint16(22, true),
        rate: v.getUint32(24, true),
        peak,
        energy,
      };
    };
    const normal = await measure(song);
    song.music.tracks[0].volumeDb = -24;
    const quiet = await measure(song);
    song.music.tracks[0].muted = true;
    const muted = await measure(song);
    song.music.tracks[0].muted = false;
    const presets = [];
    for (const instrumentId of [
      "bright_lead",
      "soft_lead",
      "chip_bass",
      "pluck",
      "kick",
      "snare",
      "closed_hat",
    ]) {
      const sample = structuredClone(song);
      sample.music.tracks = [sample.music.tracks[0]];
      sample.music.tracks[0].instrumentId = instrumentId;
      sample.music.tracks[0].volumeDb = -12;
      sample.music.tracks[0].notes = [
        {
          id: "preset",
          start: { n: 0, d: 1 },
          duration: { n: 1, d: 1 },
          velocity: 100,
          ...(["kick", "snare", "closed_hat"].includes(instrumentId)
            ? { kind: "hit" }
            : {
                kind: "pitched",
                pitch: instrumentId === "chip_bass" ? "C3" : "C5",
              }),
        },
      ];
      presets.push({ instrumentId, ...(await measure(sample)) });
    }
    return {
      repeated,
      gain,
      switched,
      stopped,
      afterStop,
      normal,
      quiet,
      muted,
      presets,
    };
  });
  console.log(JSON.stringify(result));
  expect(result.repeated).toBeGreaterThanOrEqual(3);
  expect(result.switched).toBe(true);
  for (const preset of result.presets)
    expect(preset.peak, preset.instrumentId).toBeGreaterThan(0);
  expect(result.gain).toBeCloseTo(-30, 0);
  expect(result.afterStop).toBe(result.stopped);
  expect(result.normal.bytes).toBe(44 + 44100 * 4);
  expect(result.normal.channels).toBe(2);
  expect(result.normal.rate).toBe(44100);
  expect(result.normal.peak).toBeGreaterThan(0);
  expect(result.normal.peak).toBeLessThan(32767);
  expect(result.quiet.energy).toBeLessThan(result.normal.energy / 5);
  expect(result.muted.peak).toBe(0);
});
