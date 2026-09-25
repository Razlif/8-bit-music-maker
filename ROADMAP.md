# 8-bit Music Maker — execution roadmap

Status: implementation roadmap, updated for the per-track orchestration demo (prompt version 4). See IMPLEMENTATION-STATUS.md for actual verification evidence; this document is not a claim that all live-quality gates passed.

## Current demo architecture override

The historical Slice 04 text below describes the earlier scope-branching design. For the current implementation, use one graph for every AI request:

1. Resolve `{ kind: "song" }` for AI composition. UI selections remain for manual editing/playback only.
2. Call one GPT-6 Luna dispatcher with the whole-song overview, complete instrument catalog, and user request. It returns `tasks[]` and plural `newTracks[]`, never notation.
3. Validate one task per track, `melodic` or `harmonic` task type, contiguous bar sections, instrument identity, track limits, and instrument/type compatibility. No separate role or caller-selected phase list.
4. Fan out rhythm workers in waves of four. Each gets its own task, the concise `rhythm.md` tutorial, and local rows. Melodic pitched tasks then get a pitch worker with only its locked rhythm and task guidance; hits are materialized deterministically. Arpeggios remain melodic tasks. Harmonic tasks use the same rhythm worker, then deterministically realize progression chords at attacks and sustain every chord tone across holds; polyphonic playback uses the harmonic track's pitched preset.
5. Aggregate all rows and new tracks, validate the candidate against the original scope/revision, and save one update. No proposal/A-B stage is part of this demo path.

The live contracts are in `apps/server/src/agent.ts`, `AI-PROMPTS.md`, and `SPEC.md`. The dispatcher receives track names in song context and only returns names for new tracks. Broad song-creation requests use all six empty starter channels (lead, bass, kick, hi-hat, snare, harmonic Chip Pad) unless the request narrows instrumentation. Do not implement the historical `plan_song`/direct-selection branch below.

## 0. Instructions to the implementing agent

Build a local browser-based chiptune studio. The user describes music, listens, and can edit notes and mix track volumes manually. Use TypeScript throughout, a Node.js backend running LangGraph.js, React/Vite, and Tone.js. Use OpenAI directly: GPT-6 Luna for the whole-song dispatcher via OPENAI_ORCHESTRATOR_MODEL and GPT-5 nano for rhythm/pitch workers via OPENAI_COMPOSER_MODEL; no intent classifier or chat response. Songs live in local folders with independent Git histories. No database or general coding-agent harness is needed.

Read in order:

1. This roadmap, including defaults, contracts, and verification gates.
2. [SPEC.md](SPEC.md), especially sections 7 and 10.
3. [LANGUAGE-TUTORIAL.md](LANGUAGE-TUTORIAL.md) and its playable examples.
4. [scripts/render-language-examples.mjs](scripts/render-language-examples.mjs), as a reference prototype only.

SPEC.md defines the product requirements; this roadmap resolves routine implementation details. The tutorial defines musical semantics. If the prototype disagrees with production contracts, fix the production implementation, not the requirements. Do not silently weaken scope validation to make model output pass. A genuine conflict with an agreed requirement should be documented and raised; routine package/API choices should be resolved autonomously.

Preserve the tutorial and examples. No Strudel code or dependencies. Do not implement other apps in adjacent folders. Do not add accounts, cloud hosting, SQL, vector search, agent memory, Jev, OpenRouter, arbitrary code execution, or a general plugin framework.

Proceed slice by slice. For each, record status, changed modules, checks, evidence, and remaining issues in `IMPLEMENTATION-STATUS.md` (create it when implementation starts). Mark a gate passed only after its checks run. Keep working on independent slices if API credentials or a service outage blocks live evaluation, but label that gate pending; never substitute mock output as evidence of real model quality. Do not stop after scaffolding or a mocked chat panel.

## 1. Fixed defaults and repository structure

Choose these defaults without another product questionnaire:

| Area | Default |
|---|---|
| Tooling | npm workspaces, strict TypeScript, ESM, compatible active Node LTS |
| Server | Fastify, bound to `127.0.0.1`, default port 3001 |
| Web | React/Vite, default dev port 5173; proxy `/api` to server |
| Schemas/tests | Zod runtime schemas, Vitest for domain/server, Playwright for browser flows |
| UI styling | Plain CSS/design tokens; no large UI framework required |
| Local state | React state/context/reducers; server owns accepted song state |
| Model client | Official OpenAI SDK behind one small adapter; LangGraph calls that adapter |
| Song | 4 bars, 120 BPM, 4/4, unset key until selected/generated |
| Limits | 1–32 bars, 40–240 BPM, up to 8 tracks |
| Editor | Sixteenth snap by default; eighth, triplet, sixteenth-triplet, thirty-second options |
| Track gain | -60 to +6 dB; default -12 dB with conservative preset levels; mute separate |
| Run lifecycle | One active run and one pending proposal per song; fresh graph state per request |
| Repairs | Initial candidate plus at most 2 repair attempts |
| Request budget | Default 180-second run deadline; no unbounded model/tool loops |
| Loop/export | No end-to-start ties; one loop-length WAV, 5 ms edge fades, no appended tail |

