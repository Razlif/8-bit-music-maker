import { test, expect } from "@playwright/test";

test("refresh only lists demos; New creates once and Load preserves music", async ({ page, request }) => {
  const before = (await (await request.get("/api/songs")).json()).length;
  const creates: string[] = [];
  page.on("request", req => { if (req.method() === "POST" && req.url().endsWith("/api/songs")) creates.push(req.url()); });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Demo library" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "＋ New demo", exact: true })).toBeVisible();
  expect(creates).toHaveLength(0);
  expect((await (await request.get("/api/songs")).json()).length).toBe(before);
  await page.getByRole("button", { name: "＋ New demo", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(/Untitled \d+/);
  const title = (await page.locator("h1").textContent())!;
  await page.getByRole("combobox", { name: "Bars", exact: true }).selectOption("8");
  await expect(page.getByRole("combobox", { name: "Bars", exact: true })).toHaveValue("8");
  await expect(page.getByRole("button", { name: "Rename Song title", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("region", { name: "Demo library" })).toBeVisible();
  expect(creates).toHaveLength(1);
  await page.locator(".demo-cards button").filter({ hasText: title }).click();
  await expect(page.getByRole("combobox", { name: "Bars", exact: true })).toHaveValue("8");
  expect((await (await request.get("/api/songs")).json()).length).toBe(before + 1);
});
