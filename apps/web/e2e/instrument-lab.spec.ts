import { test, expect } from "@playwright/test";

test("instrument lab lists production and candidate sounds", async ({ page }) => {
  await page.goto("/instrument-lab.html");
  await expect(page.getByRole("heading", { name: "Find the sound." })).toBeVisible();
  await expect(page.getByText("Pulse Lead", { exact: true })).toBeVisible();
  await expect(page.getByText("Chip Bass", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "♫ Phrase" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Candidate" }).click();
  await expect(page.getByText("Pulse Lead", { exact: true })).toBeVisible();
  await expect(page.getByText("Chip Bass", { exact: true })).toHaveCount(0);
});