New song: empty notes on four tracks (Bright Lead, Chip Bass, Kick, Closed Hi-Hat). This gives a visible, editable workspace before an API call. Whole-song creation is allowed to choose presets and add/remove initial tracks within an explicit creation permission; later whole-song note edits do not imply structural or mix permission.

Suggested layout (equivalent small arrangements are fine; keep boundaries):

```text
apps/
  server/src/
    index.ts                   server startup, routes, shutdown
    config.ts                  validated environment configuration
    library/                   file storage, Git, recovery, locking
    requests/                  run/proposal stores and event stream
    agent/                     graph, nodes, model adapter, context builder
    skills/                    compose.md, rhythm.md, editing.md
  web/src/
    app/                       layout, library, workspace state
    components/                controls, timeline, piano roll, agent panel
    audio/                     preset factories, scheduling, offline export
    api/                       typed requests and SSE handling
packages/core/src/
  schema.ts                    documents, selections, changes, API types
  fractions.ts                 exact rational operations
  instruments.ts               pure registry metadata, no AudioContext
  notation/                    parse, compile, serialize, event maps
  scope/                       resolve, reconcile, diff, validate
  commands/                    deterministic musical operations
  validation.ts
tests/fixtures/                valid songs, scoped edits, invalid candidates
evals/                         live-model cases and reporting script
songs/                         ignored; created at runtime
.env.example                   placeholders only
```

Keep filesystem, Git, API keys, and OpenAI imports out of browser/shared modules. Keep Tone.js and browser globals out of server/domain modules. Do not use an ORM or shared mutable singleton song.

Required root commands at completion: `npm install`, `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run eval:live`. Build/start serves the built UI and API from the local backend. Document the supported Node version and Git prerequisite. Lock compatible package versions; verify installed APIs instead of pasting outdated examples.

Configuration: `OPENAI_API_KEY`, `OPENAI_CLASSIFIER_MODEL=gpt-5-nano`, `OPENAI_COMPOSER_MODEL=gpt-5-nano`, optional `SONGS_DIR`, `PORT`, and `RUN_TIMEOUT_MS`. Never prefix secret variables with `VITE_`. Missing keys disable agent actions with clear guidance, not manual editing or playback. Use `.env.example` without credentials and ignore `.env`, `.local/`, build outputs, and `songs/` in application Git.

## 2. Core contracts to establish first

These TypeScript snippets express application contracts, not library-specific code. Implement corresponding strict runtime schemas. Reject unknown mutation fields instead of silently applying them.

```ts
type Fraction = { n: number; d: number }; // reduced; d > 0
type Span = { start: Fraction; end: Fraction }; // [start, end)

type Note = {
  id: string;
  start: Fraction;       // absolute beats; bar 1 beat 1 is 0
  duration: Fraction;    // logical rhythmic/gate duration, > 0
  velocity: number;      // integer 1..127; initial default 100
} & ({ kind: 'pitched'; pitch: string } | { kind: 'hit' });

type Track = {
  id: string; name: string;
  instrumentId: string; instrumentVersion: 1;
  volumeDb: number; muted: boolean;
  notes: Note[];
};

type Song = {
  schemaVersion: 1;
  id: string; title: string; createdAt: string; updatedAt: string;
  revision: number; brief: string;
  music: {
    bpm: number; meter: [4, 4]; bars: number;
    key: { root: string; mode: string } | null;
    tracks: Track[];
  };
};

type Selection =
  | { kind: 'song' }
  | { kind: 'tracks'; trackIds: string[] }
  | { kind: 'regions'; regions: Array<Span & { trackIds: string[] }> }
  | { kind: 'notes'; noteIds: string[] };
```

UUIDs are generated by the backend for persistent IDs. Track IDs can contain hyphens and start with digits. The prototype parser's letter-only identifier rule is not adequate. For production rows, accept `[A-Za-z0-9_-]+` and resolve against the registry for that request; reject unknown IDs. New-track temporary references can use `new_lead` and are resolved server-side exactly once per candidate.

