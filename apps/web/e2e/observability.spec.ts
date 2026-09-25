import { test, expect } from "@playwright/test";

test("shows a historical failure and readable prompts without confusing editor status", async ({
  page,
}) => {
  const id = "recorded-run";
  const summary = {
    id,
    status: "failed",
    stage: "failed",
    startedAt: "2026-09-21T10:00:00Z",
    endedAt: "2026-09-21T10:03:00Z",
  };
  await page.route("**/api/songs/*/runs", (r) =>
    r.fulfill({ json: [summary] }),
  );
  await page.route("**/api/songs/*/runs/recorded-run/trace", (r) =>
    r.fulfill({
      json: {
        ...summary,
        endedAt: "2026-09-21T10:03:00Z",
        error: { code: "RUN_TIMEOUT", message: "Deadline reached" },
        events: [{ type: "repairing", payload: { attempt: 1 } }],
        trace: [
          {
            type: "model_request",
            timestamp: summary.startedAt,
            payload: {
              purpose: "music_candidate",
              request: {
                messages: [
                  {
                    role: "user",
                    content: "EDIT_TASK\nCompose a funky bass line",
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  await page.locator(".activity-drawer > summary").click();
  const monitor = page.getByRole("region", { name: "AI run monitor" });
  await expect(monitor).toContainText("failed · failed · 180s elapsed");
  await monitor
    .getByText("Inspect prompts and run trace", { exact: true })
    .click();
  await monitor.getByText(/model_request · music_candidate/).click();
  await expect(
    monitor.getByText("EDIT_TASK\nCompose a funky bass line", { exact: true }),
  ).toBeVisible();
  await expect(
    monitor.getByRole("link", { name: "Open full trace JSON" }),
  ).toHaveAttribute("href", /recorded-run\/trace$/);
  await expect(monitor).toContainText("RUN_TIMEOUT");
});

test("receives live reasoning summaries over SSE before a proposal exists", async ({
  page,
}) => {
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { ok: true, agent: true } }),
  );
  await page.goto("/");
  await page.locator(".library-drawer > summary").click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/songs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "＋ New song", exact: true }).click();
  const song = await (await created).json();
  const run = {
    id: "stream-run",
    songId: song.id,
    status: "running",
    stage: "composing",
    startedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 180000).toISOString(),
  };
  await page.route("**/api/songs/*/runs", (r) =>
    r.fulfill({
      json: r.request().method() === "POST" ? { runId: run.id } : [run],
    }),
  );
  await page.route("**/api/runs/stream-run", (r) => r.fulfill({ json: run }));
  await page.route("**/api/runs/stream-run/events", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({
          type: "model_stream",
          songId: song.id,
          runId: run.id,
          payload: {
            callId: "call1",
            purpose: "music_candidate",
            summary: "I am placing the bass between the kick beats.",
            outputPreview: '{"rowReplacements":',
            outputCharacters: 19,
          },
        }) +
        "\n\n",
    }),
  );
  await page.getByLabel("Composer request").fill("Simple groove");
  await page.getByRole("button", { name: "Compose ↗" }).click();
  await page.locator(".activity-drawer > summary").click();
  const monitor = page.getByRole("region", { name: "AI run monitor" });
  await expect(monitor).toContainText(
    "I am placing the bass between the kick beats.",
  );
  await expect(monitor).toContainText("19 output characters received");
  await expect(
    page.getByRole("button", { name: "Cancel request", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept & save" })).toHaveCount(
    0,
  );
});
