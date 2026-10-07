import Fastify from "fastify";
import cors from "@fastify/cors";
import OpenAI, { toFile } from "openai";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import {
  applyCommand,
  validateCandidate,
  trimUpdateToSelection,
  musicalDiff,
  FractionSchema,
  type Candidate,
} from "@eight-bit/core";
import { Library, type SaveResult } from "./library.js";
import { createModelAdapter, runAgent, type ModelAdapter } from "./agent.js";
import { aiConfigured, getConfig, type Config } from "./config.js";
import {
  EffectRecipeSchema,
  exampleEffectRecipe,
  validateEffectRecipe,
} from "./effects.js";

const SelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("song") }).strict(),
  z
    .object({ kind: z.literal("tracks"), trackIds: z.array(z.string()).min(1) })
    .strict(),
  z
    .object({ kind: z.literal("notes"), noteIds: z.array(z.string()).min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("regions"),
      regions: z
        .array(
          z
            .object({
              start: FractionSchema,
              end: FractionSchema,
              trackIds: z.array(z.string()).min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);
const RequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(4000),
    selection: SelectionSchema,
    rhythmFormat: z.enum(["json", "notation"]).default("json"),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
type Run = {
  id: string;
  songId: string;
  status: string;
  events: any[];
  sequence: number;
  traceEvents: any[];
  traceSequence: number;
  error: { code: string; message: string } | null;
  controller: AbortController;
  result?: SaveResult;
  message?: string;
  startedAt: string;
  deadlineAt: string;
  stage: string;
  pending: Promise<void>;
  baseRevision: number;
  endedAt?: string;
  modelStream?: unknown;
  passage?: unknown;
};
const terminal = (status: string) =>
  [
    "failed",
    "cancelled",
    "completed",
    "clarification_required",
  ].includes(status);
function errorInfo(e: unknown) {
  const status = (e as any)?.status;
  if (status)
    return {
      code: "PROVIDER_ERROR",
      message:
        status === 401
          ? "AI provider authentication failed. Check the selected provider API key or subscription login."
          : status === 429
            ? "AI provider rate limit or quota exceeded."
            : "AI provider request failed (" + status + ").",
    };
  const message = e instanceof Error ? e.message : "Unexpected error";
  return {
    code: e instanceof z.ZodError ? "INVALID_REQUEST" : message.split(":")[0],
    message,
  };
}
export async function createApp(
  config: Config = getConfig(),
  adapter?: ModelAdapter,
  extraOrigins: string[] = [],
) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 }),
    library = new Library(config.songsDir),
    runs = new Map<string, Run>();
  const effectAdapter =
    adapter?.effect ? adapter : aiConfigured(config) ? createModelAdapter() : undefined;
  const transcriptionClient = config.openaiKey
    ? new OpenAI({
        apiKey: config.openaiKey,
        maxRetries: 0,
        timeout: config.runTimeoutMs,
      })
    : undefined;
  await library.init();
  const origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:" + config.port,
    "http://localhost:" + config.port,
    ...extraOrigins,
  ];
  await app.register(cors, { origin: origins });
  app.addHook("onRequest", async (req, reply) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const host = req.headers.host?.split(":")[0];
      if (
        !host ||
        !["localhost", "127.0.0.1"].includes(host) ||
        (req.headers.origin && !origins.includes(req.headers.origin))
      )
        return reply.code(403).send({
          code: "FORBIDDEN_ORIGIN",
          message: "Only the local studio may change songs.",
        });
    }
  });
  app.setErrorHandler((e, _req, reply) => {
    const info = errorInfo(e);
    const status = /STALE|BUSY|HISTORY_PENDING|EXTERNAL_EDIT/.test(info.code)
      ? 409
      : /NOT_FOUND|ENOENT/.test(info.code)
        ? 404
        : 422;
    reply.code(status).send(info);
  });
  app.addHook("onClose", async () => {
    for (const run of runs.values()) run.controller.abort();
    await Promise.allSettled([...runs.values()].map((r) => r.pending));
    await library.close();
  });
  app.get("/api/health", async () => ({
    ok: true,
    agent: aiConfigured(config) || !!adapter,
  }));
  app.post("/api/effects/recipe", async (req) => {
    const { instruction } = z
      .object({ instruction: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    if (!effectAdapter?.effect)
      return {
        recipe: validateEffectRecipe(exampleEffectRecipe(instruction)),
        source: "example",
      };
    const controller = new AbortController();
    // `close` fires when a normal incoming request stream finishes on Node,
    // which would cancel every model call immediately after the body parses.
    // `aborted` is the client-disconnect signal we actually want here.
    const onAborted = () => controller.abort();
    req.raw.once("aborted", onAborted);
    try {
      const recipe = validateEffectRecipe(
        EffectRecipeSchema.parse(
          await effectAdapter.effect(instruction, controller.signal),
        ),
      );
      return { recipe, source: "ai" };
    } finally {
      req.raw.off("aborted", onAborted);
    }
  });
  app.post("/api/transcribe", async (req, reply) => {
    const { audioBase64, mimeType } = z
      .object({
        audioBase64: z.string().min(1).max(2_000_000),
        mimeType: z.string().min(1).max(80),
      })
      .strict()
      .parse(req.body);
    if (!transcriptionClient)
      return reply.code(422).send({
        code: "MISSING_API_KEY",
        message: "Add OPENAI_API_KEY to enable microphone transcription.",
      });
    const extension = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mp4")
        ? "mp4"
        : "webm";
    const file = await toFile(
      Buffer.from(audioBase64, "base64"),
      `dictation.${extension}`,
      { type: mimeType },
    );
    const result = await transcriptionClient.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "json",
    });
    return { text: result.text };
  });
  app.get("/api/songs", async () => library.list());
  app.post("/api/songs", async (req) =>
    library.create(
      z
        .object({ title: z.string().max(120).optional() })
        .strict()
        .parse(req.body ?? {}).title,
    ),
  );
  app.get("/api/songs/:id", async (req) =>
    library.load((req.params as any).id),
  );
  app.post("/api/songs/:id/duplicate", async (req) =>
    library.duplicate((req.params as any).id),
  );
  app.post("/api/songs/:id/commands", async (req) => {
    const { expectedRevision, ...command } = req.body as Record<
      string,
      unknown
    >;
    return library.update(
      (req.params as any).id,
      (s) => applyCommand(s, command),
      z.number().int().nonnegative().parse(expectedRevision),
    );
  });
  const publicRun = (run: Run) => ({
    id: run.id,
    songId: run.songId,
    status: run.status,
    error: run.error,
    message: run.message,
    startedAt: run.startedAt,
    deadlineAt: run.deadlineAt,
    stage: run.stage,
    endedAt: run.endedAt,
    modelStream: run.modelStream,
    passage: run.passage,
  });
  const emit = (run: Run, type: string, payload?: unknown) => {
    if (type === "passage") run.passage = payload;
    if (type === "model_stream" || type === "model_started")
      run.modelStream = payload;
    if (terminal(run.status) && !run.endedAt)
      run.endedAt = new Date().toISOString();
    run.events.push({
      eventId: ++run.sequence,
      runId: run.id,
      songId: run.songId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    });
    if (run.events.length > 256) run.events.shift();
    if (!["model_usage", "model_started", "model_stream"].includes(type))
      run.stage = type;
  };
  const recordTrace = (run: Run, type: string, payload: unknown) => {
    run.traceEvents.push({
      traceId: ++run.traceSequence,
      runId: run.id,
      songId: run.songId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    });
    // Keep detailed prompts/responses available for this local demo without
    // allowing an unusually long run to grow memory without bound.
    if (run.traceEvents.length > 4096) run.traceEvents.shift();
  };
  app.get("/api/songs/:id/activity", async (req) => {
    const run = [...runs.values()].find(
      (r) =>
        r.songId === (req.params as any).id &&
        r.status === "running",
    );
    return run ? publicRun(run) : null;
  });
  app.post("/api/songs/:id/runs", async (req, reply) => {
    const id = (req.params as any).id,
      body = RequestSchema.parse(req.body),
      song = await library.load(id);
    if (song.revision !== body.expectedRevision)
      throw new Error("STALE_REVISION");
    if (
      [...runs.values()].some(
        (r) =>
          r.songId === id && r.status === "running",
      )
    )
      throw new Error("RUN_BUSY");
    if (!aiConfigured(config) && !adapter)
      return reply.code(422).send({
        code: "MISSING_API_KEY",
        message: "Add the selected provider API key (or set AI_PROVIDER=claude-subscription) in the root .env and restart the server.",
      });
    const run: Run = {
      id: crypto.randomUUID(),
      songId: id,
      status: "running",
      events: [],
      sequence: 0,
      traceEvents: [],
      traceSequence: 0,
      error: null,
      controller: new AbortController(),
      startedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + config.runTimeoutMs).toISOString(),
      stage: "starting",
      pending: Promise.resolve(),
      baseRevision: song.revision,
    };
    // Keep only a small amount of live-session state for reconnecting clients.
    const finished = [...runs.values()].filter((entry) => terminal(entry.status));
    for (const entry of finished.slice(0, Math.max(0, finished.length - 19))) runs.delete(entry.id);
    runs.set(run.id, run);
    const timer = setTimeout(() => {
      if (run.status === "running") {
        run.controller.abort();
        run.status = "failed";
        run.error = {
          code: "RUN_TIMEOUT",
          message: "The request exceeded its configured deadline.",
        };
        emit(run, "failed", run.error);
      }
    }, config.runTimeoutMs);
    run.pending = (async () => {
      try {
        const result = await runAgent(
          {
            song,
            instruction: body.instruction,
            selection: body.selection,
            rhythmFormat: body.rhythmFormat,
            signal: run.controller.signal,
            progress: (type, payload) => {
              if (run.status === "running") emit(run, type, payload);
            },
            trace: async (type, payload) => recordTrace(run, type, payload),
          },
          adapter,
        );
        if (run.controller.signal.aborted || run.status !== "running") return;
        run.result = await library.update(
          run.songId,
          (base) => {
            validateCandidate(
              base,
              result.scope,
              result.candidate as Candidate,
              result.next,
            );
            const applied = trimUpdateToSelection(base, result.next, body.selection);
            recordTrace(run, "selection_applied", {
              selection: body.selection,
              generatedDiff: musicalDiff(base, result.next),
              appliedDiff: musicalDiff(base, applied),
            });
            return applied;
          },
          song.revision,
        );
        run.status = "completed";
        emit(run, "completed", {
          revision: run.result.song.revision,
          diff: musicalDiff(song, run.result.song),
        });
      } catch (e) {
        if (run.status === "running") {
          run.status = "failed";
          run.error = errorInfo(e);
          emit(run, "failed", run.error);
        }
      } finally {
        clearTimeout(timer);
      }
    })();
    return { runId: run.id };
  });
  app.get("/api/runs/:id", async (req, reply) => {
    const run = runs.get((req.params as any).id);
    return run
      ? publicRun(run)
      : reply.code(404).send({
          code: "NOT_FOUND",
          message: "Run unavailable; the server may have restarted.",
        });
  });
  app.get("/api/runs/:id/trace", async (req, reply) => {
    const run = runs.get((req.params as any).id);
    return run
      ? { run: publicRun(run), events: run.traceEvents }
      : reply.code(404).send({
          code: "NOT_FOUND",
          message: "Trace unavailable; the server may have restarted or the run was evicted.",
        });
  });
  app.get("/api/songs/:id/runs/latest/trace", async (req, reply) => {
    const run = [...runs.values()]
      .filter((entry) => entry.songId === (req.params as any).id)
      .at(-1);
    return run
      ? { run: publicRun(run), events: run.traceEvents }
      : reply.code(404).send({
          code: "NOT_FOUND",
          message: "No retained run trace exists for this song.",
        });
  });
  app.get("/api/runs/:id/events", async (req, reply) => {
    const run = runs.get((req.params as any).id);
    if (!run) return reply.code(404).send({ code: "NOT_FOUND" });
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    let sent = Number(req.headers["last-event-id"] ?? 0);
    const send = () => {
      if (response.destroyed) return;
      if (run.events.length && sent < run.events[0].eventId - 1) {
        response.write(
          "data: " +
            JSON.stringify({
              type: "snapshot",
              runId: run.id,
              songId: run.songId,
              payload: publicRun(run),
            }) +
            "\n\n",
        );
      }
      for (const event of run.events.filter((e) => e.eventId > sent)) {
        response.write(
          "id: " + event.eventId + "\ndata: " + JSON.stringify(event) + "\n\n",
        );
        sent = event.eventId;
      }
      if (terminal(run.status)) response.end();
    };
    const timer = setInterval(send, 100),
      heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    response.on("close", () => {
      clearInterval(timer);
      clearInterval(heartbeat);
    });
    send();
  });
  app.post("/api/runs/:id/cancel", async (req, reply) => {
    const run = runs.get((req.params as any).id);
    if (!run) return reply.code(404).send({ code: "NOT_FOUND" });
    if (run.status === "running") {
      run.status = "cancelled";
      run.controller.abort();
      emit(run, "cancelled");
    }
    return publicRun(run);
  });
  const webRoot = path.join(config.rootDir, "apps/web/dist");
  if (fs.existsSync(webRoot)) {
    // Serve only the build entry and flat hashed assets, never arbitrary paths.
    app.get("/", async (_req, reply) =>
      reply
        .type("text/html")
        .send(fs.createReadStream(path.join(webRoot, "index.html"))),
    );
    app.get("/assets/:filename", async (req, reply) => {
      const name = (req.params as { filename: string }).filename;
      if (!/^[A-Za-z0-9_-]+\.(js|css|woff2|png|svg)$/.test(name))
        return reply.code(404).send();
      const file = path.join(webRoot, "assets", name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return reply.code(404).send();
      const types: Record<string, string> = {
        js: "text/javascript",
        css: "text/css",
        woff2: "font/woff2",
        png: "image/png",
        svg: "image/svg+xml",
      };
      return reply
        .type(types[name.split(".").pop()!])
        .send(fs.createReadStream(file));
    });
  }
  return { app, library };
}
