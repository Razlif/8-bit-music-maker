import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  INSTRUMENTS,
  add,
  sub,
  frac,
  value,
  pitchToMidi,
  midiToPitch,
  type Song,
  type Selection,
  type Note,
  type Track,
  type MusicCommand,
} from "@eight-bit/core";
import { Player, exportWav } from "./audio";
import "./styles.css";
import { AgentMonitor } from "./AgentMonitor";

export const api = async (path: string, init?: RequestInit) => {
  const r = await fetch("/api" + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? data.code ?? "Request failed");
  return data;
};
const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
type Summary = {
  id: string;
  title: string;
  revision: number | null;
  available: boolean;
  error?: string;
  history?: string;
};
const player = new Player();
type CompanionScene = "idle" | "keyboard" | "dj" | "thinking" | "celebrate" | "dance" | "repairing";
type WorkPhase = "orchestration" | "rhythm" | "pitch" | "validation";
type WorkCue = { scene: "dj" | "keyboard"; speech: string };
const workCues: Record<WorkPhase, WorkCue[]> = {
  orchestration: [
    { scene: "dj", speech: "Listening for the groove…" },
    { scene: "keyboard", speech: "Sketching out the parts…" },
  ],
  rhythm: [
    { scene: "dj", speech: "Finding the pocket…" },
    { scene: "keyboard", speech: "Tapping out the pattern…" },
  ],
  pitch: [
    { scene: "keyboard", speech: "Trying notes against the groove…" },
    { scene: "dj", speech: "Listening back to the phrase…" },
  ],
  validation: [
    { scene: "dj", speech: "Playing the arrangement back…" },
    { scene: "keyboard", speech: "Checking the final voicing…" },
  ],
};
const stageLabels: Record<string, string> = {
  reading: "Reading music",
  planning: "Reading the song",
  arranging: "Choosing the musical work",
  passage: "Preparing the next passage",
  rhythm: "Building the groove",
  composing: "Composing",
  validating: "Checking changes",
  repairing: "Repairing worker output",
  retrying: "Retrying worker",
};
const modelPurposePhases: Record<string, WorkPhase> = {
  music_orchestration: "orchestration",
  legacy_music_plan: "orchestration",
  music_plan: "orchestration",
  rhythm_grid: "rhythm",
  pitch_fill: "pitch",
  legacy_music_replacement: "pitch",
  music_candidate: "pitch",
};
function App() {
  const [exporting, setExporting] = useState(false);
  const [songs, setSongs] = useState<Summary[]>([]),
    [song, setSong] = useState<Song | null>(null),
    [selected, setSelected] = useState<Selection>({ kind: "song" });
  const [trackId, setTrackId] = useState(""),
    [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Ready"),
    [error, setError] = useState(""),
    [agentThought, setAgentThought] = useState("Drop in a thought. I’ll turn it into a loop."),
    [companionScene, setCompanionScene] = useState<CompanionScene>("idle"),
    [playing, setPlaying] = useState(false),
    [beat, setBeat] = useState(0),
    [solo, setSolo] = useState<Set<string>>(new Set());
  const [agent, setAgent] = useState(false),
    [runId, setRunId] = useState<string | null>(null),
    [launching, setLaunching] = useState(false),
    [busy, setBusy] = useState(false),
    [snap, setSnap] = useState(4);
  const [history, setHistory] = useState<
    Array<{ commit: string; message: string }>
  >([]);
  const events = useRef<EventSource | null>(null),
    pendingCommand = useRef<Promise<void> | null>(null),
    commandFailed = useRef(false),
    songRef = useRef<Song | null>(null),
    activeRun = useRef<string | null>(null),
    modelSpeechUntil = useRef(0),
    speechHoldTimer = useRef<number | null>(null),
    currentPresetSpeech = useRef("Drop in a thought. I’ll turn it into a loop."),
    cueTimer = useRef<number | null>(null),
    desiredWorkPhase = useRef<WorkPhase>("orchestration"),
    currentCue = useRef<{ phase: WorkPhase; index: number } | null>(null),
    problemActive = useRef(false),
    activeModelCalls = useRef(new Map<string, WorkPhase>());
  songRef.current = song;
  activeRun.current = runId;
  const refresh = () => api("/songs").then(setSongs);
  const clearSpeechHold = () => {
    modelSpeechUntil.current = 0;
    if (speechHoldTimer.current !== null) {
      window.clearTimeout(speechHoldTimer.current);
      speechHoldTimer.current = null;
    }
  };
  const setPresetSpeech = (text: string) => {
    currentPresetSpeech.current = text;
    if (Date.now() < modelSpeechUntil.current) return;
    setAgentThought(text);
  };
  const setModelSpeech = (text: string) => {
    modelSpeechUntil.current = Date.now() + 4000;
    setAgentThought(text);
    if (speechHoldTimer.current !== null)
      window.clearTimeout(speechHoldTimer.current);
    speechHoldTimer.current = window.setTimeout(() => {
      modelSpeechUntil.current = 0;
      speechHoldTimer.current = null;
      setAgentThought(currentPresetSpeech.current);
    }, 4000);
  };
  const applyWorkCue = (phase: WorkPhase, requestedIndex: number) => {
    const cues = workCues[phase];
    const index = requestedIndex % cues.length;
    const cue = cues[index];
    currentCue.current = { phase, index };
    setCompanionScene(cue.scene);
    setPresetSpeech(cue.speech);
  };
  const stopWorkCues = () => {
    if (cueTimer.current !== null) {
      window.clearInterval(cueTimer.current);
      cueTimer.current = null;
    }
    currentCue.current = null;
    activeModelCalls.current.clear();
  };
  const startWorkCues = (phase: WorkPhase) => {
    stopWorkCues();
    desiredWorkPhase.current = phase;
    problemActive.current = false;
    applyWorkCue(phase, 0);
    cueTimer.current = window.setInterval(() => {
      if (problemActive.current) return;
      const desired = desiredWorkPhase.current;
      const visible = currentCue.current;
      applyWorkCue(
        desired,
        visible?.phase === desired ? visible.index + 1 : 0,
      );
    }, 5000);
  };
  const selectWorkPhase = (phase: WorkPhase) => {
    desiredWorkPhase.current = phase;
  };
  const resumeWorkPhase = (phase: WorkPhase) => {
    desiredWorkPhase.current = phase;
    problemActive.current = false;
    applyWorkCue(phase, 0);
  };
  const showProblem = (scene: "thinking" | "repairing", speech: string) => {
    problemActive.current = true;
    clearSpeechHold();
    currentPresetSpeech.current = speech;
    setAgentThought(speech);
    setCompanionScene(scene);
  };
  const showError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    setError(message);
    stopWorkCues();
    showProblem("thinking", "Something’s off. Let me check the signal…");
  };
  useEffect(() => {
    refresh().catch(showError);
    api("/health")
      .then((h) => setAgent(h.agent))
      .catch(showError);
    return () => {
      events.current?.close();
      stopWorkCues();
      player.stop();
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      setBeat(player.beat);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    if (!runId && !launching && playing) setCompanionScene("dance");
  }, [runId, launching, playing]);
  useEffect(() => {
    if (companionScene !== "celebrate" || runId || launching) return;
    const timer = window.setTimeout(() => setCompanionScene(playing ? "dance" : "idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [companionScene, runId, launching, playing]);
  useEffect(() => {
    if (song) player.mix(song.music.tracks, solo);
  }, [song, solo]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected({ kind: "song" });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const stop = () => {
    player.stop();
    setPlaying(false);
    setBeat(0);
    if (!runId && !launching) setCompanionScene("idle");
  };
  const guardSwitch = async () => {
    if (!runId) return true;
    if (
      !confirm(
        "Cancel the active request and switch songs?",
      )
    )
      return false;
    if (runId) await post("/runs/" + runId + "/cancel");
    events.current?.close();
    stopWorkCues();
    activeRun.current = null;
    setRunId(null);
    return true;
  };
  const open = async (id: string) => {
    try {
      if (!(await guardSwitch())) return;
      stop();
      const next = await api("/songs/" + id);
      setSong(next);
      setTrackId(next.music.tracks[0]?.id ?? "");
      setSelected({ kind: "song" });
      setSolo(new Set());
      setHistory([]);
      setError("");
      stopWorkCues();
      clearSpeechHold();
      problemActive.current = false;
      setPresetSpeech("Drop in a thought. I’ll turn it into a loop.");
      setCompanionScene("idle");
      songRef.current = next;
      const activity = await api("/songs/" + id + "/activity");
      if (activity?.status === "running") watchRun(activity.id);
    } catch (e) {
      showError(e);
    }
  };
  const create = async () => {
    try {
      if (!(await guardSwitch())) return;
      stop();
      const next = await post("/songs");
      setSong(next);
      setTrackId(next.music.tracks[0]?.id ?? "");
      setSelected({ kind: "song" });
      setSolo(new Set());
      setError("");
      stopWorkCues();
      clearSpeechHold();
      problemActive.current = false;
      setPresetSpeech("Drop in a thought. I’ll turn it into a loop.");
      setCompanionScene("idle");
      await refresh();
    } catch (e) {
      showError(e);
    }
  };
  const command = (cmd: MusicCommand): Promise<void> => {
    if (pendingCommand.current) return pendingCommand.current.then(() => command(cmd));
    const current = songRef.current;
    if (!current) return Promise.resolve();
    const save = async () => {
    commandFailed.current = false;
    setBusy(true);
    setError("");
    try {
      const result = await post("/songs/" + current.id + "/commands", {
        ...cmd,
        expectedRevision: current.revision,
      });
      setSong(result.song);
      songRef.current = result.song;
      setStatus(
        result.history === "pending"
          ? "Saved · history pending"
          : "Saved · revision " + result.song.revision,
      );
      if (player.playing && cmd.type !== "set_mix")
        player.switchAtBar(result.song);
      await refresh();
    } catch (e) {
      showError(e);
      commandFailed.current = true;
      player.mix(current.music.tracks, solo);
    } finally {
      setBusy(false);
    }
    };
    const pending = save().finally(() => { pendingCommand.current = null; });
    pendingCommand.current = pending;
    return pending;
  };
  const play = async (selectionOnly = false) => {
    if (!song) return;
    try {
      const range =
        selectionOnly && selected.kind === "regions"
          ? {
              start: Math.min(...selected.regions.map((r) => value(r.start))),
              end: Math.max(...selected.regions.map((r) => value(r.end))),
            }
          : undefined;
      await player.play(song, range);
      player.mix(song.music.tracks, solo);
      setPlaying(true);
    } catch (e) {
      showError(e);
    }
  };
  const finishRun = async (id: string) => {
    const snapshot = await api("/runs/" + id);
    if (activeRun.current !== id || songRef.current?.id !== snapshot.songId)
      return;
    if (snapshot.status === "completed") {
      stopWorkCues();
      const next = await api("/songs/" + snapshot.songId);
      setSong(next);
      songRef.current = next;
      await refresh();
      setStatus("Updated");
      clearSpeechHold();
      setPresetSpeech("There it is—give it a listen!");
      problemActive.current = false;
      setCompanionScene("celebrate");
    } else if (snapshot.error) showError(new Error(snapshot.error.message));
    else {
      setStatus(snapshot.message ?? snapshot.status);
      if (snapshot.status === "cancelled") {
        stopWorkCues();
        clearSpeechHold();
        setPresetSpeech("Stopped. Ready when you are.");
        problemActive.current = false;
        setCompanionScene("idle");
      } else if (snapshot.status === "failed") {
        stopWorkCues();
        showProblem("thinking", "Something’s off. Let me check the signal…");
      } else if (snapshot.status === "clarification_required") {
        stopWorkCues();
        showProblem("thinking", "I need a little more direction before I continue.");
      }
    }
    if (
      [
        "failed",
        "cancelled",
        "completed",
        "clarification_required",
      ].includes(snapshot.status)
    ) {
      events.current?.close();
      setRunId(null);
      activeRun.current = null;
    }
  };
  const watchRun = (id: string) => {
    if (cueTimer.current === null) startWorkCues("orchestration");
    setRunId(id);
    activeRun.current = id;
    const es = new EventSource("/api/runs/" + id + "/events");
    events.current = es;
    es.onmessage = (event) => {
      const e = JSON.parse(event.data);
      if (e.runId !== activeRun.current || e.songId !== songRef.current?.id)
        return;
      if (
        [
          "failed",
          "cancelled",
          "completed",
          "clarification_required",
          "snapshot",
        ].includes(e.type)
      ) {
        void finishRun(id).catch(showError);
      } else if (e.type === "model_started") {
        const phase = modelPurposePhases[String(e.payload?.purpose ?? "")];
        const callId = String(e.payload?.callId ?? "");
        if (phase) {
          if (callId) activeModelCalls.current.set(callId, phase);
          if (problemActive.current) resumeWorkPhase(phase);
          else selectWorkPhase(phase);
        }
      } else if (e.type === "model_usage") {
        const callId = String(e.payload?.callId ?? "");
        if (callId) activeModelCalls.current.delete(callId);
        const remaining = Array.from(activeModelCalls.current.values()).at(-1);
        if (remaining) selectWorkPhase(remaining);
      } else if (e.type === "repairing" || e.type === "retrying") {
        setStatus(stageLabels[e.type]);
        showProblem(
          "repairing",
          e.type === "retrying"
            ? "That one got tangled. Trying it again…"
            : "Tuning up a tricky bit…",
        );
      } else if (stageLabels[e.type]) {
        setStatus(stageLabels[e.type]);
        if (e.type === "validating") selectWorkPhase("validation");
        else if (e.type === "planning" || e.type === "arranging")
          selectWorkPhase("orchestration");
      } else if (!["model_stream"].includes(e.type))
        setStatus(e.type);
    };
    es.onerror = () => {
      void finishRun(id).catch((e) => {
        es.close();
        setRunId(null);
        activeRun.current = null;
        showError(e);
      });
    };
  };
  const send = async () => {
    if (!song || !prompt.trim() || runId || launching || busy) return;
    setLaunching(true);
    setError("");
    clearSpeechHold();
    setStatus("Reading music");
    startWorkCues("orchestration");
    try {
      await pendingCommand.current;
      if (commandFailed.current) throw new Error("Save the song settings successfully before composing.");
      const current = songRef.current;
      if (!current) return;
      const result = await post("/songs/" + current.id + "/runs", {
        instruction: prompt,
        // AI composition is whole-song in the demo. Manual selection remains
        // available for playback/editing, but does not silently narrow the
        // dispatcher contract.
        selection: { kind: "song" },
        expectedRevision: current.revision,
      });
      watchRun(result.runId);
    } catch (e) {
      showError(e);
      setRunId(null);
    } finally {
      setLaunching(false);
    }
  };
  const cancel = async () => {
    if (runId) {
      await post("/runs/" + runId + "/cancel");
      events.current?.close();
      stopWorkCues();
      activeRun.current = null;
      setRunId(null);
      setStatus("Cancelled");
      clearSpeechHold();
      problemActive.current = false;
      setCompanionScene("idle");
      setPresetSpeech("Stopped. Ready when you are.");
    }
  };
  const download = async () => {
    if (!song || exporting) return;
    setExporting(true);
    const started = Date.now();
    setBusy(true);
    try {
      const blob = await exportWav(song),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        (song.title.replace(/[^a-z0-9 _-]/gi, "").slice(0, 80) || "loop") +
        ".wav";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Exported saved mix");
    } catch (e) {
      showError(e);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 700 - (Date.now() - started))));
      setExporting(false);
      setBusy(false);
    }
  };
  const current = song,
    track = current?.music.tracks.find((t) => t.id === trackId),
    selectedIds = selected.kind === "notes" ? selected.noteIds : [];
  return (
    <div className="app">
      <details className="library-drawer">
        <summary>♫ Library</summary>
        <aside
          className="library"
          onClick={(event) => {
            if (
              (event.target as HTMLElement).closest("button.new, button.song")
            )
              event.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          <div className="brand">
            <span className="pixel">♪</span>
            <div>
              <strong>CHIP//STUDIO</strong>
              <small>shape a little world of sound</small>
            </div>
          </div>
          <button className="new" onClick={create}>
            ＋ New song
          </button>
          <div className="song-list">
            {songs.map((s) => (
              <button
                key={s.id}
                className={"song " + (song?.id === s.id ? "active" : "")}
                onClick={() => s.available && open(s.id)}
              >
                <span>{s.available ? "◉" : "⚠"}</span>
                <span>
                  <b>{s.title}</b>
                  <small>
                    {s.available ? "revision " + s.revision : s.error}
                  </small>
                  {s.history === "pending" && <small>History pending</small>}
                </span>
              </button>
            ))}
          </div>
          {song && (
            <div className="library-tools">
              <button
                onClick={() => {
                  const title = window.prompt("Song title", song.title);
                  if (title) void command({ type: "rename", title });
                }}
              >
                Rename
              </button>
              <button
                onClick={async () => {
                  try {
                    if (!(await guardSwitch())) return;
                    const next = await post("/songs/" + song.id + "/duplicate");
                    await refresh();
                    await open(next.id);
                  } catch (e) {
                    showError(e);
                  }
                }}
              >
                Duplicate
              </button>
              <button
                onClick={() =>
                  api("/songs/" + song.id + "/history")
                    .then(setHistory)
                    .catch(showError)
                }
              >
                History / undo
              </button>
              <button
                onClick={() =>
                  post("/songs/" + song.id + "/history/retry")
                    .then((r) => {
                      setStatus("History: " + r.history);
                      return refresh();
                    })
                    .catch(showError)
                }
              >
                Retry history
              </button>
              {history.map((h, i) => (
                <button
                  key={h.commit}
                  disabled={i === 0 || busy}
                  onClick={async () => {
                    try {
                      const r = await post("/songs/" + song.id + "/restore", {
                        commit: h.commit,
                        expectedRevision: song.revision,
                      });
                      setSong(r.song);
                      setHistory([]);
                      stop();
                      await refresh();
                    } catch (e) {
                      showError(e);
                    }
                  }}
                >
                  Restore {h.message}
                </button>
              ))}
            </div>
          )}
          <small className="local-note">
            Local files. Your music stays here.
            <br />
            Each request starts fresh.
          </small>
        </aside>
      </details>
      <main className="main">
        <header className="topbar">
          {song && <div className="topbar-companion">
            <CompanionConsole
              scene={companionScene}
              speech={error || agentThought || status}
            />
          </div>}
          <div className="topbar-title">
            <span className="eyebrow">
              CHIP//STUDIO · LOCAL
            </span>
            <h1>{song?.title ?? "Your next little anthem"}</h1>
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {song && current ? (
          <>
            <aside className="agent">
              {!agent && (
                <p className="hint">
                  AI is disabled. Add OPENAI_API_KEY to the root .env and
                  restart. Manual editing and playback work without a key.
                </p>
              )}
              <div className="request-line">
                <textarea
                  aria-label="Composer request"
                  value={prompt}
                  disabled={!!runId || launching || busy}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void send();
                  }}
                  rows={2}
                  placeholder="Make the bass bounce. Give the melody a little mystery…"
                />
                <div className="request-action">
                  <Cassette
                    state={error ? "error" : runId || launching ? "working" : "idle"}
                    disabled={!agent || !!runId || launching || busy || !prompt.trim()}
                    onClick={send}
                  />
                </div>
              </div>
              {runId && (
                <div className="composer-footer">
                  <button onClick={() => cancel().catch(showError)}>
                    Cancel request
                  </button>
                </div>
              )}
            </aside>
            <div className="studio">
              <section className="editor">
                <div className="transport transport-row">
                  <div className="scope scope-inline" aria-label="Editing scope">
                    <span>Editing</span>
                    <code>{selectionText(selected, song)}</code>
                  </div>
                  <button
                    aria-label={playing ? "Stop playback" : "Play song"}
                    className="play"
                    onClick={() => (playing ? stop() : void play())}
                  >
                    {playing ? "■" : "▶"}
                  </button>
                  <output className="led-position" aria-label="Playback bar and beat">
                    {String(Math.floor(beat / 4) + 1).padStart(2, "0")}:{String(Math.floor(beat % 4) + 1).padStart(2, "0")}
                  </output>
                  <AudioPixels />
                  <button disabled={!song} onClick={() => void play(true)}>
                    Loop selection
                  </button>
                  <CommitNumber
                    label="BPM"
                    value={song.music.bpm}
                    min={40}
                    max={240}
                    disabled={busy || !!runId || launching}
                    commit={(bpm) => command({ type: "set_tempo", bpm })}
                  />
                  <button className={"floppy-export" + (exporting ? " writing" : "")} disabled={busy || exporting} onClick={download} aria-label={exporting ? "Exporting WAV" : "Export WAV"} title="Export WAV">
                    <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
                      <path d="M2 2h17l3 3v17H2z" fill="#b3a2cf" />
                      <path d="M6 2h11v8H6z" fill="#d8d4cc" /><path d="M13 3h3v5h-3z" fill="#353342" />
                      <path d="M6 13h12v9H6z" fill="#e4ddcc" /><path d="M8 16h8v1H8zm0 3h6v1H8z" fill="#77718e" />
                      <path className="disk-light" d="M19 18h2v2h-2z" />
                    </svg>
                    <span>{exporting ? "Writing…" : "WAV"}</span>
                  </button>
                </div>
                <Timeline
                  song={current}
                  selection={selected}
                  select={setSelected}
                  focus={setTrackId}
                  trackId={trackId}
                  beat={beat}
                  solo={solo}
                  toggleSolo={(id) =>
                    setSolo((old) => {
                      const n = new Set(old);
                      n.has(id) ? n.delete(id) : n.add(id);
                      return n;
                    })
                  }
                  busy={busy}
                  mix={(t, volumeDb, muted, persist) => {
                    player.mix(
                      song.music.tracks.map((x) =>
                        x.id === t.id ? { ...x, volumeDb, muted } : x,
                      ),
                      solo,
                    );
                    if (persist)
                      void command({
                        type: "set_mix",
                        trackId: t.id,
                        volumeDb,
                        muted,
                      });
                  }}
                />
                {track && (
                  <details className="note-drawer">
                    <summary>
                      Edit notes <span>{track.name}</span>
                    </summary>
                    <div className="editor-toolbar">
                      <strong>{track.name}</strong>
                      <select
                        aria-label="Instrument preset"
                        value={track.instrumentId}
                        disabled={busy}
                        onChange={(e) =>
                          void command({
                            type: "edit_track",
                            trackId: track.id,
                            name: track.name,
                            instrumentId: e.target.value,
                          })
                        }
                      >
                        {Object.values(INSTRUMENTS)
                          .filter((i) =>
                            (i.availability !== "candidate" && i.availability !== "retired") ||
                            i.id === track.instrumentId,
                          )
                          .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}{i.availability === "retired" ? " (retired)" : ""}
                          </option>
                          ))}
                      </select>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const name = window.prompt("Track name", track.name);
                          if (name)
                            void command({
                              type: "edit_track",
                              trackId: track.id,
                              name,
                              instrumentId: track.instrumentId,
                            });
                        }}
                      >
                        Rename track
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm("Remove " + track.name + " and its notes?")
                          )
                            void command({
                              type: "remove_track",
                              trackId: track.id,
                            });
                        }}
                      >
                        Remove
                      </button>
                      <button
                        disabled={!selectedIds.length || busy}
                        onClick={() =>
                          void command({
                            type: "delete_notes",
                            noteIds: selectedIds,
                          })
                        }
                      >
                        Delete selected
                      </button>
                      <button
                        disabled={!selectedIds.length || busy}
                        onClick={() =>
                          void command({
                            type: "transpose",
                            noteIds: selectedIds,
                            semitones: 12,
                          })
                        }
                      >
                        + Octave
                      </button>
                    </div>
                    <PianoRoll
                      song={current}
                      track={track}
                      selected={selectedIds}
                      select={setSelected}
                      snap={snap}
                      disabled={busy}
                      command={command}
                    />
                    <p className="hint">
                      Draw in empty space. Drag a note to move; drag its right
                      edge to resize. Drums: click to toggle. Off-grid rhythms
                      keep their original offset when moved.
                    </p>
                  </details>
                )}
              </section>
            </div>
            <div className="bottom-drawers">
              <details className="song-settings">
                <summary>Song settings & tools</summary>
                <div className="editor-toolbar">
                  <button
                    className={selected.kind === "song" ? "chosen" : ""}
                    onClick={() => setSelected({ kind: "song" })}
                  >
                    Whole song
                  </button>
                  <label>
                    Snap{" "}
                    <select
                      value={snap}
                      onChange={(e) => setSnap(Number(e.target.value))}
                    >
                      {[
                        [2, "1/8"],
                        [3, "Triplet"],
                        [4, "1/16"],
                        [6, "Sixteenth triplet"],
                        [8, "1/32"],
                      ].map(([n, label]) => (
                        <option key={n} value={n}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bars{" "}
                    <select
                      aria-label="Bars"
                      value={song.music.bars}
                      disabled={busy}
                      onChange={(event) => {
                        const bars = Number(event.target.value);
                        void command({
                          type: "resize_song",
                          bars,
                          trim:
                            bars < song.music.bars
                              ? confirm("Trim notes beyond the new song end?")
                              : false,
                        });
                      }}
                    >
                      {Array.from({ length: 32 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Key label{" "}
                    <select
                      value={song.music.key?.root ?? ""}
                      onChange={(e) =>
                        void command({
                          type: "set_key",
                          root: e.target.value,
                          mode:
                            song.music.key?.mode === "minor"
                              ? "minor"
                              : "major",
                        })
                      }
                    >
                      <option value="" disabled>
                        Unset
                      </option>
                      {[
                        "C",
                        "C#",
                        "D",
                        "D#",
                        "E",
                        "F",
                        "F#",
                        "G",
                        "G#",
                        "A",
                        "A#",
                        "B",
                      ].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  <select
                    aria-label="Key mode"
                    value={song.music.key?.mode ?? "major"}
                    onChange={(e) =>
                      void command({
                        type: "set_key",
                        root: song.music.key?.root ?? "C",
                        mode: e.target.value as "major" | "minor",
                      })
                    }
                  >
                    <option>major</option>
                    <option>minor</option>
                  </select>
                  <button
                    disabled={busy || song.music.tracks.length >= 8}
                    onClick={() =>
                      void command({
                        type: "add_track",
                        instrumentId: "soft_lead",
                        name: "New lead",
                      })
                    }
                  >
                    ＋ Track
                  </button>
                  <a className="tool-link" href="/instrument-lab.html" target="_blank" rel="noreferrer">
                    ♫ Instrument Lab
                  </a>
                </div>
              </details>
              <details className="activity-drawer">
                <summary>Activity & traces</summary>
                <AgentMonitor
                  key={song.id}
                  songId={song.id}
                  runId={runId}
                  onModelSpeech={setModelSpeech}
                />
              </details>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-icon">♫</div>
            <h2>Small sounds. Big ideas.</h2>
            <p>
              Create a loop, sketch some notes, and shape it with the composer.
            </p>
            <button className="primary" onClick={create}>
              Create first song
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
function CompanionConsole({
  scene,
  speech,
}: {
  scene: CompanionScene;
  speech: string;
}) {
  return (
    <div className="companion-console">
      <PixelCompanion scene={scene} />
      <div className="sprite-speech" aria-live="polite">
        {speech}
      </div>
    </div>
  );
}
function Cassette({ state, disabled, onClick }: { state: "idle" | "working" | "ready" | "error"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={"cassette " + state}
      aria-label={state === "working" ? "Composing" : "Send composition request"}
      title={state === "working" ? "Composing…" : "Compose"}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="cassette-label"><span>CHIP TAPE</span><b>SIDE A</b></div>
      <div className="cassette-window"><i className="reel left" /><em /><i className="reel right" /></div>
      <div className="cassette-notches" />
    </button>
  );
}
function PixelCompanion({ scene }: { scene: CompanionScene }) {
  return (
    <svg
      className={`companion companion-${scene} stage-${scene}`}
      viewBox="0 0 48 40"
      role="img"
      aria-label={"Composer " + scene}
      shapeRendering="crispEdges"
    >
      <ellipse className="sprite-shadow" cx="24" cy="37" rx="10" ry="1.5" />
      <g className="sprite-body"><g transform="translate(8 2) scale(1.45)">
        <path fill="currentColor" d="M7 4h10v2h3v12h-3v2H7v-2H4V6h3zM10 1h4v3h-4zM1 10h3v5H1zM20 10h3v5h-3zM6 20h4v2H6zM14 20h4v2h-4z" />
        <path fill="#171a26" d="M7 8h10v7H7z" />
        <path className="sprite-eyes" fill="#a9d4bd" d="M8 10h2v3H8zM14 10h2v3h-2z" />
        <path fill="#171a26" d="M10 17h4v1h-4z" />
      </g></g>
      <g className="headphones" fill="#65d1c5" stroke="#171a26" strokeWidth="1">
        <path d="M12 17V8h3V5h20v3h3v9h-3V9H15v8z" />
        <rect className="headphone-cup left-cup" x="10" y="14" width="6" height="10" />
        <rect className="headphone-cup right-cup" x="35" y="14" width="6" height="10" />
      </g>
      <g className="keyboard-prop">
        <path d="M10 33h2v6h-2zM37 33h2v6h-2z" fill="#77718e" />
        <path d="M6 28h36v3H6z" fill="#eee4ce" />
        <path d="M6 31h36v4H6z" fill="#57506c" />
        <path d="M11 28v3m5-3v3m5-3v3m5-3v3m5-3v3m5-3v3" stroke="#252333" />
        <path className="playing-hand hand-left" d="M12 24h3v2h6v3h-8v-2h-1z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
        <path className="playing-hand hand-right" d="M35 24h-3v2h-6v3h8v-2h1z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
      </g>
      <g className="music-notes" fill="#f0d987">
        <path className="music-note note-one" d="M36 9h2v7a3 3 0 1 1-2-2.8z" />
        <path className="music-note note-two" d="M40 4h2v6a3 3 0 1 1-2-2.8z" />
      </g>
      <g className="dj-prop">
        <path d="M8 34h3v4H8zM37 34h3v4h-3z" fill="#77718e" />
        <path d="M5 29h38v6H5z" fill="#57506c" stroke="#171a26" />
        <path d="M5 29h38v2H5z" fill="#b3a2cf" />
        <path d="M9 27h17v2H9zM11 26h13v1H11z" fill="#242432" />
        <path className="record-marker" d="M15 27h3v1h-3z" fill="#f0d987" />
        <path d="M28 25h3v4H20" fill="none" stroke="#eee4ce" />
        <path d="M34 28h2v2h-2zM8 32h2v1H8z" fill="#65d1c5" />
        <path className="scratch-hand" d="M12 23h3v2h7v3h-9v-2h-1z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
        <path className="mixer-hand" d="M36 24h-3v3h-2v2h6v-3h-1z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
        <path className="channel-light light-a" d="M30 32h2v2h-2z" fill="#65d1c5" />
        <path className="channel-light light-b" d="M34 32h2v2h-2z" fill="#f0d987" />
        <path className="channel-light light-c" d="M38 32h2v2h-2z" fill="#ef8587" />
      </g>
      <g className="guitar-prop">
        <path d="M16 22h4l3 3 14-12 3 3-14 12v5l-4 4h-8l-4-4v-7l3-3z" fill="#d6a06f" stroke="#171a26" />
        <path d="M18 29L39 14" stroke="#f3e7cb" strokeWidth="1" />
        <path d="M36 12h5v5h-3z" fill="#c7bdb0" />
        <path d="M16 28h6v4h-6z" fill="#393344" />
        <path className="strum-hand" d="M12 24h4v3h6v3h-8v-3h-2z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
        <path className="fret-hand" d="M32 19h4v4h-4z" fill="currentColor" stroke="#171a26" strokeWidth="0.7" />
      </g>
      <g className="thinking-prop" fill="#f0d987">
        <rect x="35" y="4" width="5" height="2" />
        <rect x="38" y="6" width="2" height="3" />
        <rect x="36" y="9" width="3" height="2" />
        <rect x="36" y="12" width="2" height="2" />
      </g>
      <g className="repair-prop">
        <path d="M35 20h3v4h3v-4h3v7h-3v9h-4v-9h-2z" fill="#c7d2d8" stroke="#171a26" strokeWidth="1" />
        <path d="M34 29h7v3h-7z" fill="currentColor" />
      </g>
      <g className="sparkles" fill="#f0d987">
        <path className="sparkle sparkle-one" d="M9 8h2v3h3v2h-3v3H9v-3H6v-2h3z" />
        <path className="sparkle sparkle-two" d="M38 14h1v2h2v1h-2v2h-1v-2h-2v-1h2z" />
      </g>
    </svg>
  );
}
function CommitNumber({
  label,
  value: initial,
  min,
  max,
  disabled,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  commit: (n: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(initial));
  useEffect(() => setDraft(String(initial)), [initial]);
  return (
    <label>
      {label}{" "}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (n >= min && n <= max && n !== initial) void commit(n);
          else setDraft(String(initial));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function selectionText(s: Selection, song: Song) {
  const names = (ids: string[]) =>
    ids
      .map((id) => song.music.tracks.find((t) => t.id === id)?.name ?? id)
      .join(", ");
  return s.kind === "song"
    ? "Whole song"
    : s.kind === "tracks"
      ? names(s.trackIds)
      : s.kind === "notes"
        ? s.noteIds.length + " selected note(s)"
        : s.regions
            .map(
              (r) =>
                names(r.trackIds) +
                " · beats " +
                (value(r.start) + 1) +
                "–" +
                (value(r.end) + 1),
            )
            .join("; ");
}
function AudioPixels({ trackId }: { trackId?: string }) {
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLevels(trackId ? [Math.max(0, Math.min(1, (player.level(trackId) + 60) / 60))] : player.spectrum());
    }, 50);
    return () => window.clearInterval(timer);
  }, [trackId]);
  return <svg className={trackId ? "pixel-vu" : "pixel-spectrum"} viewBox={trackId ? "0 0 5 32" : "0 0 79 32"} role="img" aria-label={trackId ? "Track audio level" : "Playback spectrum"} shapeRendering="crispEdges">
    {Array.from({ length: trackId ? 1 : 16 }, (_, column) =>
      Array.from({ length: 8 }, (_, row) => <rect key={`${column}-${row}`} x={column * 5} y={29 - row * 4} width="4" height="3" fill={row >= 7 ? "#ef8587" : row >= 5 ? "#e3c56e" : "#79c9a4"} opacity={(levels[column] ?? 0) * 8 > row ? 1 : 0.12} />))}
  </svg>;
}
function InstrumentIcon({ instrument }: { instrument: string }) {
  const paths: Record<string, string> = {
    chip_bass: "M5 10h4v3h3v5H9v3H3v-3H1v-5h4zM9 12l9-10 3 3-10 9z",
    kick: "M5 4h12v2h3v12h-3v2H5v-2H2V6h3zM5 7v10h12V7zM10 10h3v4h-3z",
    snare: "M2 7h20v11H2zM4 9v6h3V9zm6 0v6h3V9zm6 0v6h3V9zM5 2l15 3v2L5 4z",
    closed_hat: "M10 2h3v5h6v2h3v2H1V9h3V7h6zM10 12h3v7h5v2H5v-2h5z",
    chip_pad: "M2 5h20v15H2zM4 7v3h3V7zm5 0v3h3V7zm5 0v3h6V7zM4 13v5h2v-5zm4 0v5h2v-5zm4 0v5h2v-5zm4 0v5h4v-5z",
    pluck: "M4 10h5v3h4v7H3v-3H1v-5h3zM9 12l9-10 3 3-10 9z",
  };
  return <svg className="instrument-icon" viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" fillRule="evenodd" d={paths[instrument] ?? "M1 6h22v13H1zM3 8v9h3V8zm5 0v9h3V8zm5 0v9h3V8zm5 0v9h3V8z"} /></svg>;
}
function Fader({
  track,
  busy,
  mix,
}: {
  track: Track;
  busy: boolean;
  mix: (v: number, m: boolean, persist: boolean) => void;
}) {
  const [level, setLevel] = useState(track.volumeDb),
    saved = useRef(track.volumeDb);
  useEffect(() => {
    setLevel(track.volumeDb);
    saved.current = track.volumeDb;
  }, [track.volumeDb]);
  const commit = () => {
    if (level !== saved.current) {
      saved.current = level;
      mix(level, track.muted, true);
    }
  };
  return (
    <label className="fader">
      <input
        aria-label={track.name + " volume"}
        type="range"
        min="-60"
        max="6"
        value={level}
        disabled={busy}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLevel(v);
          mix(v, track.muted, false);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{level} dB</output>
    </label>
  );
}
function Timeline({
  song,
  selection,
  select,
  focus,
  trackId,
  beat,
  solo,
  toggleSolo,
  busy,
  mix,
}: {
  song: Song;
  selection: Selection;
  select: (s: Selection) => void;
  focus: (id: string) => void;
  trackId: string;
  beat: number;
  solo: Set<string>;
  toggleSolo: (id: string) => void;
  busy: boolean;
  mix: (t: Track, v: number, m: boolean, p: boolean) => void;
}) {
  const drag = useRef<{
      beat: number;
      index: number;
      ruler: boolean;
      moved: boolean;
    } | null>(null),
    grid = useRef<HTMLDivElement>(null);
  const position = (event: React.PointerEvent) => {
    const rect = grid.current!.getBoundingClientRect();
    return {
      beat: Math.max(
        0,
        Math.min(
          song.music.bars * 4 - 0.001,
          ((event.clientX - rect.left) / rect.width) * song.music.bars * 4,
        ),
      ),
      index: Math.max(
        0,
        Math.min(
          song.music.tracks.length - 1,
          Math.floor((event.clientY - rect.top - 30) / 76),
        ),
      ),
    };
  };
  return (
    <div className="timeline">
      <div className="track-heads">
        <div className="ruler-label">TRACK / MIX</div>
        {song.music.tracks.map((t) => (
          <div
            key={t.id}
            className={"track-info " + (trackId === t.id ? "focused" : "")}
          >
            <button
              className="track-name"
              onClick={() => {
                focus(t.id);
                select({ kind: "tracks", trackIds: [t.id] });
              }}
            >
              <InstrumentIcon instrument={t.instrumentId} /><span>{t.name}</span>
            </button>
            <div className="mix-buttons">
              <button
                aria-label={"Mute " + t.name}
                disabled={busy}
                className={t.muted ? "chosen" : ""}
                onClick={() => mix(t, t.volumeDb, !t.muted, true)}
              >
                M
              </button>
              <button
                aria-label={"Solo " + t.name}
                className={solo.has(t.id) ? "chosen" : ""}
                onClick={() => toggleSolo(t.id)}
              >
                S
              </button>
              <Fader track={t} busy={busy} mix={(v, m, p) => mix(t, v, m, p)} />
              <AudioPixels trackId={t.id} />
            </div>
          </div>
        ))}
      </div>
      <div
        className="lanes"
        ref={grid}
        onPointerDown={(e) => {
          if (e.button !== 0 || !song.music.tracks.length) return;
          const p = position(e);
          drag.current = {
            ...p,
            ruler: e.clientY - grid.current!.getBoundingClientRect().top < 30,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          drag.current.moved = true;
          const p = position(e),
            d = drag.current;
          const start = Math.floor(Math.min(d.beat, p.beat)),
            end = Math.min(
              song.music.bars * 4,
              Math.floor(Math.max(d.beat, p.beat)) + 1,
            ),
            ids = d.ruler
              ? song.music.tracks.map((t) => t.id)
              : song.music.tracks
                  .slice(
                    Math.min(p.index, d.index),
                    Math.max(p.index, d.index) + 1,
                  )
                  .map((t) => t.id);
          select({
            kind: "regions",
            regions: [{ start: frac(start), end: frac(end), trackIds: ids }],
          });
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            const d = drag.current;
            if (!d.moved)
              select({
                kind: "regions",
                regions: [
                  {
                    start: frac(Math.floor(d.beat)),
                    end: frac(Math.floor(d.beat) + 1),
                    trackIds: d.ruler
                      ? song.music.tracks.map((t) => t.id)
                      : [song.music.tracks[d.index].id],
                  },
                ],
              });
            drag.current = null;
          }
        }}
      >
        <div className="ruler">
          {Array.from({ length: song.music.bars }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        {song.music.tracks.map((t) => (
          <svg
            key={t.id}
            className="overview"
            viewBox="0 0 1000 76"
            preserveAspectRatio="none"
          >
            {Array.from({ length: song.music.bars * 4 }, (_, i) => (
              <line
                key={i}
                x1={(i * 1000) / (song.music.bars * 4)}
                x2={(i * 1000) / (song.music.bars * 4)}
                y1="0"
                y2="76"
                stroke={i % 4 === 0 ? "#414661" : "#252b3e"}
              />
            ))}
            {selection.kind === "regions" &&
              selection.regions
                .filter((r) => r.trackIds.includes(t.id))
                .map((r, i) => (
                  <rect
                    key={i}
                    x={(value(r.start) * 1000) / (song.music.bars * 4)}
                    y="0"
                    width={
                      ((value(r.end) - value(r.start)) * 1000) /
                      (song.music.bars * 4)
                    }
                    height="76"
                    fill="#a78bfa"
                    opacity=".16"
                  />
                ))}
            {t.notes.map((n) => (
              <rect
                key={n.id}
                data-note-id={n.id}
                x={(value(n.start) * 1000) / (song.music.bars * 4)}
                y={
                  n.kind === "hit" ? 30 : 62 - (pitchToMidi(n.pitch)! % 24) * 2
                }
                width={Math.max(
                  2,
                  (value(n.duration) * 1000) / (song.music.bars * 4),
                )}
                height="9"
                rx="2"
                fill={
                  selection.kind === "notes" && selection.noteIds.includes(n.id)
                    ? "#fff"
                    : t.instrumentId.includes("bass")
                      ? "#ffbd69"
                      : n.kind === "hit"
                        ? "#65d1c5"
                        : "#a78bfa"
                }
                onPointerDown={(e) => {
                  e.stopPropagation();
                  focus(t.id);
                  const ids =
                    e.shiftKey && selection.kind === "notes"
                      ? selection.noteIds
                      : [];
                  select({
                    kind: "notes",
                    noteIds: ids.includes(n.id)
                      ? ids.filter((id) => id !== n.id)
                      : [...ids, n.id],
                  });
                }}
              >
                <title>{n.kind === "pitched" ? n.pitch : "hit"}</title>
              </rect>
            ))}
          </svg>
        ))}
        <div
          className="playhead"
          style={{ left: (beat / (song.music.bars * 4)) * 100 + "%" }}
        />
      </div>
    </div>
  );
}
function PianoRoll({
  song,
  track,
  selected,
  select,
  snap,
  disabled,
  command,
}: {
  song: Song;
  track: Track;
  selected: string[];
  select: (s: Selection) => void;
  snap: number;
  disabled: boolean;
  command: (cmd: MusicCommand) => Promise<void>;
}) {
  const instrument = INSTRUMENTS[track.instrumentId],
    hit = instrument.kind === "hit",
    low = instrument.minMidi ?? 48,
    high = instrument.maxMidi ?? 48,
    rows = hit ? 1 : high - low + 1,
    total = song.music.bars * 4,
    width = Math.max(800, total * 48),
    height = hit ? 64 : rows * 14;
  const drag = useRef<{
      x: number;
      y: number;
      note: Note;
      resize: boolean;
    } | null>(null),
    [draft, setDraft] = useState<Note | null>(null);
  const coordinates = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * total,
      y: Math.max(
        low,
        Math.min(
          high,
          high - Math.floor(((e.clientY - rect.top) / rect.height) * rows),
        ),
      ),
    };
  };
  return (
    <div className="roll-scroll">
      <svg
        aria-label={hit ? "Drum step editor" : "Piano roll"}
        className="piano-roll"
        width={width}
        height={height}
        viewBox={"0 0 " + width + " " + height}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          const p = coordinates(e),
            start = frac(Math.floor(p.x * snap), snap),
            existing = (e.target as SVGElement).getAttribute("data-id");
          const note = track.notes.find((n) => n.id === existing);
          if (note) {
            select({
              kind: "notes",
              noteIds: e.shiftKey
                ? [...new Set([...selected, note.id])]
                : [note.id],
            });
            if (hit) {
              void command({ type: "delete_notes", noteIds: [note.id] });
              return;
            }
            drag.current = {
              x: p.x,
              y: p.y,
              note,
              resize:
                (e.target as SVGElement).getAttribute("data-resize") === "true",
            };
            setDraft(note);
            e.currentTarget.setPointerCapture(e.pointerId);
          } else {
            void command({
              type: "add_note",
              trackId: track.id,
              pitch: hit ? null : midiToPitch(p.y),
              start,
              duration: frac(1, snap),
            });
          }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = coordinates(e),
            d = drag.current,
            delta = frac(Math.round((p.x - d.x) * snap), snap);
          if (d.resize) {
            const duration = add(d.note.duration, delta);
            if (value(duration) > 0) setDraft({ ...d.note, duration });
          } else
            setDraft({
              ...d.note,
              start: add(d.note.start, delta),
              ...(d.note.kind === "pitched"
                ? { pitch: midiToPitch(pitchToMidi(d.note.pitch)! + p.y - d.y) }
                : {}),
            });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && draft) {
            const changed = JSON.stringify(d.note) !== JSON.stringify(draft);
            setDraft(null);
            if (changed)
              void command({
                type: "edit_note",
                noteId: d.note.id,
                pitch: draft.kind === "pitched" ? draft.pitch : null,
                start: draft.start,
                duration: draft.duration,
              });
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <g key={i}>
            <rect
              x="0"
              y={(i * height) / rows}
              width={width}
              height={height / rows}
              fill={
                !hit && [1, 3, 6, 8, 10].includes((high - i) % 12)
                  ? "#111522"
                  : "#1c2132"
              }
            />
            {!hit && (
              <text x="3" y={i * 14 + 11} fill="#7580a0" fontSize="9">
                {midiToPitch(high - i)}
              </text>
            )}
          </g>
        ))}
        {Array.from({ length: total * snap + 1 }, (_, i) => (
          <line
            key={i}
            x1={(i * width) / (total * snap)}
            x2={(i * width) / (total * snap)}
            y1="0"
            y2={height}
            stroke={
              i % (snap * 4) === 0
                ? "#5a557a"
                : i % snap === 0
                  ? "#363e58"
                  : "#262c40"
            }
          />
        ))}
        {track.notes.map((original) => {
          const n = draft?.id === original.id ? draft : original,
            x = (value(n.start) / total) * width,
            w = Math.max(5, (value(n.duration) / total) * width),
            y = hit
              ? 12
              : (high - pitchToMidi(n.kind === "pitched" ? n.pitch : "C4")!) *
                14;
          return (
            <g key={n.id}>
              <rect
                data-id={n.id}
                x={x}
                y={y}
                width={w}
                height={hit ? 40 : 13}
                rx="2"
                fill={selected.includes(n.id) ? "#d7caff" : "#8d74da"}
              />
              {!hit && (
                <rect
                  data-id={n.id}
                  data-resize="true"
                  x={x + w - 5}
                  y={y}
                  width="5"
                  height="13"
                  fill="#efe5ff"
                  cursor="ew-resize"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
