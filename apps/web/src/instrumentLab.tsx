import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Tone from "tone";
import { INSTRUMENTS, listInstruments, type Instrument, type Note, type Track } from "@eight-bit/core";
import { createInstrumentVoice, type InstrumentVoice } from "./instrument-voices.js";
import "./instrument-lab.css";

type Example = "note" | "phrase" | "chord" | "beat";
type Review = "keep" | "maybe" | "reject";
type PreviewEvent = {
  at: number;
  duration: number;
  velocity: number;
  kind: "pitched" | "hit";
  pitch?: string;
};
type ActivePreview = {
  timer: number;
  voice: InstrumentVoice;
  master: Tone.Gain;
  limiter: Tone.Limiter;
};

const REVIEW_KEY = "chip-studio.instrument-review.v1";
const catalog = listInstruments(true);

function note(pitch: string, at: number, duration: number, velocity = 104): PreviewEvent {
  return { kind: "pitched", pitch, at, duration, velocity };
}
function hit(at: number, duration = 0.06, velocity = 104): PreviewEvent {
  return { kind: "hit", at, duration, velocity };
}
function examples(instrument: Instrument, example: Example): PreviewEvent[] {
  if (instrument.kind === "hit" || example === "beat") {
    return [0, 0.5, 1, 1.5, 2.5, 3].map((at, i) => hit(at, instrument.id === "crash" ? 0.55 : undefined, i % 2 ? 82 : 112));
  }
  if (example === "note") return [note("C4", 0, 0.8), note("C5", 1.1, 0.4)];
  if (example === "chord") {
    return [
      note("C4", 0, 1.35), note("E4", 0, 1.35), note("G4", 0, 1.35),
      note("A3", 1.65, 1.1), note("C4", 1.65, 1.1), note("E4", 1.65, 1.1),
    ];
  }
  if (example === "phrase") {
    return [
      note("C4", 0, 0.22), note("E4", 0.28, 0.22), note("G4", 0.56, 0.3),
      note("B4", 1.0, 0.2), note("G4", 1.28, 0.2), note("E4", 1.56, 0.36),
      note("D4", 2.15, 0.22), note("F4", 2.43, 0.22), note("A4", 2.71, 0.36),
      note("G4", 3.35, 0.5),
    ];
  }
  return [note("C4", 0, 0.42), note("G4", 0.62, 0.42), note("C5", 1.24, 0.42)];
}

function previewNote(event: PreviewEvent, id: string): Note {
  if (event.kind === "hit") {
    return {
      id,
      kind: "hit",
      start: { n: 0, d: 1 },
      duration: { n: 1, d: 1 },
      velocity: event.velocity,
    };
  }
  return {
    id,
    kind: "pitched",
    pitch: event.pitch ?? "C4",
    start: { n: 0, d: 1 },
    duration: { n: 1, d: 1 },
    velocity: event.velocity,
  };
}

function instrumentTrack(instrument: Instrument, example: Example): Track {
  return {
    id: `preview-${instrument.id}`,
    name: instrument.name,
    type: example === "chord" && instrument.kind === "pitched" ? "harmonic" : "melodic",
    instrumentId: instrument.id,
    instrumentVersion: 1,
    volumeDb: -9,
    muted: false,
    notes: [],
  };
}