Canonical pitches use scientific notation, validated then converted to MIDI numbers for comparisons/playback. Normalize enharmonic equivalents deterministically (sharps are sufficient in stored notes); retain key spelling separately. Preserve protected pitch identity under that canonical normalization. Do not compare C# and Db as distinct audible pitches by accident.

Event IDs are stable across unchanged content. Exact event operations preserve target IDs. Creative replacements retain exact matching events' IDs and allocate IDs for genuinely replaced/inserted events. Do not expect the model to invent persistent IDs.

### Fractions and representability

Use BigInt intermediates for fraction addition, multiplication, LCM, and comparison; serialize only reduced safe integer pairs. Never derive musical equality through rounded milliseconds. Reject overflow/unsupported complexity before saving. Convert to floating seconds only at the playback/export boundary.

Production default limits: maximum 128 serialized items per track/beat, each reduced weight at most 1,000,000; stored fraction numerator and denominator must be safe integers. Ask the model to use at most 32 items and small weights where possible. The tutorial's weight-64 cap is only a prototype limit, not a storage invariant.

**Every accepted song must be serializable back into the weighted language exactly.** Serializer steps: intersect events with each beat, include silent gaps, emit pitch/hit at attacks and `hold` at continuing pitched events, calculate interval lengths as fractions, use the denominators' LCM to obtain integer weights, then reduce by the weights' GCD. Reject a candidate or manual edit that exceeds the hard serialization limits, with `RHYTHM_COMPLEXITY_LIMIT`; do not approximate the music. This avoids a song saving successfully but becoming unreadable to the next agent request.

Percussion event duration represents its logical slot and must end within its beat in this demo, because `hold` is forbidden for hits. Its sound envelope may naturally decay beyond that slot. The UI edits drum onsets through the step grid and computes legal logical durations deterministically; do not create cross-beat drum durations that cannot round-trip.

### Permission envelope

```ts
type NoteField = 'pitch' | 'start' | 'duration' | 'velocity';
type Scope = {
  id: string; songId: string; baseRevision: number;
  eventRules: Array<{
    noteId: string; trackId: string; fields: NoteField[];
    mayDelete: boolean; permittedSpan: Span;
  }>;
  insertionRegions: Array<Span & { trackId: string }>;
  newTrackRules: Array<{ ref: string; permittedSpan: Span }>;
  removableTrackIds: string[];
  metadataRules: Array<{ target: string; fields: string[] }>;
  requiredRows: Array<{ trackRef: string; bar: number; beat: number }>;
};
```

Use field allowlists/enums in the real schema; metadata targets are typed song/track references, never arbitrary JSON paths. Onset/duration edits must leave the resulting entire event inside its permitted span. A single-note target defaults that span to its original extent; explicit UI dragging or a clear movement request can authorize a displayed destination span. Gaps in a multiselection stay protected. Stable track identity cannot change through an event update.

`requiredRows` is output coverage, not write permission. It may include protected material or additional whole beats required to resolve a sustained note. Expanding this context must not alter eventRules/insertionRegions.

```ts
type Candidate = {
  scopeId: string; baseRevision: number;
  newTracks: Array<{ ref: string; name: string; instrumentId: string }>;
  eventUpdates: Array<{ noteId: string; changes: Partial<{
    pitch: string; start: Fraction; duration: Fraction; velocity: number;
  }> }>;
  deletedNoteIds: string[];
  removedTrackIds: string[];
  rowReplacements: Array<{ trackRef: string; bar: number; beat: number; body: string }>;
  metadataChanges: Array<{ target: string; changes: Record<string, unknown> }>;
};
```

`body` is one bracketed row, e.g. `[C5:2 D5]`; track/bar/beat are explicit envelope fields. Context may display the fuller tutorial notation. Validate metadata changes against per-target schemas. Reject event operations and row replacements targeting the same event/span within one candidate. Unknown IDs, duplicate operations, overlapping replacements, and unapproved new tracks are errors. The model must return required rows completely; no ellipses or “keep the rest.” Use deterministic commands rather than model-written raw fractions for exact movement/resizing; creative output is weighted notation.

## 3. Ordered slices and gates

### Slice 01 — scaffold and canonical domain

**Build:** workspaces, shared schemas, fraction utilities, instrument metadata, deterministic fixtures, typechecking/tests, backend health route, and a minimal frontend shell. No polished editor yet.

Validate all document fields at IO boundaries. Allow zero tracks after intentional removals; default New creates six empty starter tracks (lead, bass, kick, hi-hat, snare, harmonic Chip Pad). Cap title at 120 characters and brief at 4,000; reject malformed timestamps/IDs. Validate notes within `[0, bars * 4)`, with positive duration and end no later than song end. Melodic pitched tracks are monophonic; harmonic tracks permit validated chord events. Validate preset type/range and track count. Do not silently clamp pitches.

