# 8-bit Music Maker

**Start here:** [Run the UI, configure `.env`, and use the editor](RUNNING.md). See [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for verification evidence and pending live-model gates.

**Inspect the AI:** [Exact prompt templates, supplied data, model access and trace debugging](AI-PROMPTS.md). The UI's AI activity panel shows independent progress and locally saved request/response traces.

A local chiptune studio for making music with an agent: describe a song, listen, select a passage, and refine it through conversation or direct note editing.

The demo includes up to eight instrument tracks, a visual timeline and note editor, browser playback, one validated AI composition update, WAV export, and local project files tracked with Git. A fresh song starts with six empty channels—lead, bass, kick, hi-hat, snare, and harmonic Chip Pad. Broad song-creation requests compose all six; requests for specific instrumentation leave the others empty. Live OpenAI musical quality remains a separate evaluation gate.

The initial meter is 4/4. Weighted beat rows express equal subdivisions, long–short rhythms, rests, and sustained notes. Every track has manual volume, mute, and solo controls for mixing during playback.

## Specification

Start with [ROADMAP.md](ROADMAP.md) for the execution handoff: 11 ordered implementation slices, shared contracts, code sketches, defaults, verification gates, and edge cases. It is written for a coding agent with no conversation history.

See [SPEC.md](SPEC.md) for product requirements: UI, musical notation, deterministic editing contracts, request orchestration, persistence, and acceptance criteria.

Read [LANGUAGE-TUTORIAL.md](LANGUAGE-TUTORIAL.md) for the syntax and playable audio examples, generated directly from the notation.

The agent works with beat-grouped musical grids and instrument presets. Deterministic backend workers translate and validate one aggregate update before saving it. LangGraph coordinates independent requests; the accepted song provides persistent musical context.

## Editing scope

Select a horizontal passage on one track, a vertical time slice across tracks, a rectangular region, a single note, or selected notes. Full-track and whole-song edits are also supported.

Every agent request clearly separates **the requested task**, **backend-issued edit permissions**, and **read-only reference context**. Surrounding beats, other instruments, harmony, and guidance can help the model without becoming editable. Showing or returning a complete beat does not give permission to change everything inside it.

The backend validates the actual musical changes against stable event IDs, allowed time regions, writable fields, and explicit insertion/deletion rights. It preserves protected notes, silence, timing, and mix settings; rejects an entire out-of-scope proposal; and checks the song revision again before acceptance. Notes crossing a time-selection boundary stay protected unless the user explicitly includes them. Any required scope expansion is made visible for user approval.

See SPEC.md section 7 for the context contract, boundary rules, output modes, and validation examples.

Implementation stack: TypeScript throughout; LangGraph.js and Fastify on a local Node.js backend; React, Vite, and Tone.js in the browser. The dispatcher defaults to GPT-6 Luna via `OPENAI_ORCHESTRATOR_MODEL`; rhythm and pitch workers default to GPT-5 nano via `OPENAI_COMPOSER_MODEL`. There is no intent classifier or chat-answer route. Every AI request uses one graph: whole-song context → explicit per-track tasks → bounded rhythm workers → deterministic percussion or pitch workers → one validated aggregate update. The UI selection remains available for manual editing/playback but does not narrow AI composition in the demo. See [AI-PROMPTS.md](AI-PROMPTS.md) for the current contract.

## Future experiments

Jev (TypeSafe) could select coordinated rhythmic patterns from a curated library, with a generative model composing pitches and phrase variations. Small pitch-contour patterns may also be useful. This is deferred from the demo; measure musical quality and end-to-end latency against the initial implementation before adding it. OpenRouter support is another possible later extension.

## Local song library

The planned app creates a `songs/` directory under the application root on first launch. No database is required. The library sidebar lists song titles and last-modified times, with New, Open, Rename, and Duplicate actions. One song is open at a time.

Each song lives in `songs/<song-uuid>/`, with one authoritative `song.json`, a generated readable `song.txt`, and its own local Git history. The application repository ignores `songs/`, so user music is separate from application code. Renaming changes the title, not the folder or ID; duplicating creates an independent song and history. An optional backend setting can point to another library directory.

The song document stores format version, stable identity, timestamps, edit revision, brief, musical settings, tracks, saved mix levels, and notes with exact fractional timing. Saves are validated and atomic; accepted changes are committed locally. Git failures are reported separately from file-save success. See SPEC.md section 10 for storage, recovery, and library behavior.

## Status

The implementation is underway. Follow [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for verified slices, pending gates, and known limitations. The existing audio examples are deterministic demonstrations, not evidence of model composition quality.