function InstrumentLab() {
  const [filter, setFilter] = useState<"all" | Instrument["kind"] | "candidate" | "production" | "retired">("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [lastExample, setLastExample] = useState<Example>("phrase");
  const [active, setActive] = useState<ActivePreview | null>(null);
  const activeRef = useRef<ActivePreview | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(REVIEW_KEY);
      if (stored) setReviews(JSON.parse(stored) as Record<string, Review>);
    } catch {
      // A failed local review file should never prevent the sound lab from opening.
    }
    return () => {
      const current = activeRef.current;
      if (current) {
        window.clearTimeout(current.timer);
        current.voice.dispose();
        current.master.dispose();
        current.limiter.dispose();
        activeRef.current = null;
      }
    };
  }, []);

  const stop = () => {
    const current = activeRef.current;
    if (current) {
      window.clearTimeout(current.timer);
      current.voice.dispose();
      current.master.dispose();
      current.limiter.dispose();
      activeRef.current = null;
      setActive(null);
    }
    setPlaying(null);
  };

  const play = async (instrument: Instrument, example: Example) => {
    await Tone.start();
    stop();
    setLastExample(example);
    const sequence = examples(instrument, example);
    const limiter = new Tone.Limiter(-1).toDestination();
    const master = new Tone.Gain(0.48).connect(limiter);
    const track = instrumentTrack(instrument, example);
    const voice = createInstrumentVoice(track, master);
    const start = Tone.now() + 0.05;
    for (const [index, event] of sequence.entries()) {
      voice.trigger(previewNote(event, `${instrument.id}-${index}`), event.duration, start + event.at);
    }
    const length = Math.max(...sequence.map((event) => event.at + event.duration)) + 0.45;
    const timer = window.setTimeout(stop, length * 1000);
    const nextActive = { timer, voice, master, limiter };
    activeRef.current = nextActive;
    setActive(nextActive);
    setPlaying(`${instrument.id}:${example}`);
  };

  const review = (id: string, value: Review) => {
    const next = { ...reviews, [id]: value };
    setReviews(next);
    localStorage.setItem(REVIEW_KEY, JSON.stringify(next));
  };

  const exportReview = () => {
    const blob = new Blob([JSON.stringify(reviews, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "instrument-review.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const visible = useMemo(
    () => catalog.filter((instrument) => {
      if (filter === "all") return true;
      if (filter === "candidate") return instrument.availability === "candidate";
      if (filter === "production") return instrument.availability !== "candidate" && instrument.availability !== "retired";
      if (filter === "retired") return instrument.availability === "retired";
      return instrument.kind === filter;
    }),
    [filter],
  );

  return (
    <main className="lab-shell">
      <header className="lab-header">
        <div>
          <a className="lab-back" href="/">◂ Back to Chip//Studio</a>
          <p className="lab-eyebrow">CHIP//STUDIO · INSTRUMENT LAB</p>
          <h1>Find the sound.</h1>
          <p className="lab-subtitle">Audition the catalog with the same voices used by song playback.</p>
        </div>
        <button className="stop-button" onClick={stop} disabled={!playing}>■ Stop</button>
      </header>

      <section className="lab-toolbar" aria-label="Instrument audition controls">
        <div className="lab-filters">
          {(["all", "production", "candidate", "retired", "pitched", "hit"] as const).map((value) => (
            <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>
              {value === "all" ? "All sounds" : value === "hit" ? "Percussion" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <span className="last-audition">Last audition: <b>{lastExample}</b></span>
        <button onClick={exportReview}>Export review JSON</button>
      </section>

      <div className="lab-grid">
        {visible.map((instrument) => {
          const state = reviews[instrument.id];
          const isPlaying = playing?.startsWith(`${instrument.id}:`);
          return (
            <article className={`instrument-card ${state ?? ""}`} key={instrument.id}>
              <div className="instrument-card-top">
                <div>
                  <span className="instrument-family">{instrument.kind === "hit" ? "PERCUSSION" : "PITCHED"}</span>
                  <h2>{instrument.name}</h2>
                </div>
                <span className={`catalog-badge ${instrument.availability ?? "production"}`}>
                  {instrument.availability === "candidate" ? "CANDIDATE" : instrument.availability === "retired" ? "RETIRED" : "IN USE"}
                </span>
              </div>
              <p>{instrument.description}</p>
              <div className="audition-buttons">
                <button className={isPlaying && lastExample === "note" ? "playing" : ""} onClick={() => void play(instrument, "note")}>♪ Note</button>
                <button className={isPlaying && lastExample === "phrase" ? "playing" : ""} onClick={() => void play(instrument, "phrase")}>♫ Phrase</button>
                <button className={isPlaying && lastExample === "chord" ? "playing" : ""} disabled={instrument.kind === "hit"} onClick={() => void play(instrument, "chord")}>▦ Chord</button>
                <button className={isPlaying && lastExample === "beat" ? "playing" : ""} onClick={() => void play(instrument, "beat")}>▥ Beat</button>
              </div>
              <div className="review-buttons" aria-label={`Review ${instrument.name}`}>
                {(["keep", "maybe", "reject"] as const).map((value) => (
                  <button key={value} className={state === value ? "reviewed" : ""} onClick={() => review(instrument.id, value)}>
                    {value === "keep" ? "★ Keep" : value === "maybe" ? "○ Maybe" : "× Reject"}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="lab-footer">Reviews stay in this browser until you export them. Candidate sounds are not exposed to the composer.</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<InstrumentLab />);