Initial registry:

| ID | Type | MIDI range | Character |
|---|---|---|---|
| `chip_bass` | pitched | 24–60 | triangle, sustained |
| `bright_lead` | pitched | 48–96 | pulse/square, sustained |
| `soft_lead` | pitched | 48–96 | mellow triangle, sustained |
| `pluck` | pitched | 36–96 | short pulse pluck; hold extends gate, not a new attack |
| `kick` | hit | — | downward-pitched short drum |
| `snare` | hit | — | noise with short tonal body |
| `closed_hat` | hit | — | short filtered noise |

**Gate:** typecheck/build shell; fraction equality and comparisons; invalid denominator/overflow; exactly touching notes; overlaps; wrong preset type; ninth track; bounds violations; basic fixture round-trip JSON. These tests target data integrity, not UI styling.

### Slice 02 — notation adapter and exact round-trip

**Build:** parser, normalized AST, compiler, serializer, contextual event map. Port useful logic from the prototype into TypeScript modules, not a child-process runtime. Do not import its CLI or execute Markdown as code.

Support pitches, rest/hold/hit, integer weights, comments after whitespace, and complete bar/beat structure. Do not strip the `#` in `G#4`. Strictly reject nesting, empty rows, invalid weights, missing rows, duplicate rows, orphan holds, and incompatible tokens. All rows fill one beat regardless of weight sum.

For scoped output, compile complete covered rows against read-only boundary context. A continuing note may span more than one block; merge holds into the original event rather than retriggering or splitting identity. Include the affected note's full span in parsing context if necessary, while keeping scope fixed. Remove/rewrite events only after the entire candidate can be compiled.

Examples that must compile exactly:

```text
[C5 E5]             -> starts 0, 1/2; durations 1/2, 1/2
[C5:3 E5:2]         -> starts 0, 3/5; durations 3/5, 2/5
[C5:2 E5]           -> starts 0, 2/3; durations 2/3, 1/3
[C5 D5 E5 F5 G5]    -> five equal fifths
beat 1 [C5:2 D5]
beat 2 [hold E5:2]  -> C, D, E each lasts 2/3 beat
```

Exact round-trip means musical event equality, not identical spelling/whitespace. IDs/velocity must be reattached from existing events when notation does not encode them. For newly composed notes assign preset defaults. Two repeated C notes must remain two attacks; `[C5 hold]` becomes one event. Include UUID track IDs and different subdivisions on parallel tracks in fixtures.

**Gate:** regenerate the tutorial examples through the shared adapter, check their expected timings, round-trip all supported fixtures including sevenths and cross-bar holds, and demonstrate a clear failure at serialization complexity limits. Preserve the existing reference audio files unless intentionally regenerated and explained.

### Slice 03 — scope engine and deterministic proposals

**Build:** selection resolution, permission masks, candidate normalization, event reconciliation, canonical diff, scope validation, and an in-memory proposal service. No model is needed to verify this slice.

For a protected event, require an exact canonical event match and preserve its ID/velocity. For a selected pitch-only note, match by track/start/duration and apply only the permitted pitch change; reject ambiguity. For a fully writable region, preserve exact matches first, then delete/create changed events within authority. Require every protected old event to survive; verify every new event lies in an authorized insertion region. Compare protected metadata separately. Preserve silence outside insertion regions. Model output contains only short row refs, music and explicitly permitted new-track declarations. The backend attaches scopeId/baseRevision from trusted request state, never from model-provided identity.

```ts
// Architectural sketch; return structured errors instead of throwing HTTP errors here.
function buildProposal(base: Song, scope: Scope, input: unknown): Result<Proposal> {
  const candidate = parseCandidate(input);
  checkIdentityAndRevision(base, scope, candidate);
  const next = compileAndReconcileOnCopy(base, scope, candidate);
  validateSong(next);
  assertExactNotationRoundTrip(next);
  validateActualDiff(base, next, scope);
  return storeImmutableProposal(base, next, scope);
}
```

Add exact commands: transpose by semitones, set tempo, update one pitch, move/resize a selected event, rename track, set preset, set mix, add/remove track, and resize song. All use explicit scope/revision and the shared validators. Shrinking a song with affected notes requires an explicit visible trim confirmation; never truncate silently. Switching to a preset whose range cannot play existing notes returns an actionable error. Transposition must reject out-of-range pitches rather than clamp them.

