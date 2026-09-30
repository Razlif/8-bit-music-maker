# CHIP Studio — current product specification

CHIP Studio is a local browser tool for making short retro music demos. The user describes an idea, the AI composes a song through the LangGraph.js pipeline, and the user listens, edits, mixes, and exports the result for further production in another tool.

## Product boundary

- The app is a demo maker, not a full DAW or a general-purpose agent harness.
- The music UI provides whole-song context plus `UI_SELECTION` to the AI. At save time, the backend trims the completed arrangement to the original selection. Out-of-selection changes are discarded, not rejected. Whole-song updates pass through normally. Partial selections preserve global metadata, track settings, and existing notes crossing their boundaries; generated notes are clipped to free selected spans. Individual selected chord voices retain the timing of protected sibling voices. Traces record `selection_applied` with generated and applied diffs.
- The Effects Maker is a separate deterministic Tone.js surface.
- There is no chat history, account system, database, collaboration layer, Git song history, or persistent AI run log.

## Current music model

The canonical song is a validated TypeScript object serialized as one JSON file at `songs/<uuid>.json`. It contains the song identity and title, timestamps, revision, BPM, meter, bar count, tracks, instruments, mix settings, notes, and harmonic events. Notes use rational beat positions and durations, stable IDs, pitches or percussion hits, and velocity. The file is the only song persistence authority.

The server writes atomically and checks the expected revision before replacing a file. A stale or externally changed file is rejected instead of overwritten. New files are named `Untitled 1`, `Untitled 2`, and so on. Loading and refreshing never create files. Duplicate creates a new song identity with new track and note IDs.

The default song has six empty tracks: Lead, Bass, Kick, Hi-Hat, Snare, and Harmony. A track has an editable display name, an independently selectable catalog instrument, melodic or harmonic type, volume, mute/solo state, and notes. Instrument swaps preserve notes and reject incompatible pitch or percussion data.

## AI composition

The request enters a LangGraph.js graph. An orchestrator sees the song and user request, then creates one task per track and returns a root-only tonal-center key or `null`. After successful composition, that key is stored in song metadata; it does not trigger a second transposition pass. If the song already has a key, the orchestrator receives it as the current tonal center and preserves it unless the user explicitly asks for a new one. The UI can deterministically transpose all pitched notes when changing an existing key; drums, rhythm, durations, mix, and structure remain unchanged. Each task contains explicit track identity, bar range, rhythm instructions, pitch or chord instructions, instrument, and harmony context. The studio lets the user select either weighted JSON event output or compact `x / - / .` rhythm notation. Both are normalized by the server to the same weighted attack/hold/rest event sequence before pitch filling. Both support equal subdivisions, one-beat triplets, swing ratios, and three attacks across two beats using a hold across beat rows. Pitch workers fill melodic rhythms. Harmonic tracks use a structured chord progression and deterministic chord realization. Arpeggios remain melodic tracks. The orchestrator should vary tonal centers, registers, density, and subdivisions when the request is open-ended. A task's register is advisory; the instrument's actual playable range remains the hard safety boundary, with nearby-octave fallback for valid chords.

The backend validates every model result against the original song snapshot before one save. It owns notation parsing, instrument compatibility, timing bounds, chord boundaries, monophony/polyphony rules, and revision checks. Model summaries can stream to the companion during the live request; they are memory-only and are lost on server restart.

## Editing and selection

The timeline supports rectangular time/track selection for direct editing and loop playback. A drag creates a region. A plain click inside the active region clears it and returns the visible scope to Whole song. Escape does the same. A selected note can be toggled; removing the last selected note returns to Whole song.

Piano-roll Snap is an editing aid. The values mean positions per beat: `1/8` = 2, Triplet = 3, `1/16` = 4, Sixteenth triplet = 6, and `1/32` = 8. Snap affects newly drawn notes and manual moves/resizes. It does not rewrite existing timing and does not constrain AI-generated rhythms.

## Audio and export

Tone.js renders the active instrument catalog in the browser. Playback loops the song or selected region, applies live mix changes, and drives the transport, VU meters, and spectrum display. WAV export renders the current song and mix using the editable song title.

## Effects Maker

An effect request produces a validated recipe of deterministic tone and noise layers. The recipe supports duration, timing, waveform, pitch sweeps, gain envelopes, pan, filter sweeps, resonance, and vibrato. Tone.js renders it for repeatable Play, Stop, Regenerate, and WAV export. The companion remains visible in this mode.

## Run and configuration

Use Node.js 22.16+, `npm install`, `npm run build`, and `npm start`. Development uses `npm run dev`. `AI_PROVIDER` selects OpenAI, OpenRouter, or Anthropic for composition and effect recipes; the matching provider key and model settings are in `.env.example`. `OPENAI_API_KEY` additionally enables server transcription. `PORT`, `SONGS_DIR`, and `RUN_TIMEOUT_MS` are optional settings. See README.md and RUNNING.md for the user workflow.
