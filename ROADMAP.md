# CHIP Studio — maintenance roadmap

The original implementation roadmap is complete enough for the current demo. This file now tracks only work that belongs after publication.

## Before publishing

- Run `npm install`, `npm run typecheck`, `npm run build`, `npm test`, and the browser tests.
- Copy `.env.example` to `.env` locally and verify the no-key manual workflow as well as one AI request with a valid key.
- Confirm that `songs/` and `song-archives/` remain ignored and that no API key, generated WAV, or temporary file is staged.
- Listen to representative lead, bass, drum, harmony, and effects examples in a real browser.

## Small follow-ups

- Add an explicit import/export action for a single JSON demo file if moving demos between machines becomes useful.
- Add a small “copy demo file path” affordance if local file management becomes a recurring task.
- Split the Tone.js instrument bundle if initial page load becomes a problem on slower machines.
- Add more catalog presets only after listening tests show a useful sound that is distinct from the existing library.

## Deferred product ideas

Sections, arrangement timelines, richer effects synthesis, advanced rhythm notation, and external Suno handoff can be added after the demo workflow proves useful. They should not complicate the current one-file song model or the simple Load/New opening screen until there is a concrete use case.