**Gate:** test horizontal, vertical, rectangular, disjoint-note, and whole-track scopes; a protected note shifted by weights; unauthorized insertion into silence; deletion/recreation of protected notes; crossing-note holds; unauthorized volume change; unknown/new-track refs; duplicate/conflicting operations; stale revision. Assert complete rejection without changing the base object. Demonstrate an atomic new-track-plus-existing-track rewrite.

### Slice 04 — minimal LangGraph and real-model evaluation

**Build:** actual Node LangGraph orchestration and OpenAI adapter on the headless domain pipeline. Do this before investing in the full studio UI. No hosted LangGraph service is required.

Use a scope-driven adapter: plan is called only for whole-song selections; compose replaces a bounded snippet. No classify or explain methods:

```ts
interface ModelAdapter {
  plan(input: string, signal: AbortSignal): Promise<MusicPlan>;
  compose(input: string, signal: AbortSignal): Promise<Replacement>;
}
```

Use structured output schemas compatible with the installed SDK/model, then validate locally. Check current official documentation for supported parameters; do not assume temperature or reasoning options from another model apply. Handle refusal, truncated output, authentication failure, rate limit, cancellation, and timeout distinctly. Do not retry authentication failures as musical repairs. Keep usage/time metadata separately from musical output. No automatic upgrade to an expensive model.

Graph nodes:

| Node | Work | Exit |
|---|---|---|
| resolve_scope | Snapshot accepted revision, derive authority from UI selection; partition output | plan_song for whole-song scope, otherwise replace_passages |
| plan_song | Compact harmony/groove/motif/development, no music writes or chat | replace_passages |
| prepare_context | Role, tutorial, read-only overview and surrounding notation, user request, masked snippet, output contract | compose |
| compose | Return {newTracks, rows:[{rowRef,body}]} only | validate |
| validate | Bind aliases to trusted rows and identity; compile and check actual changes | next passage, repair or failed |
| repair | Rejected wire output plus precise diagnostics; same authority, max two retries | compose |
| aggregate validation | Validate all passages against original snapshot | one preview |

Compile the request graph and passage subgraph once; invoke with fresh state. No model-controlled routing, selection expansion, administrative IDs, conversation or arbitrary tool access. Small selections use a direct replacement; whole songs get one plan reused by every passage. Long selected scopes partition without an additional planning call. Keep instruments together; cap passages at two contiguous bars / 32 rows. Leading holds may continue a permitted predecessor without changing its attack; validate aggregate scope after assembling everything. No partial save and no deadline reset per passage.

A snippet row contains a short rowRef, track alias, bar/beat, original bracketed body, exact beat-relative editableSpans, and protected note data. For sub-beat edits return the full touched beat, preserving protected notes and silence. Selected-note replacements get insertion permission only inside that selected event's original span. Mixed instructions remain one musical request; exact manual buttons still use deterministic core commands.

Keep backend read_song/list_instruments/propose_change services internal. Load concise app-owned Markdown grammar/examples, not arbitrary model-selected paths. Persist exact prompts, local row bindings, plan, raw visible output, streamed summaries, schema/notation errors and retry feedback. Preserve cancellation, stale-acceptance checks and the overall 180-second default deadline. No implicit stronger model or timeout increase.

**Live evaluation cases:**

1. Generate a four-bar, four-track cheerful loop in C major.
2. Generate a bass/percussion groove with 2:1 swing.
3. Creatively rewrite only bass in bars 2–3 while preserving other tracks.
4. Change a selected melody note's pitch while preserving timing and neighbors.
5. Add a lead while rewriting one permitted bass bar.

Run each twice initially (10 cases), plus deterministic negative-scope fixtures from Slice 03. Record first-pass validity, validity after repair, latency, usage/cost when available, scope violations, and playable output. Do not invent a cost if current pricing/usage is unavailable. Save redacted results and reproducible fixtures in ignored local eval output; summarize findings in the implementation status.

**Gate:** all published candidates pass scope/song validation; at least 9/10 live cases yield valid candidates within repair budget; audition examples for recognizable rhythm, requested mood, and coherent phrase endings. Mechanical success is not a music-quality score. Log listening observations separately. If the gate fails, fix context/examples or try a user-configured alternate composition model; record the result, do not weaken validators. With no key, finish mocked adapter tests and independent infrastructure, explicitly leave live evidence pending.

### Slice 05 — local library, atomic save, Git history

**Build:** library service, canonical persistence, metadata listing, new/open/rename/duplicate, per-song Git, history restore, and recovery.

