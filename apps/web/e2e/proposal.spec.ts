import { test, expect } from "@playwright/test";
test("preview fetch uses the correct URL and discard does not change accepted music", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { ok: true, agent: true } }),
  );
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/songs') && r.request().method() === 'POST');
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Untitled Loop" }),
  ).toBeVisible();
  const song = await (await created).json(),
    next = structuredClone(song);
  next.music.tracks[0].notes = [
    {
      id: "candidate-note",
      kind: "pitched",
      pitch: "C5",
      start: { n: 0, d: 1 },
      duration: { n: 1, d: 1 },
      velocity: 100,
    },
  ];
  const proposal = {
    id: "browser-proposal",
    baseRevision: song.revision,
    next,
    diff: { inserted: ["candidate-note"], removed: [], changed: [] },
  };
  await page.route("**/api/songs/*/runs", (r) =>
    r.fulfill({ json: { runId: "browser-run" } }),
  );
  await page.route("**/api/runs/browser-run/events", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({
          type: "preview_ready",
          songId: song.id,
          runId: "browser-run",
        }) +
        "\n\n",
    }),
  );
  await page.route("**/api/runs/browser-run", (r) =>
    r.fulfill({
      json: {
        id: "browser-run",
        songId: song.id,
        status: "preview_ready",
        proposal,
      },
    }),
  );
  await page.route("**/api/proposals/browser-proposal/discard", (r) =>
    r.fulfill({ json: { ok: true } }),
  );
  await page.getByLabel("Composer request").fill("Write a cheerful loop");
  await page.getByRole("button", { name: "Compose ↗" }).click();
  await expect(
    page.getByRole("button", { name: "Accept & save" }),
  ).toBeVisible();
  expect(requests.some((url) => url.includes("/api/api/"))).toBe(false);
  await page.getByRole("button", { name: "B · Candidate" }).click();
  await expect(
    page.getByLabel("Piano roll").locator("[data-id]:not([data-resize])"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByLabel("Piano roll").locator("[data-id]:not([data-resize])"),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/songs/" + song.id)).json()).revision,
  ).toBe(song.revision);
});
