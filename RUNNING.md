# Run the studio

Requires Node.js 22.16+ (tested with Node 24) and Git on PATH.

```powershell
npm install
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Stop with Ctrl+C. For development, run `npm run dev` and open **http://127.0.0.1:5173**. If you edit shared core source during development, rebuild it with `npm run build:core`.

## Environment

Copy `.env.example` to `.env` in the repository root without overwriting an existing file. The server loads it in development and production; restart after changes. Existing process variables take precedence.

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_ORCHESTRATOR_MODEL=gpt-6-luna
OPENAI_COMPOSER_MODEL=gpt-5-nano
SONGS_DIR=
PORT=3001
RUN_TIMEOUT_MS=180000
```

Only the key is required for AI. Without it, manual editing, mixing, playback, history and export work, and the composer button is disabled. Never prefix secrets with `VITE_`.

`OPENAI_ORCHESTRATOR_MODEL` controls the whole-song dispatcher and defaults to GPT-6 Luna. `OPENAI_COMPOSER_MODEL` controls rhythm and pitch workers and defaults to GPT-5 nano. `OPENAI_CLASSIFIER_MODEL` is obsolete and ignored. AI composition always uses whole-song scope in this demo; the dispatcher fans out one-track tasks, then workers return rhythm/pitch data and the backend saves one validated update. The UI shows worker activity and trace details; there is no proposal/A-B stage in the active AI path.

Blank `SONGS_DIR` means the repository's `songs/` directory. Relative overrides resolve against the repository root. The earlier prototype used `apps/server/songs/`; those files have not been moved or modified. Set `SONGS_DIR=apps/server/songs` to reopen that library. Do not run two servers against one library.

Keep `PORT=3001` for development: Vite's proxy targets that port. Production supports a different port. The run deadline accepts 1,000–600,000 milliseconds.

## Editing and listening

- New songs start with four **empty** tracks. Draw notes in the piano roll or click percussion steps, then Play. Drag a note to move it or its right edge to resize it. Shift-click overview notes for a disjoint selection.
- Drag a lane for a passage, several lanes for a rectangle, or the ruler for all tracks. Click a track name for whole-track scope. Whole song / Escape visibly reset scope. Notes crossing a passage boundary remain protected unless selected in full.
- Faders affect sound immediately and persist once per gesture. Mute is saved; Solo is transient and excluded from export. Snap affects new edits, not existing off-grid rhythms. Key label changes metadata only; + Octave transposes selected notes.
- Each composer request is independent. AI composition is authorized for the whole song, regardless of the manual selection shown in the UI. The dispatcher narrows work into one-track/bar tasks; multiple new tracks are allowed when musically needed. The result is validated and saved as one update. Manual selections remain available for direct editing and playback.
- History / undo restores an earlier version as a new revision. Export WAV downloads **accepted music** with saved mix levels: 44.1 kHz, 16-bit stereo, one loop, 5 ms edge fades, no appended tail.

## Verification

AI activity now receives live provider-supplied reasoning summaries and partial output via streaming. Summaries are optional, not raw internal thoughts, and may require OpenAI organization verification. The full trace retains received text if interrupted. Partial output is never playable/accepted until validation succeeds. The prompt/repair changes and diagnosis of the latest timeout are explained in plain English at the top of [AI-PROMPTS.md](AI-PROMPTS.md). Restart the server after building; existing `.env` settings work unchanged.

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run eval:live
```

Browser tests use a temporary library and no paid API calls. Live evaluation makes ten runs only when a key exists; outputs, repairs, timings and usage go into ignored `.local/evals/`. No key reports `LIVE_EVAL_PENDING`. Listening is still required: valid music data is not proof of good composition.

## Recovery

Saves validate before atomic replacement, serialize concurrent writes and reject stale revisions. A failed Git commit after a successful save is **history pending**, not a failed save. Retry history finishes the same revision; startup retries interrupted history. Previous canonical JSON is retained in each song's `.local/previous.json`, and accepted revisions are in its own Git repository.

The library's `.library.lock` prevents simultaneous servers. After a crash, inspect its PID and confirm no server owns that library before removing **that exact lock file**. Never remove a live lock. Invalid songs are shown as unavailable and never automatically overwritten: preserve the invalid file and recover from Git/previous snapshot before reopening. Automated UI repair of a corrupt document is not implemented.

Run logs in each song's `.local/` now contain the starting song, exact prompts/output schemas, visible model responses, timing, usage and validation diagnostics—not API keys or hidden reasoning. They are sensitive local files; review before sharing. Interrupted runs are marked interrupted on restart and are never silently resumed. Open **AI activity → Inspect prompts and run trace** to inspect them. See [AI-PROMPTS.md](AI-PROMPTS.md) for the prompt templates, data placeholders, model access and repair process. No extra environment variables are needed. Restart the server after rebuilding to enable the new tracing routes; old logs cannot recover previously uncaptured responses.