Resolve `songs/` from the application root in both dev and built modes. Create it lazily on startup, ignoring it in the app repo. Validate UUID directory names and realpath containment; refuse symlink/junction traversal outside the configured root. Use filesystem APIs, not user titles in shell strings. Git calls use argument arrays and explicit cwd, with fixed tracked paths. No `git add .`, remote push, destructive reset, or global config changes. Use per-command identity for commits.

Support one backend process owning a library. Acquire a library lock using exclusive creation; if another process owns it, fail clearly instead of pretending per-process mutexes coordinate writes. Do not automatically delete an unverified live lock. Release on normal shutdown; document conservative stale-lock recovery. Per-song serialization handles concurrent requests within that process.

Save sequence under the song mutex:

1. Reconcile pending history or reject the new mutation with `HISTORY_PENDING`.
2. Reload and validate current song; verify expected revision and detect unexpected external edits with a content fingerprint.
3. Validate candidate, scope, and exact serialization; assign new revision/time.
4. Write and flush a same-directory temporary JSON file; atomically replace authoritative JSON. Never unlink the accepted file first. Preserve a known-good recovery snapshot until completion; verify Windows replacement behavior.
5. Regenerate `song.txt`, stage only intended tracked files, and commit the accepted revision.
6. Return `{saved: true, revision, history: 'committed' | 'pending'}`. A failed pre-save operation returns saved false; a failed Git commit after replacement does not.

On startup compare canonical revision/content with the latest app-owned commit and recovery marker. Valid newer JSON is authoritative; rebuild derived notation and finish history. Invalid JSON is shown as unavailable with a recoverable-history action, not overwritten silently. Git no-op/retry must not create a second semantic revision. Accept retries use proposal ID/request ID as idempotency keys; an already accepted proposal returns the existing outcome, even after a lost response. Record the proposal ID in commit metadata/message plus ignored recovery data to support restart reconciliation.

Undo restores earlier music/title/brief as a new revision while preserving song ID and createdAt. History selection uses verified commits from that song, not arbitrary refs. Duplicate validates the accepted source, generates new song/track/note IDs consistently, and starts new history. Browser selection/solo/playhead are not copied.

**Gate:** temporary-directory integration tests for create, reopen, rename, duplicate, history restore, stale save, malformed sibling song, invalid schema version, simulated write failure, simulated commit failure after save, restart recovery, duplicate accept, and path escape rejection. Verify nothing writes user song data into application Git. Do not test against the user's real songs folder.

### Slice 06 — local API, runs, proposals, and progress

**Build:** typed HTTP routes and application-level SSE. The browser never receives raw graph state or secrets. Default API errors contain stable code, message, and structured validation details.

| Method/path | Behavior |
|---|---|
| `GET /api/health` | runtime readiness, agent enabled flag; no secrets |
| `GET /api/instruments` | preset metadata |
| `GET /api/songs` | healthy/unavailable library summaries |
| `POST /api/songs` | create default song |
| `GET /api/songs/:id` | accepted document + history status |
| `POST /api/songs/:id/duplicate` | duplicate accepted document |
| `POST /api/songs/:id/commands` | validated manual command with expected revision |
| `GET /api/songs/:id/history` | accepted revision summaries |
| `POST /api/songs/:id/restore` | restore verified version as new revision |
| `POST /api/songs/:id/runs` | create fresh run with instruction, selection, revision; return run ID |
| `GET /api/runs/:id` | snapshot for reconnect/recovery |
| `GET /api/runs/:id/events` | SSE progress and terminal outcome |
| `POST /api/runs/:id/cancel` | abort; no late writes/proposals |
| `GET /api/proposals/:id` | base revision, candidate, canonical diff, status |
| `POST /api/proposals/:id/accept` | atomic revision-checked save |
| `POST /api/proposals/:id/discard` | invalidate proposal without accepted-song write |
| `POST /api/songs/:id/history/retry` | finish pending history without changing music |

Use 409 for stale/busy/history-pending conflicts, 422 for invalid musical changes, 404 for unknown IDs. Bind to loopback, restrict development origins to the local UI, reject unexpected Origin/Host on mutations, and require JSON content type. Do not add remote access/auth as a product feature. Configure a finite body limit, initially 2 MB.

SSE envelope: `{eventId, runId, songId, type, timestamp, payload}`. Supply increasing event IDs, a bounded replay buffer, terminal snapshot, and heartbeat; reconnect must not restart a model call. UI filters all events by song/run IDs. Log node times, tool outcomes, usage, and sanitized errors locally. Never forward chain-of-thought or raw provider headers. On server restart, mark interrupted runs interrupted; do not silently resume them. Requests are memoryless between runs.

