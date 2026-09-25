import { test, expect } from '@playwright/test';

test('quiet studio keeps tools folded and selection does not open note editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create first song' }).click();
  await expect(page.getByRole('heading', { name: 'Untitled Loop' })).toBeVisible();
  await expect(page.getByLabel('Piano roll')).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'AI run monitor' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '＋ New song', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Bright Lead', exact: true }).click();
  await expect(page.getByLabel('Piano roll')).not.toBeVisible();
  const editor = await page.locator('.editor').boundingBox();
  const composer = await page.locator('.agent').boundingBox();
  expect(composer!.y).toBeGreaterThan(editor!.y + editor!.height);
  expect(Math.abs(composer!.width - editor!.width)).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/retro-desktop.png', fullPage: true });
  await page.locator('.note-drawer > summary').click();
  await expect(page.getByLabel('Piano roll')).toBeVisible();
  await page.locator('.note-drawer > summary').click();
  await expect(page.getByLabel('Piano roll')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/retro-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
