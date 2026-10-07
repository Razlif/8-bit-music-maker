# Running CHIP Studio

1. Install Node.js 22.16+ and run `npm install` in the project directory.
2. Copy `.env.example` to `.env`; leave `AI_PROVIDER=openai` for OpenAI, or choose `openrouter`/`anthropic` and set that provider's API key, or choose `claude-subscription` to use a logged-in Claude Code CLI with no API key.
3. Run `npm run build` after code changes.
4. Run `npm start` and open http://127.0.0.1:3001.

For development use `npm run dev` and http://127.0.0.1:5173 instead. Regular startup does not rebuild, run Git, or recover old traces.

The opening screen offers New demo and saved demos. Refresh only returns to the library; it does not create a file. New names are Untitled N. Music is saved automatically into one JSON file per demo under `songs/`. Rename in the header, duplicate in Library, and export WAV from the transport row. Reset is destructive to the current saved music; copy a demo first if you want to keep it.

In the timeline, drag to mark an editing region. Click inside the highlighted region, or press Escape, to release it and return to Whole song. The selected region is also sent to the dispatcher as `UI_SELECTION` advisory context; it is not a hard AI boundary yet. Snap affects piano-roll creation, movement, and resizing only; it is measured as positions per beat and does not alter existing notes or AI output.

Provider settings: `AI_PROVIDER`, optional common `AI_ORCHESTRATOR_MODEL` and `AI_COMPOSER_MODEL`, plus the provider-specific API keys and model defaults in `.env.example`. `OPENAI_API_KEY` is still required for browser dictation. Other optional settings are `PORT`, `SONGS_DIR`, and `RUN_TIMEOUT_MS`. Keep `.env` private. No database or Git executable is needed to run the application.

Live companion updates are not written to disk. A restart clears request status; only completed song changes remain.