**Gate:** cancel during composition, cancel during repair, accept twice, stale acceptance, reconnect after preview event, switch-song late event, manual edit while generating, missing API key, provider failure, and server restart. No failure may overwrite accepted music.

### Slice 07 — browser audio and instrument audition

**Build:** Tone.js preset factories, deterministic event scheduling, transport state, gain/mute/solo, and an instrument audition panel. Use the same factories for offline export later.

Only create/resume AudioContext after a user gesture. Schedule through the audio transport/clock. Convert rational beats to seconds using BPM in one utility; do not schedule audio with `setInterval` or React updates. React playhead animation follows the clock. Dispose old synths and scheduled events on stop/song change/unmount. Avoid duplicate schedulers under React development Strict Mode.

Holds produce one continuous gated note, not repeated attacks. Drum decay follows its preset, independent of token weight. Mute and solo change gain routing, not event existence. Ramp volume over about 15 ms. Isolate track gain from note velocity and master headroom. A peak indicator/limiter should prevent gross overload at eight tracks; don't normalize each track independently during mixing.

Use exact loop bounds `[0, bars * 4)` and do not schedule end-time attacks twice. Live candidate switching happens on the next bar boundary and cancels old future events; stop/discard restores the accepted schedule. At a loop wrap end active notes as defined, with a brief release; no implicit end-to-start ties. Playback within a selected loop range starts intersecting notes at its left edge and ends them at its right edge for audition only; persisted notes are unchanged.

**Gate:** audition all eight presets; reproduce tutorial straight/gentle/triplet rhythm; verify harmonic chord playback and long holds across bars, mute/solo/volume, repeated play/stop, BPM change, selected-range looping, and song switch. Check the eight-track mix for clipping and clicks. Browser screenshots are not audio verification; use actual playback/listening and offline waveform checks.

### Slice 08 — library UI and studio shell

**Build:** functional library sidebar, transport, track list, timeline, agent panel placeholder backed by real run state, and clear empty/error/loading states.

At desktop width: library around 220 px on left, central flexible workspace, agent panel around 320 px on right; top transport around 64 px. On narrower screens collapse side panels into drawers without hiding playback/scope controls. Prefer readable dark-neutral surfaces and consistent instrument colors; pixel accents are optional, not the main font for dense controls.

New/Open/Rename/Duplicate use real API services. Show title, save/history status, and pending proposal clearly. Keep accepted document, local gesture draft, proposal candidate, and transient UI state separate; do not overwrite the accepted store with the preview. The current song must be explicit everywhere. Resolve active runs/previews before switching as specified in SPEC.md.

**Gate:** empty library, create, reload, rename, duplicate, malformed-song row, history pending, and pending-preview navigation. Keyboard access and labels for icon buttons/sliders. No hardcoded demonstration data as the only working source.

### Slice 09 — piano roll, percussion grid, and selection

**Build:** shared bar timeline, per-track overview lanes, selected-track piano roll, percussion steps, note gestures, scope highlighting, and mixing controls.

Derive x positions from exact beat values and y positions from pitch. Rendering may use floats; mutations use snapped fractions. Show existing off-snap rhythms at their actual positions. Opening a triplet passage with sixteenth snap must not quantize it. Moving notes uses a snapped delta so unselected/unchanged rhythms remain exact. Validate monophony and range; show invalid drag feedback and revert failed saves.

Support note click, additive note selection, drag time-range over a lane, vertical time selection from the ruler across chosen tracks, and rectangular track/time selection. Show crossing notes as protected. Labels include track names and bar/beat range or selected-note count. Whole-song mode is explicit. Escape clears selection into the visibly labeled default; it must not silently submit a prior selection as whole-song.

Pointer movement updates only a local draft. Pointer release sends one command against the starting revision; save failure restores/reloads the accepted document with explanation. Prevent unsaved gestures from being submitted as model context. Volume movement affects audition immediately but persists once per gesture. Any saved manual edit invalidates old proposals; a stale proposal can remain visible but not acceptable.

For exact one-note commands preserve its ID. If a note is selected and the model returns full beat rows, neighbors are still protected by the scope engine. Use the same canonical services for manual and agent changes; no separate unchecked UI-save path.

**Gate:** draw/move/resize/delete a note, drum toggle, every selection shape, boundary-crossing hold, off-grid rhythm preservation, live fader change, concurrent/stale save rejection, and undo. Verify visual selection corresponds exactly to emitted selection payloads, not only bounding-box appearance.

### Slice 10 — integrated agent workflow

**Build:** input, scope display, progress, cancellation, clarifications, musical diff, A/B audition, accept/discard, and errors using real backend runs.

