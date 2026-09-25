import React, { useEffect, useState } from "react";

/** Independent from editor/playback status; historical traces survive a reload. */
export function AgentMonitor({
  songId,
  runId,
  onModelSpeech,
}: {
  songId: string;
  runId: string | null;
  onModelSpeech?: (text: string) => void;
}) {
  const [runs, setRuns] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [live, setLive] = useState<any>(null);
  const [connection, setConnection] = useState("");
  useEffect(() => {
    setLive(null);
    if (!runId) {
      setConnection("");
      return;
    }
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onopen = () => setConnection("Live updates connected");
    source.onerror = () =>
      setConnection(
        "Live connection interrupted; retrying. Saved status still refreshes.",
      );
    source.onmessage = (message) => {
      const e = JSON.parse(message.data);
      if (e.songId !== songId || e.runId !== runId) return;
      if (e.type === "model_started") {
        setLive({ runId, ...e.payload });
      }
      if (e.type === "model_stream") {
        setLive({ runId, ...e.payload });
        const speech = shortSpeech(e.payload.summary);
        if (speech) onModelSpeech?.(speech);
      }
      if (e.type === "snapshot" && e.payload.modelStream)
        setLive({ runId, ...e.payload.modelStream });
      if (
        [
          "preview_ready",
          "failed",
          "cancelled",
          "completed",
          "clarification_required",
        ].includes(e.type)
      ) {
        source.close();
        setConnection("Request finished");
      }
    };
    return () => source.close();
  // Speech is visual feedback only; the saved trace remains the source of truth.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, runId]);
  useEffect(() => {
    setSelected("");
    setTrace(null);
    setRuns([]);
  }, [songId]);
  useEffect(() => {
    if (runId) setSelected(runId);
  }, [runId]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/songs/${songId}/runs`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Run history unavailable. Restart the updated server if needed.",
          );
        const history = await response.json();
        if (!Array.isArray(history))
          throw new Error("Invalid run history response");
        if (disposed) return;
        setRuns(history);
        const id = selected || history[0]?.id;
        if (id && expanded) {
          const result = await fetch(`/api/songs/${songId}/runs/${id}/trace`, {
            signal: controller.signal,
          });
          if (!result.ok) throw new Error("Trace unavailable");
          const data = await result.json();
          if (!disposed)
            setTrace({
              ...data,
              traceError:
                history.find((r: any) => r.id === id)?.traceError ||
                data.traceError,
            });
        } else if (id && !disposed) {
          setTrace(history.find((r: any) => r.id === id) || null);
        }
        if (!disposed) {
          setError("");
          setNow(Date.now());
        }
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Trace unavailable");
      }
    }
    // Schedule after completion, avoiding overlapping requests for large traces.
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (!disposed) timer = setTimeout(loop, 2000);
    };
    void loop();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [songId, selected, runId, expanded]);
  const id = selected || runs[0]?.id;
  const stream = live?.runId === id ? live : trace?.modelStream;
  const end =
    trace?.status === "running"
      ? now
      : Date.parse(trace?.endedAt || trace?.updatedAt || trace?.startedAt);
  const seconds = trace?.startedAt
    ? Math.max(0, Math.round((end - Date.parse(trace.startedAt)) / 1000))
    : null;
  return (
    <section className="agent-monitor" aria-label="AI run monitor">
      <strong>AI activity</strong>
      {trace?.passage && (
        <div>
          Passage {trace.passage.index} of {trace.passage.total} · bars{" "}
          {trace.passage.bars.join(", ")}
        </div>
      )}
      {connection && <div>{connection}</div>}
      {stream && (
        <div aria-label="Model live output">
          <small>
            {stream.purpose} · {stream.outputCharacters ?? 0} output characters
            received
          </small>
          <details>
            <summary>Model summary (debug)</summary>
            <pre>
              {stream.summary ||
                "No summary received yet. Summaries are optional and are not the model's full internal reasoning."}
            </pre>
          </details>
          <details>
            <summary>Partial output (not yet validated)</summary>
            <pre>{stream.outputPreview || "Waiting for output…"}</pre>
          </details>
        </div>
      )}
      <div role="status">
        {trace
          ? `${trace.status} · ${trace.stage || "legacy trace"}${seconds === null ? "" : ` · ${seconds}s elapsed`}`
          : "No recorded requests yet"}
      </div>
      {trace?.status === "running" && (
        <small>
          Deadline: {new Date(trace.deadlineAt).toLocaleTimeString()}. Waiting
          summaries/output appear as OpenAI sends them; no artificial progress
          percentage.
        </small>
      )}
      {trace?.error && (
        <p className="error">
          {trace.error.code}: {trace.error.message}
        </p>
      )}
      {(error || trace?.traceError) && (
        <p className="error">{error || trace.traceError}</p>
      )}
      <details
        open={expanded}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>Inspect prompts and run trace</summary>
        <p>
          Saved locally, including your request and song context. Review before
          sharing. API credentials and hidden reasoning are not captured.
        </p>
        <select
          aria-label="Recorded AI run"
          value={id || ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setTrace(null);
          }}
        >
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.id} —{" "}
              {r.status}
            </option>
          ))}
        </select>
        {id && (
          <a
            href={`/api/songs/${songId}/runs/${id}/trace`}
            target="_blank"
            rel="noreferrer"
          >
            Open full trace JSON
          </a>
        )}
        {expanded && trace && (
          <>
            <details>
              <summary>Stage timeline and token usage</summary>
              <pre>{JSON.stringify(trace.events, null, 2)}</pre>
            </details>
            {!trace.trace && (
              <p>
                Legacy log: prompts and responses were not captured for this
                request.
              </p>
            )}
            {(trace.trace || []).map((entry: any, index: number) => (
              <details key={index}>
                <summary>
                  {entry.timestamp} · {entry.type}
                  {entry.payload?.purpose ? ` · ${entry.payload.purpose}` : ""}
                </summary>
                {entry.type === "model_request" &&
                  (
                    entry.payload.request.messages ||
                    entry.payload.request.input ||
                    []
                  ).map((message: any, i: number) => (
                    <div key={i}>
                      <strong>{message.role} prompt</strong>
                      <pre>{message.content}</pre>
                    </div>
                  ))}
                <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
              </details>
            ))}
          </>
        )}
      </details>
    </section>
  );
}

function shortSpeech(summary: unknown) {
  const raw = String(summary ?? "").trim();
  if (raw) {
    const block = raw.split(/\*\*[^*]+\*\*/).filter(Boolean).at(-1) ?? raw;
    const sentences = block.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const excerpt = sentences.slice(-2).join(" ") || block;
    return excerpt.slice(0, 320).replace(/[,:;\s]+$/, "") + (excerpt.length > 320 ? "…" : "");
  }
  return "";
}
