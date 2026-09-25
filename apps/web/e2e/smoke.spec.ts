import { test, expect } from "@playwright/test";
test("studio shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("CHIP//STUDIO · LOCAL")).toBeVisible();
  await page.locator(".library-drawer > summary").click();
  await expect(page.getByRole("button", { name: /new song/i })).toBeVisible();
});
