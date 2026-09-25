import { test, expect } from "@playwright/test";

test("bar count saves on selection and survives reopening", async ({ page }) => {
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  const created = page.waitForResponse(r => r.url().endsWith("/api/songs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  const song = await (await created).json();
  await page.locator(".song-settings > summary").click();
  const saved = page.waitForResponse(r => r.url().endsWith("/commands"));
  await page.getByLabel("Bars", { exact: true }).selectOption("8");
  const result = await (await saved).json();
  expect(result.song.music.bars).toBe(8);
  await expect(page.getByLabel("Bars", { exact: true })).toHaveValue("8");
  await page.reload();
  const persisted = await page.request.get(`/api/songs/${song.id}`);
  expect((await persisted.json()).music.bars).toBe(8);
});
