import { test, expect } from "@playwright/test";

test("does not expose the diagnostic drawer in the editor", async ({
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
  await expect(page.getByText("Activity & traces", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "AI run monitor" })).toHaveCount(0);
  await expect(page.locator(".agent-monitor-hidden")).toHaveCount(1);
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
  await expect(page.locator(".sprite-speech")).toContainText(
    "I am placing the bass between the kick beats.",
  );
  await expect(
    page.getByRole("button", { name: "Cancel request", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept & save" })).toHaveCount(
    0,
  );
});