The panel can show an activity history, but does not automatically send prior chat as memory. Explain this through behavior: persist useful musical intent into brief through an authorized metadata change. Follow-up “make it happier” targets current music; ambiguous references to a previous discarded idea require context clarification.

Show readable statuses (Reading music, Composing, Checking changes, Preview ready), not graph-node names. Diff highlights insertions, removals, pitch/timing changes, and approved metadata changes. A candidate is never accepted by starting playback. Disable duplicate submissions during a run and prevent a new run from silently replacing a pending proposal; offer discard first. On scope expansion show the exact added tracks/time/properties before approval, then create a new backend scope.

Exact transposition uses semitones and range validation. A key-label control changes metadata only and is labeled accordingly; a separate Transpose action changes pitches. A natural-language request for another mode may require creative rewriting, not a universal semitone shift. Do not pretend key metadata guarantees every note is in that scale. Strict scale-only composition must be an explicit constraint.

**Gate:** complete describe → generate → listen → select → edit → audition → accept → restart flow against OpenAI; discard leaves song/history untouched; clarification doesn't mutate; repairs are bounded; late results never replace the current song. Record which flows used a real model and which used controlled test responses.

### Slice 11 — export, recovery polish, and delivery

**Build:** offline WAV export of accepted state using shared browser instrument factories. Preview export is deferred. Export uses saved gains/mutes, ignores transient solo, and has exactly `bars * 4 * 60 / bpm` seconds (rounded once to sample frames). Render with adequate internal tail time if required, crop to loop length, and apply 5 ms outer edge fades. Use 44.1 kHz 16-bit stereo PCM; report peak clipping or apply the same master safety chain used for playback.

An Export button downloads the file via browser; optionally retaining a copy under the song's ignored `exports/` directory is not required. Sanitize the download filename. Test valid WAV headers, frame count, non-silent output for non-silent songs, all-muted silence, and gain changes. No model/API call is needed.

Finish readable startup instructions, exact commands, environment setup, Git prerequisite, library location, known limitations, recovery behavior, and how to run checks. Add clearly labeled opt-in demo fixtures without overwriting existing songs. Shut down cleanly and release library locks.

**Gate:** clean install/build/start; no-key manual workflow; live-agent workflow; all deterministic/domain tests; browser E2E; library/Git recovery tests; audio export checks; visual inspection at desktop and narrower widths. Fix failures before declaring done. If external credentials/service remain unavailable, explicitly report that live-model acceptance is unverified, while delivering completed independent functionality.

## 4. Delivery checklist and common failure modes

Before handing off, map every acceptance criterion in SPEC.md section 11 to a test or recorded manual check. Include the exact command, outcome, and evidence location. Provide a concise remaining-issues list; do not label untested items complete.

Particular traps:

- **Context becoming authority:** showing all tracks does not authorize editing them.
- **False scope validation:** comparing JSON text misses shifted events and equivalent notation. Compare canonical music and metadata.
- **Fraction loss:** dividing to decimals during storage or reserializing triplets to sixteenth snap changes the music.
- **ID loss:** output token positions are not persistent event identifiers; UUIDs must be legal row identifiers.
- **Silent partial application:** a candidate with one illegal operation must not apply its legal half.
- **Candidate becoming accepted state:** preview/audio state must not persist until acceptance.
- **History confusion:** a successful file save is not a successful Git commit; revision numbers are not commit hashes.
- **Volume ignored:** faders must affect sound and export, not merely UI labels.
- **Duplicate audio:** React rerenders must not instantiate parallel transports or schedule the same attacks again.
- **Model output mistaken for quality:** valid JSON and in-scale notes do not prove a satisfying composition. Listen.
- **Mock-only completion:** tutorial synthesis and fake model responses do not satisfy the real-model milestone.
- **Oversized architecture:** avoid extra agents, databases, hosted services, and a general coding harness.

## 5. Documentation checkpoints

Maintain SPEC.md and LANGUAGE-TUTORIAL.md when production semantics change; include new examples and fixtures for intentional changes. Do not edit them just to excuse a broken implementation. Keep the roadmap checkboxes in the implementation status, not retroactive claims in this file.

Reference documentation to consult for the installed versions:

- [LangGraph.js graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api): node/state/routing APIs, including Command. Only send application-level status events to the browser.
- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano): current model capabilities and parameter support; verify account availability.
- [Vite setup](https://vite.dev/guide/): supported Node/runtime and build setup.
- [Tone.js](https://tonejs.github.io/): browser audio scheduling and instrument APIs.

These links support library usage. The scope, storage, notation, and product contracts in this handoff are our application design, not guarantees supplied by those libraries.
