import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import {
  applyCommand,
  validateCandidate,
  musicalDiff,
  FractionSchema,
  type Candidate,
} from "@eight-bit/core";
import { Library, type SaveResult } from "./library.js";
import { runAgent, type ModelAdapter } from "./agent.js";
import { getConfig, type Config } from "./config.js";

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
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
type Run = {
  id: string;
  songId: string;
  status: string;
  events: any[];
  sequence: number;
  error: { code: string; message: string } | null;
  controller: AbortController;
  result?: SaveResult;
  message?: string;
  startedAt: string;
  deadlineAt: string;
  stage: string;
  trace: unknown[];
  pending: Promise<void>;
  traceError?: string;
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
          ? "OpenAI authentication failed. Check the server API key."
          : status === 429
            ? "OpenAI rate limit or quota exceeded."
            : "OpenAI request failed (" + status + ").",
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
  let closing = false;
  await library.init();
  try {
    await library.recover();
  } catch (e) {
    await library.close();
    throw e;
  }
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
    closing = true;
    for (const run of runs.values()) run.controller.abort();
    await Promise.allSettled([...runs.values()].map((r) => r.pending));
    await library.close();
  });
  app.get("/api/health", async () => ({
    ok: true,
    agent: !!config.openaiKey || !!adapter,
  }));
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
  app.get("/api/songs/:id/history", async (req) =>
    library.history((req.params as any).id),
  );
  app.post("/api/songs/:id/history/retry", async (req) =>
    library.retryHistory((req.params as any).id),
  );
  app.post("/api/songs/:id/restore", async (req) => {
    const b = z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        expectedRevision: z.number().int(),
      })
      .strict()
      .parse(req.body);
    return library.restore(
      (req.params as any).id,
      b.commit,
      b.expectedRevision,
    );
  });
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
    traceError: run.traceError,
    endedAt: run.endedAt,
    modelStream: run.modelStream,
    passage: run.passage,
  });
  const persist = (run: Run) => {
    // Capture now, serialize writes in order, and atomically replace the last checkpoint.
    const snapshot = structuredClone({
      ...publicRun(run),
      baseRevision: run.baseRevision,
      updatedAt: new Date().toISOString(),
      events: run.events,
      trace: run.trace,
      traceVersion: 1,
    });
    const task = run.pending.then(() =>
      library.recordRun(run.songId, run.id, snapshot),
    );
    run.pending = task.catch(() => {
      run.traceError = "TRACE_WRITE_FAILED: local diagnostic storage failed";
    });
    return task;
  };
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
    // SSE replay is bounded, but the durable stage timeline must not lose early events.
    if (type !== "model_stream")
      run.trace.push({
        type: "progress",
        timestamp: new Date().toISOString(),
        payload: { type, payload },
      });
    if (!["model_usage", "model_started", "model_stream"].includes(type))
      run.stage = type;
    void persist(run).catch(() => {});
  };
  app.get("/api/songs/:id/runs", async (req) => {
    const history = await library.listRuns((req.params as any).id);
    return history.map((r) => {
      const live = runs.get(r.id);
      return live
        ? {
            ...r,
            status: live.status,
            stage: live.stage,
            traceError: live.traceError,
          }
        : r;
    });
  });
  app.get("/api/songs/:id/runs/:runId/trace", async (req, reply) => {
    const { id, runId } = req.params as { id: string; runId: string };
    reply.header("Cache-Control", "no-store");
    const active = runs.get(runId);
    if (active?.songId === id) await active.pending;
    return library.readRun(id, runId);
  });
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
    if (!config.openaiKey && !adapter)
      return reply.code(422).send({
        code: "MISSING_API_KEY",
        message: "Add OPENAI_API_KEY to the root .env and restart the server.",
      });
    const run: Run = {
      id: crypto.randomUUID(),
      songId: id,
      status: "running",
      events: [],
      sequence: 0,
      error: null,
      controller: new AbortController(),
      startedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + config.runTimeoutMs).toISOString(),
      stage: "starting",
      trace: [],
      pending: Promise.resolve(),
      baseRevision: song.revision,
    };
    runs.set(run.id, run);
    try {
      run.trace.push({
        type: "input",
        timestamp: run.startedAt,
        payload: { ...body, song },
      });
      await persist(run);
    } catch (e) {
      runs.delete(run.id);
      throw e;
    }
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
    void (async () => {
      try {
        const result = await runAgent(
          {
            song,
            instruction: body.instruction,
            selection: body.selection,
            signal: run.controller.signal,
            trace: async (type, payload) => {
              if (closing) return;
              run.trace.push({
                type,
                timestamp: new Date().toISOString(),
                payload,
              });
              // Diagnostics must never interrupt a live model response. A later
              // checkpoint may still succeed after a transient local write error.
              await persist(run).catch(() => {});
            },
            progress: (type, payload) => {
              if (run.status === "running") emit(run, type, payload);
            },
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
            return structuredClone(result.next);
          },
          song.revision,
          run.id,
        );
        run.status = "completed";
        emit(run, "completed", {
          revision: run.result.song.revision,
          diff: musicalDiff(song, result.next),
        });
      } catch (e) {
        if (run.status === "running") {
          run.status = "failed";
          run.error = errorInfo(e);
          emit(run, "failed", run.error);
        }
      } finally {
        clearTimeout(timer);
        if (!closing) await persist(run).catch(() => {});
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
