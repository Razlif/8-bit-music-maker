# AI prompt contract

The demo is not a chat interface and has no intent-classification stage. A request is translated into music by one LangGraph run and produces one validated song update.

## Live request path

```text
HTTP request
  → resolve whole-song scope
  → dispatcher/orchestrator
  → validate per-track task plan
  → rhythm workers (bounded waves of four)
  → deterministic percussion, block-chord realization, or melodic pitch workers
  → aggregate candidate
  → validate against the original revision
  → save one update
```

The UI's marked selection is still used for manual editing and playback. For the demo, AI composition always sends and resolves `{ "kind": "song" }`; a selected bar cannot accidentally create a partial AI scope.

## Dispatcher prompt

The dispatcher receives, in this order:

1. Its role: translate the request into composition tasks, not notation.
2. `SONG_CONTEXT`: title, brief, bars, meter, tempo, key, and a compact per-track/per-bar overview.
3. `INSTRUMENT_CATALOG`: the complete current preset list, including pitched/hit kind and range.
4. `USER_REQUEST`.
5. Task rules: one track per task, `type` is `melodic` or `harmonic`, valid bar ranges, contiguous sections, separate rhythm and pitch instructions, optional harmony/register direction, and plural new tracks. Track display names are already in song context; new names appear only in `newTracks`.
6. A complete JSON example and strict output contract.

It returns no row bodies, no pitches, no IDs, and no notation. The output is:

```json
{"brief":"four-bar arcade theme","tasks":[{"id":"task-bass","track":"new1","instrumentId":"chip_bass","type":"melodic","startBar":1,"endBar":4,"rhythmInstruction":"quarter-note pulse with an offbeat pickup in bar 4","sections":[{"startBar":1,"endBar":4,"instruction":"repeat bars 1-2, vary bar 3, return in bar 4"}],"harmony":"G minor","register":"G2-D3","pitchInstruction":"small bass motif resolving to G","voicing":null},{"id":"task-pad","track":"new2","instrumentId":"chip_pad","type":"harmonic","startBar":1,"endBar":4,"rhythmInstruction":"attack on beat 1 of each bar and sustain until the next chord","sections":[{"startBar":1,"endBar":4,"instruction":"one chord per bar"}],"harmony":null,"register":"C3-C5","pitchInstruction":null,"voicing":"root"}],"newTracks":[{"ref":"new1","name":"Bass","instrumentId":"chip_bass","type":"melodic","startBar":1,"endBar":4},{"ref":"new2","name":"Harmony","instrumentId":"chip_pad","type":"harmonic","startBar":1,"endBar":4}],"progression":[{"startBeat":0,"endBeat":4,"root":"G","quality":"minor"},{"startBeat":4,"endBeat":8,"root":"E","quality":"major"},{"startBeat":8,"endBeat":12,"root":"F","quality":"major"},{"startBeat":12,"endBeat":16,"root":"D","quality":"dominant7"}]}
```

`melodic` includes bass lines, melodies, and arpeggios; each attack receives one pitch. `harmonic` creates simultaneous block chords. Progression beats are zero-based half-open intervals, must cover each harmonic task continuously, and must change on a rhythm attack. Supported qualities are `major`, `minor`, `diminished`, `augmented`, `sus2`, `sus4`, `dominant7`, `major7`, `minor7`, `add9`, and `minorAdd9`. The harmonic task's register and voicing (`root`, `first`, `second`, or `third`) drive deterministic chord realization. New track names are returned only in `newTracks`; existing display names are already in song context.

The backend rejects duplicate task tracks, unknown tracks, range errors, task/instrument mismatches, non-contiguous sections, unused new tracks, more than eight total tracks, and pitch guidance on hit instruments before any worker runs. Harmonic progression intervals must cover each task without gaps or overlaps; each chord change must begin on a rhythm attack, and deterministic chord tones must fit the requested register and instrument.

For an unrestricted “write/create/compose a song” request, the dispatcher uses all six standard starter tracks shown in song context: Soft Lead, Chip Bass, Kick, Hi-Hat, Snare, and harmonic Harmony (Chip Pad). It references their existing `t1`–`t6` aliases, declares no duplicates in `newTracks`, and supplies a chord progression for Harmony. Requests that name a narrower ensemble use only that subset and leave the other channels unchanged.

## Rhythm worker prompt

Each rhythm worker receives only its own task, its instrument ID, the rhythm tutorial, and local target rows. The tutorial defines exactly four slots per beat:

```text
x = attack   - = pitched hold   . = rest
quarter: x---   eighths: x-x-   syncopation: x..x   silence: ....
```

The worker returns compact JSON only:

```json
{"rows":[{"rowRef":"r1","pattern":"x---"},{"rowRef":"r2","pattern":"..x-"}]}
```

Percussion workers may use only `x` and `.`. The backend binds row references, rejects missing/duplicate rows and orphan holds, and never asks a hit worker for pitches. For harmonic tasks, this same rhythm output drives the chord path: `x` starts the progression chord active at that beat, `-` sustains every tone from the preceding chord event, and `.` is silence. The backend turns the progression into simultaneous chord tones; the worker does not choose chord pitches.

## Pitch worker prompt

For a pitched task, the pitch worker receives only its track task, instrument ID, harmony/register/pitch direction, and the accepted locked rhythm. It does not receive the full song, notation tutorial, or other tracks. It returns actual notes—not a palette—with exactly one pitch for every `x` and no pitch for `.` or `-`:

```json
{"rows":[{"rowRef":"r1","pitches":["G2"]},{"rowRef":"r2","pitches":[]}]}
```

The backend deterministically implants these notes into the locked rhythm, checks instrument range and notation compatibility, and compiles the rows into the song model.

## Models, traces, and repairs

`OPENAI_ORCHESTRATOR_MODEL` defaults to `gpt-6-luna`. `OPENAI_COMPOSER_MODEL` defaults to `gpt-5-nano` for rhythm and pitch workers. Structured Responses requests use strict JSON schemas, streaming summaries are visible in the UI, and exact request/response/partial-output traces are saved under each song's `.local` directory. Encrypted reasoning content and authorization headers are never recorded.

Worker validation can retry a malformed rhythm or pitch response up to two times with a precise deterministic error. Provider failures are not rewritten as musical validation errors. The final aggregate is validated once against the original song revision; no partial worker result is saved.

The possible future Jev/rhythm-library experiment remains deferred until the OpenAI baseline has measurable quality and latency results.
