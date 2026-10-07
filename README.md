# CHIP Studio

A local music demo maker with a retro pixel-art interface. Describe the music you want, listen, refine it, and export a WAV. Includes editable tracks, an instrument catalog, an animated companion, and an Effects Maker for short sound effects.

## Install and run

You need **Node.js 22.16 or newer**, npm (included with Node), and an API key for OpenAI, OpenRouter, or Anthropic to generate music.

```sh
git clone https://github.com/Razlif/8-bit-music-maker.git
cd 8-bit-music-maker
npm install
```

Copy `.env.example` to `.env` in the project folder:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

Open `.env` in a text editor. For OpenAI, set:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
```

Model defaults are in `.env.example`. To choose your own models, set `AI_ORCHESTRATOR_MODEL` for the composer that plans the arrangement and `AI_COMPOSER_MODEL` for its workers and effects. Use model IDs available to your provider account.

For another provider, set `AI_PROVIDER=openrouter` with `OPENROUTER_API_KEY`, or `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`. You only need the key for your chosen provider.

To use a **Claude subscription** (Pro/Max) instead of an API key, install [Claude Code](https://claude.com/claude-code), run `claude` once and log in, then set `AI_PROVIDER=claude-subscription`. The server calls the local `claude` CLI, so no key is needed; usage counts against your subscription limits. Microphone transcription additionally requires an OpenAI key.

Build and start:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Keep the terminal running while using the app. On subsequent launches, run `npm start`; rebuild after updating the code. Restart the server after changing `.env`.

## Make a demo

1. Create a **New demo** or load a saved song.
2. Set the number of bars and enter a request, such as “An eight-bar reggae groove with a warm bass and playful melody.”
3. Click the cassette to compose. The companion displays progress and available model reasoning summaries.
4. Play the music, adjust track volumes, change instruments, or edit notes.
5. Ask for revisions, then export a WAV with the floppy-disk button.

To start from written music, click **Upload sheet music (PDF)** under the request box and send. The AI reads the opening of the score (as many bars as the song has, re-barred to 4/4) and writes each part onto a track. Add a request to change how it is played, or leave the box empty to transcribe it as written. Note reading is done by the AI model, so check the result against the page; dense or scanned scores are less reliable. PDFs up to 10 MB.

To edit just part of a song, select a track or highlight an area before submitting your request. The AI receives the full song for context, but only changes inside your selection are saved. Click inside the selection or press Escape to clear it and return to the whole song.

Existing notes crossing a selection boundary stay intact. New notes are clipped to the available selected space. Partial edits preserve other tracks, instruments, mix settings, and the song's key and tempo.

The **Rhythm output** control offers two experimental ways for the AI to describe rhythm: JSON events and compact notation. Both use the same playback engine. Try either with the same request on separate songs.

The **Effects Maker** tab generates short sound effects you can play and export. **Instrument Lab** lets you audition the available sounds.

## Saving your work

Songs save automatically as individual JSON files in `songs/`. Rename a song by clicking its title. The library supports loading and duplicating songs; refreshing the page does not create another song.

Back up the `songs/` folder to keep your demos. Your `.env` and saved songs are ignored by Git. No database or cloud storage is required. AI requests go to your selected provider and use its API billing.

## Troubleshooting

- **Page does not open:** keep `npm start` running and check its terminal output. The default port is 3001.
- **AI request fails:** check your provider, key, model IDs, and available API credit, then restart the server.
- **UI changes are missing:** run `npm run build`, restart, and reload the page.
- **No microphone transcription:** add `OPENAI_API_KEY` and allow microphone access, or type your request.

Manual editing and playback work without an API key.

## For developers

Run `npm run dev` for automatic reloads, then open http://127.0.0.1:5173. Run `npm test` and `npm run typecheck` to check changes.

The app uses React/Vite, a Node/Fastify backend, LangGraph.js for orchestration, and Tone.js for audio. The AI plans tasks per track; rhythm workers create timing, pitch workers fill melodic notes, and the backend builds chords, validates the result, and applies the selected area.

Additional references: [running and troubleshooting](RUNNING.md), [AI prompts](AI-PROMPTS.md), [music language](LANGUAGE-TUTORIAL.md), and [product specification](SPEC.md). The roadmap and implementation status are development records; you do not need them to use the app. Worker tutorials in `apps/server/src/skills/` are loaded into AI prompts at runtime.
