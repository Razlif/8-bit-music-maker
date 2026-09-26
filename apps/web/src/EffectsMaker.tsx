import { useEffect, useRef, useState } from "react";
import { DictationButton } from "./DictationButton";
import { EffectPlayer, exportEffectWav, type EffectRecipe } from "./effects";

const examples = [
  { label: "Explosion", prompt: "A punchy 8-bit explosion with a noisy burst and a falling low boom." },
  { label: "Horn", prompt: "A short arcade victory horn with a brassy two-note fanfare." },
  { label: "Jump", prompt: "A cheerful power-up jump sound that rises quickly." },
  { label: "Magic sparkle", prompt: "A bright magical sparkle with three ascending twinkles." },
];

async function requestRecipe(instruction: string) {
  const response = await fetch("/api/effects/recipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? data.code ?? "Effect request failed");
  return data as { recipe: EffectRecipe; source: "ai" | "example" };
}

export function EffectsMaker({ onActivity }: { onActivity: (activity: { scene: "idle" | "keyboard" | "dance" | "repairing"; speech: string }) => void }) {
  const [prompt, setPrompt] = useState(examples[3].prompt);
  const [recipe, setRecipe] = useState<EffectRecipe | null>(null);
  const [source, setSource] = useState<"ai" | "example" | null>(null);
  const [status, setStatus] = useState("Ready to make a sound.");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef(new EffectPlayer());
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    onActivity({ scene: error ? "repairing" : generating ? "keyboard" : playing ? "dance" : "idle", speech: error || status });
  }, [error, generating, playing, status, onActivity]);

  useEffect(() => () => {
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    player.current.stop();
  }, []);

  const stop = () => {
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    player.current.stop();
    setPlaying(false);
    setStatus("Stopped.");
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    stop();
    setGenerating(true);
    setError("");
    setStatus("Designing the effect…");
    try {
      const result = await requestRecipe(prompt.trim());
      setRecipe(result.recipe);
      setSource(result.source);
      setStatus(result.source === "ai" ? "AI recipe ready." : "Example recipe ready.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("The effect needs another pass.");
    } finally {
      setGenerating(false);
    }
  };

  const play = async () => {
    if (!recipe) return;
    try {
      await player.current.play(recipe);
      setPlaying(true);
      setStatus("Playing effect.");
      stopTimer.current = window.setTimeout(() => {
        setPlaying(false);
        setStatus("Ready to play again.");
      }, recipe.durationMs + 260);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const download = async () => {
    if (!recipe) return;
    try {
      setStatus("Rendering WAV…");
      const blob = await exportEffectWav(recipe);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = (recipe.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "effect") + ".wav";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("WAV exported.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="effects-maker" aria-labelledby="effects-title">
      <div className="effects-heading">
        <div>
          <span className="eyebrow">SFX//LAB · LOCAL</span>
          <h2 id="effects-title">Effect Maker</h2>
        </div>
        <p>Describe a tiny game sound. The AI writes a safe recipe; Tone.js renders it deterministically.</p>
      </div>
      <div className="effect-examples" aria-label="Effect examples">
        <span>Try one:</span>
        {examples.map((example) => (
          <button key={example.label} type="button" onClick={() => setPrompt(example.prompt)}>
            {example.label}
          </button>
        ))}
      </div>
      <div className="request-line effect-request-line">
        <textarea
          aria-label="Effect request"
          value={prompt}
          disabled={generating}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="Make a magical sparkle…"
        />
        <div className="request-action">
          <DictationButton value={prompt} onChange={setPrompt} disabled={generating} />
          <button className="primary effect-generate" type="button" disabled={generating || !prompt.trim()} onClick={() => void generate()}>
            {generating ? "Making…" : "Generate"}
          </button>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="effect-status" role="status" aria-live="polite">{status}</div>
      {recipe ? (
        <article className="effect-recipe">
          <div className="effect-recipe-head">
            <div>
              <span className="eyebrow">RECIPE READY</span>
              <h3>{recipe.name}</h3>
            </div>
            <span className="recipe-source">{source === "ai" ? "AI GENERATED" : "LOCAL EXAMPLE"}</span>
          </div>
          <p>{recipe.description}</p>
          <code>{recipe.voices.length} layers · {recipe.durationMs} ms · deterministic Tone.js render</code>
          <div className="effect-actions">
            <button type="button" className="play" onClick={() => (playing ? stop() : void play())}>
              {playing ? "■ Stop" : "▶ Play"}
            </button>
            <button type="button" disabled={generating} onClick={() => void generate()}>Regenerate</button>
            <button type="button" onClick={() => void download()}>Export WAV</button>
          </div>
        </article>
      ) : (
        <div className="effect-empty">Your generated recipe will appear here.</div>
      )}
    </section>
  );
}
