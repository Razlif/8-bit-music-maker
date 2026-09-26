import { expect, test } from "@playwright/test";

test("track name and instrument edit independently and song title persists", async ({ page }) => {
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  await page.getByRole("button", { name: "Rename Song title", exact: true }).click();
  await page.getByRole("textbox", { name: "Song title", exact: true }).fill("Moonlight");
  await page.getByRole("textbox", { name: "Song title", exact: true }).press("Enter");
  await expect(page.locator("h1")).toHaveText("Moonlight");
  await page.getByRole("button", { name: "Instrument for Lead", exact: true }).click();
  await page.locator(".instrument-option").filter({ hasText: "Electric Piano" }).click();
  await expect(page.getByRole("button", { name: "Instrument for Lead", exact: true })).toContainText("Electric Piano");
  await page.getByRole("button", { name: "Rename track Lead", exact: true }).click();
  await page.getByRole("textbox", { name: "track Lead", exact: true }).fill("Theme");
  await page.getByRole("textbox", { name: "track Lead", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Instrument for Theme", exact: true })).toContainText("Electric Piano");
  await page.reload();
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: "Load Moonlight", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Moonlight");
  await expect(page.getByRole("button", { name: "Instrument for Theme", exact: true })).toContainText("Electric Piano");
});

test("effects maker generates a safe example recipe", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Effects Maker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Effect Maker", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Effect request")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start dictation" })).toBeVisible();
  await page.getByRole("button", { name: "Explosion", exact: true }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pixel explosion" })).toBeVisible();
  await expect(page.getByText("LOCAL EXAMPLE")).toBeVisible();
  await expect(page.getByRole("button", { name: /Play/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export WAV", exact: true })).toBeVisible();
  await expect(page.locator(".topbar-companion .companion")).toBeVisible();
  // Measure the real output: a button changing its label cannot catch sources
  // accidentally scheduled in the past on the second play.
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => /\/tone\.js\?/.test(name));
    if (!url) throw new Error("App Tone module not found");
    const Tone = await import(/* @vite-ignore */ url);
    const meter = new Tone.Meter({ normalRange: true });
    Tone.getDestination().connect(meter);
    (window as any).__effectMeter = meter;
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "▶ Play", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__effectMeter.getValue()), { timeout: 2000 }).toBeGreaterThan(0.001);
    await expect(page.getByRole("button", { name: "▶ Play", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__effectMeter.getValue())).toBeGreaterThan(0.001);
  await page.evaluate(() => (window as any).__effectMeter.dispose());
});
