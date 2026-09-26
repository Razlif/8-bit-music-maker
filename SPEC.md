# 8-bit Music Maker — draft specification

Status: product specification for implementation handoff. [ROADMAP.md](ROADMAP.md) supplies ordered execution slices, concrete defaults, contracts, and verification gates. The application is not implemented yet. Remaining engineering choices should be resolved using the roadmap without restarting the product questionnaire; genuine conflicts with agreed requirements must be raised explicitly.

## 1. Product and outcome

A local music workspace where a user creates and refines short chiptune songs through conversation and direct editing. The music stays visible and playable. Selecting a track or passage establishes the context for an agent request.

Primary loop: describe → generate → listen → select → refine → audition → accept or discard.

The first demo supports a single open project, up to eight tracks, a modest instrument library, local persistence, and Git revisions. No accounts, cloud project storage, collaboration, database, or general-purpose coding-agent harness are required.

## 2. Agreed architecture

- Prefer the simplest implementation that satisfies the agreed demo requirements; add infrastructure or abstractions only when needed.
- Use TypeScript throughout, with LangGraph.js executing on Node.js. This keeps one language and allows shared musical types and validation utilities.
- LangGraph orchestrates requests using explicit state and deterministic nodes/tools. Routing may use `Command(update=..., goto=...)`.
- Requests are scope-driven musical replacements, not chat. No intent classifier or explanation route. AI composition uses whole-song scope and a shared dispatcher; manual selections remain for direct UI editing/playback.
- Each request starts a fresh graph run. The accepted song, project brief, selection, and current instruction provide context; conversation history is not implicit memory.

**Current demo amendment:** AI composition always resolves whole-song scope. The live graph is dispatcher → validated one-track tasks → rhythm workers → deterministic hit, melodic-pitch, or harmonic-chord completion → aggregate validation → one save. Dispatcher tasks use `type: melodic | harmonic`, explicit rhythm and pitch instructions, and no redundant free-form role. Arpeggios are melodic tasks. Harmonic tasks provide a structured chord progression; a rhythm worker places attacks/holds, then the backend realizes simultaneous chord tones deterministically and plays them polyphonically. The historical proposal/A-B and small-selection creative paths described later are not the active demo contract.
- The agent chooses instrument presets, not synthesis parameters.
- Custom musical tools read context and propose bounded edits. Backend code owns parsing, validation, insertion, persistence, and Git.
- The agent reads and writes a musical notation organized as one bar per block, beats within a bar, and dynamic instrument rows within a beat. Raw timing integers are not its composition interface.
- Proposals are previewed before acceptance. Invalid or unfinished output never replaces the accepted song.

## 3. Implementation stack

| Layer | Choice |
|---|---|
| UI | React + TypeScript + Vite |
| Styling | CSS with shared design tokens |
| Timeline / piano roll | SVG for the initial scale of the demo |
| Browser audio | Tone.js, with fixed instrument preset implementations |
| Backend | TypeScript + Node.js + LangGraph.js (`@langchain/langgraph`) + Fastify |
| Transport | HTTP commands and server-sent events for progress |
| Persistence | Local project folder; backend-managed Git |
| Model provider | **Confirmed:** OpenAI directly; GPT-5 nano for planning and replacement, configured by OPENAI_COMPOSER_MODEL |

TypeScript throughout and the Node.js graph runtime are confirmed. Share song types, notation parsing, and applicable validation utilities between frontend and backend; the backend remains authoritative for accepted mutations.

Browser playback schedules events against the audio clock, not React rendering or ordinary timer intervals. Start audio following a user gesture. API credentials remain on the backend.

## 4. UI

### Layout

- Top: play/pause, loop, tempo, key/mode, song length, undo, export.
- Center: shared bar timeline with colored track lanes and a moving playhead.
- Track header: name, instrument preset, mute, solo, volume; add/remove track controls.
- Selected pitched track: piano roll for adding, moving, resizing, and deleting notes.
- Selected percussion track: step grid.
- Right: request input, explicit edit scope, progress, deterministic change summary, audition/accept/discard.

Use a clean compact studio design with restrained retro accents. Musical editing targets and labels must remain readable. Do not expose graph nodes, provider routing, or compiler internals in the normal product flow.

### Manual track mixing — confirmed

Every track has a visible volume fader/slider with a numeric level, plus mute and solo. Users can raise or lower each instrument independently while music plays, without an agent request. Smooth gain changes to avoid clicks. Keep track gain separate from note velocity and preset sound design. Persist volume in project metadata and preserve it across musical agent edits unless mixing changes were explicitly requested. Preview playback uses the current mix. Save a completed slider gesture as one edit rather than recording every pointer movement. Audio export includes the saved track levels. Exact gain range and default headroom are implementation choices to verify with the instrument library.

### Selection and feedback

Selections can be horizontal (a passage on one track), vertical (a time slice across chosen tracks), rectangular (a time range over a subset of tracks), a single note, or an explicit set of notes. Whole-track and whole-song selections are also supported. The request panel visibly states the editable target. Showing a complete beat, adjacent bars, or another instrument for context never expands permission to edit.

If an operation needs broader scope, preserve the current boundary; the user must change the selection or use explicit metadata controls. This music-only interface does not generate a conversational expansion answer. Never expand authority automatically to match a larger context block. A time selection that cuts through a sustained note leaves that crossing note protected by default; highlight it as read-only. The user can explicitly include the complete note, with the resulting permitted span shown before submission. Clicking a note selects that complete event, including its cross-beat/bar sustain. Backend scope checks remain mandatory.

Agent proposals highlight changed material. Audition switches between accepted and proposed versions; changes to a playing version take effect at a predictable bar boundary. Accept saves; discard restores the accepted view. Manual edits respond locally immediately and are validated before persistence.

## 5. Musical limits and instruments

**Confirmed song length:** four bars by default, adjustable from 1–32 whole bars. Notes and phrases may cross bar boundaries within the song. Display duration derived from bars, meter, and tempo.

**Implementation defaults:** 120 BPM and sixteenth-note UI snap. UI snapping is an editing aid, not a restriction on stored or agent-generated rhythms.

**Confirmed meter and rhythm direction:** 4/4 only for the initial demo. Retain explicit meter metadata for future expansion. Use the weighted beat-row language demonstrated in LANGUAGE-TUTORIAL.md: equal subdivisions, positive integer relative weights, rests, and holds across beats/bars. Different tracks can use different subdivisions within the same beat. Fixed-ratio swing is expressible through weights; continuous humanization and other expressive timing are deferred.

**Confirmed length bound:** 1–32 whole bars. **Implementation tempo bounds:** 40–240 BPM. Meter changes are out of scope. Equal subdivisions support tuplets without a fixed whitelist of note values. ROADMAP.md defines production serialization limits and exact round-trip requirements; the tutorial's 32-item/weight-64 caps are prototype-only.

Up to eight tracks, dynamically named. Stable track IDs are separate from display names. Each track selects a preset and is either melodic (monophonic) or harmonic (simultaneous pitched chord events). Different tracks may sound simultaneously. Percussion instruments occupy separate tracks so simultaneous hits are explicit.

**Initial library:** Chip Bass, Saw Lead, Soft Lead, Pluck, FM Bell, Dream Pad, Electric Piano, Chip Pad, Kick, Snare, Closed Hi-Hat, Open Hi-Hat, Low Tom, Woodblock, and Crash. Each preset declares a stable ID, availability, description, pitched/unpitched type, supported pitch range where relevant, sustain behavior, and backend/browser implementation version. Bright Lead remains loadable for older songs but is retired from new composition and selection. ROADMAP.md provides initial ranges; sound envelopes and mix headroom are verified through listening tests.

**Fresh-song channels:** start with six empty tracks: Soft Lead (`soft_lead`, melodic), Chip Bass (`chip_bass`, melodic), Kick (`kick`), Hi-Hat (`closed_hat`), Snare (`snare`), and Harmony (`chip_pad`, harmonic). For a broad song-creation request with no narrower instrumentation, the dispatcher should compose all six by reusing these tracks. A request naming a subset leaves the other starter tracks empty. The Harmony channel plays simultaneous progression chords; the three percussion channels remain independent rhythm-only tracks.

Muted/solo/volume controls are playback controls; composition must not silently remove muted notes. Presets implement oscillators, envelopes, and noise internally. No raw waveform selection is exposed to the model.

## 6. Source representation and notation

The accepted language direction is documented in [LANGUAGE-TUTORIAL.md](LANGUAGE-TUTORIAL.md), with generated audio examples. Implement our own small parser; do not incorporate Strudel code or dependencies. The example renderer is a prototype, not the production backend.

### Source of truth

**Confirmed:** persist one versioned `song.json` as the authoritative accepted musical model. Its notes have stable IDs, rational start/duration values in beats, pitch or percussion trigger, and velocity. Track metadata includes preset, display name, and volume. A generated `song.txt` provides the readable musical representation for Git review. It is derived and must never be independently edited as a second authority. Section 10 defines the document envelope and library layout.

Represent timing as reduced integer numerator/positive denominator pairs, rather than fixed 960-tick quantization. Perform exact rational arithmetic for composition, validation, and persistence; convert to seconds for audio scheduling. Any future MIDI export must specify its quantization separately. Keep arithmetic and parser complexity bounded with explicit validation errors, never silent rounding.

The UI receives structured events. The model receives notation plus explicit metadata and scope. Both manual and agent edits pass through the same canonical validation.

### Agent notation

Complete example for one bar and two tracks:

```text
BAR 3

beat 1
  t_lead [rest B4]
  t_bass [G#2 rest]
beat 2
  t_lead [C#5]
  t_bass [rest:2 D#3 rest]
beat 3
  t_lead [B4 rest]
  t_bass [G#2 rest]
beat 4
  t_lead [G#4]
  t_bass [rest:2 F#2 rest]
```

Track metadata maps `t_lead` and `t_bass` to display names and preset IDs. The parser relies on labels, delimiters, and token counts, not visual whitespace alignment.

Grammar and semantics:

- Pitch tokens use scientific pitch notation, such as `G#2`, `Bb3`, or `C4`; enharmonic spellings map to the same playback pitch.
- `rest` denotes silence. `hold` extends the immediately preceding active pitched note. A new pitch starts a new note, even when it repeats the same pitch.
- `hit` triggers an unpitched instrument. Its preset controls the sound's decay; `hold` is not allowed on percussion rows.
- Each row fills exactly one beat. Tokens have optional positive integer `:weight` suffixes, defaulting to 1; duration is weight divided by total row weight. Row item counts may differ between tracks. No nesting or executable expressions are supported.
- Sustains may cross beats and bars. A leading sustain requires an active preceding note in the validated context; it cannot invent one. Boundary-crossing notes are protected unless explicitly selected in full; see the scope contract below.
- In a full bar replacement, all four beats and all scoped tracks must appear exactly once. For a partial replacement, the envelope specifies the exact required beats/tracks.
- Missing content is invalid, not implicit silence, deletion, or preservation. Silence must be explicit.
- Agent targets may be smaller than a beat, including one note. The adapter may expose full beat rows for readability, but marks every noneditable event and rest interval as protected. Output coverage and edit authority are separate: returning a full row never authorizes changing its protected portions.
- **Initial-demo restriction:** default note velocity per preset; per-note accents and microtiming are deferred. Manual per-track volume is required. Fixed long–short ratios, including swing-like timing, are already supported through weights.

The tutorial establishes examples and semantics. Validate reliability with actual model outputs; production limits are defined in ROADMAP.md. End-to-start loop ties are deferred; partial selections follow section 7.

### Context size

Whole-song reads return metadata and compact per-track/bar summaries. Detailed reads default to 2–4 bars, with additional surrounding bars available as read-only context. Longer generation can proceed in passages inside a single proposal, validated as a whole before preview. Reusable named patterns were discussed but are deferred from the initial stored model; they must not be assumed implemented.

## 7. Change contract

The application establishes an allowed scope before generation. A request carries the accepted revision, instruction, selected track IDs, time range, and allowed metadata/track changes.

### Three separate context sections — required

Every creative request and repair attempt explicitly separates:

| Section | Purpose | Contents |
|---|---|---|
| `edit_task` | What the model is expected to accomplish | User instruction, requested target, musical intent, and preservation requirements such as keeping rhythm unchanged |
| `edit_permissions` | What it may change | Backend-issued scope ID, base revision, stable track/event IDs or allowed time regions, allowed fields/operations, insertion/deletion rights, and metadata permissions |
| `reference_context` | Information to help it compose | Protected surrounding music, chords/key, other tracks, project brief, instrument capabilities, and composition guidance |

The backend also provides an `output_contract`: required replacement rows or exact event-operation fields. This specifies how to return a candidate, not additional edit permission. A broad task description or a model-generated plan cannot override the issued permissions. Reference content is data/guidance, never authority to broaden the scope.

Keep `edit_task` and `edit_permissions` near the start of model context, and label reference blocks explicitly READ ONLY. Provide an event-ID-to-notation map so the model can distinguish a selected note from identical pitches elsewhere. The map may use bar/beat, track ID, and one-based token index for the input snapshot; persistent identity always comes from event IDs, never token positions in generated output. Include a brief permission reminder with the output contract.

### Selection semantics and permission mask

**Demo AI scope policy:** Manual selections remain authoritative for direct UI editing and playback. AI composition currently resolves `{ kind: "song" }` regardless of the manual selection shown in the UI. The dispatcher may narrow work into explicit track/bar tasks, but it cannot expand beyond the song or alter structural permissions.

- Time intervals use exact rational beat coordinates and half-open bounds `[start, end)`. Bars/beats in the UI and notation are one-based; absolute beat zero is the song start.
- Horizontal, vertical, and rectangular selections become explicit track IDs plus time intervals. Only events fully contained in the allowed interval are writable by default. Events crossing either edge remain protected. New events must fit wholly within an insertion-authorized interval and respect protected notes and monophony.
- A note selection uses stable event IDs, not a bounding rectangle. Notes between selected events are not implicitly editable. Clicking one note defaults its permitted temporal span to its original full span; a pitch-only instruction narrows allowed fields to pitch. Moves or extensions beyond that span require explicit permission resolved from the user's requested destination and reflected in the visible scope.
- Permissions distinguish changing pitch, onset, duration, deleting existing notes, and inserting new notes. Rewriting a passage may allow all of these within its interval; changing one note's pitch permits none of the other actions. Fail closed if required permissions are unclear.
- Track name, instrument, volume, track addition/deletion, tempo, key, and song length each require explicit metadata/structural permission. Permission to edit every note in a track or song does not automatically grant these changes. Existing manual mix levels are protected by default.
- Multiple selected intervals/events form a union of explicit permissions, not permission to change the gaps between them. An empty selection is represented explicitly by the UI's displayed whole-song target rather than inferred from absent IDs.
- Extra context reads never mutate the permission mask. If a request is impossible within scope, preserve supplied music rather than changing protected content. No model-defined scope expansion.

### Read, propose, validate, apply

1. Resolve an immutable whole-song AI scope against the accepted revision. Store it under `scopeId`; the model cannot rewrite it.
2. Build dispatcher context: role, whole-song overview, instrument catalog, user request, task rules, example, and strict task output contract. The dispatcher does not receive or write notation.
3. Validate the dispatcher plan deterministically. Every task targets one existing or declared new track, covers contiguous bars, matches the instrument, and uses only catalog-backed instruments.
4. Run rhythm workers with only their task, rhythm tutorial, and local target rows. Then materialize hits or run a pitch worker with the locked rhythm and task harmony/register guidance.
5. Aggregate all worker rows into one candidate, validate it against the original song revision and scope, and save one update. No partial worker result is published.
4. Parse the candidate onto an isolated copy. Normalize weights/ties into canonical events and compare against the base snapshot. Validate the actual change, not the model's description or raw text diff. Equivalent notation such as `[C5 hold]` versus `[C5]` need not count as a musical change.
5. Preserve every protected event's ID, track, pitch, onset, duration, and velocity, and all protected metadata. Preserve protected silence too: inserting a new note outside allowed intervals is a scope violation even if no original event was changed. Reconcile unchanged events deterministically; reject ambiguous mappings rather than treating a deleted/recreated protected event as a permitted edit.
6. Check field-level permissions on selected events, new/deleted events, timing boundaries, and structural changes; then run normal musical validation. Reject the whole proposal on violation. Do not partially apply it or quietly discard unauthorized changes.
7. Return structured errors containing code, affected track/event/location, offending field, and the relevant permission. A repair attempt receives the same scope and clearly labeled reference context. Example: `SCOPE_VIOLATION: n18 onset changed; only n17.pitch is writable`.
8. Check scope ID and base revision again at acceptance, serialize the write, and apply atomically. Stale state requires a fresh request/scope; never automatically enlarge or rebase authority.

Current worker-facing contract (prompt version 4; canonical backend envelopes remain internal):

```json
{
  "rows": [{"rowRef": "r1", "pattern": "x---"}]
}
```

The dispatcher returns tasks and new-track descriptors. Rhythm workers return `rowRef` plus a four-slot `pattern`; pitched workers return `rowRef` plus actual `pitches`. Short t1/new1 and r1 aliases replace persistent IDs in model context. The backend attaches scopeId/baseRevision from trusted state and rejects administrative output fields. Multiple new tracks are allowed, but each must have one matching task and each task is one track only.

See AI-PROMPTS.md for the full current prompt, example and tracing contract.

- Backend assigns stable IDs to new-track references. New tracks are silent outside supplied passages.
- Existing track names never determine identity.
- All replacements in a proposal apply atomically to a copy. Reject overlapping conflicting replacements.
- Track creation/deletion and global property changes require explicit permission in the allowed scope.
- Compare canonical before/after states to enforce scope; do not trust only the model's declared range.
- Whole-track replacement supplies all its bars; whole-song replacement supplies the full song. Scoped replacements supply every required cell in their scope.
- Unaffected note IDs remain stable. Define a deterministic ID preservation policy for unchanged notes inside replacements before coding.
- Stale `baseRevision` rejects acceptance. Never overwrite manual edits made while a proposal was generating.

## 8. Tools and request graph

The current demo does not expose a general-purpose tool loop to the model. The dispatcher receives a compact whole-song overview and the complete instrument catalog as prompt data. Rhythm and pitch workers receive only their own task and local row bindings. Deterministic backend nodes bind references, compile notation, validate, aggregate, and persist.

Manual commands remain deterministic. Natural-language requests—including combined transpose/rhythm edits—use one replacement path without an intent classifier or explanation output.

Graph flow:

```text
resolve whole-song scope → dispatcher task plan → validate task plan
                                      ↓
                         rhythm workers (waves of four)
                                      ↓
                    hit materialization or pitch workers
                                      ↓
                         aggregate validation → save
```

The dispatcher runs once and returns explicit harmony, rhythm and pitch directions per track, with a `melodic` or `harmonic` task type. Track names are available in song context; a new track name is returned only in its `newTracks` descriptor. Arpeggios use the ordinary melodic rhythm→pitch path. Harmonic tasks use rhythm→deterministic block-chord materialization from a structured progression, register, and voicing instruction; rhythm attacks mark chord changes and holds sustain all chord tones. Partition generation into at most four contiguous bars and 32 track-beat rows, keeping instruments separate. Workers never receive notation from other tracks. Plans and context never grant authority. No partially generated bars are accepted/saved.

**Repair budget:** two repairs per passage; an overall run deadline remains mandatory. Repair includes the rejected output and deterministic diagnostics with row/field locations. Provider failures are not retried as musical errors. Cancellation prevents late output from publication.

Run state holds the immutable original scope/revision, shared plan, row bindings, passage position, working proposal, context, rejected output, diagnostics, attempts and status. Fresh state per request; no conversation memory.

Progress: planning, passage, reading, composing, validating, repairing, preview_ready, failed, cancelled, plus streamed visible provider summaries/output. Save exact prompts, schemas, responses/partial streams, bindings and validation results for debugging. Old logs may contain retired classification/explanation statuses.

## 9. Skills and guidance

A compact backend-owned rhythm tutorial is loaded for rhythm workers; instrument capabilities are included directly in the dispatcher prompt:

- `rhythm.md`: four-slot beat patterns, rests, holds, grooves, and percussion rules.
- `compose.md`: retained reference material for future pitch/composition improvements; it is not sent to the dispatcher or current workers.
- `instruments.md`: preset catalog and limits, generated from or checked against the actual registry.
- `editing.md`: scope preservation, complete replacements, track identity, and notation examples.

Guidance improves generation; deterministic validation enforces correctness. Musical quality still needs listening. Scale membership is not universally a hard constraint: reject out-of-scale notes only when explicitly required, otherwise report a warning if useful.

## 10. Persistence and concurrency

### Library location and layout — confirmed

Use local files, not MySQL or another database. On first launch, create a `songs/` directory relative to the resolved application root, not the shell's incidental working directory. Optionally accept a backend `SONGS_DIR` setting for a different root. Resolve all song operations under that root using backend-generated IDs; do not derive paths from titles or accept arbitrary client paths. The library need not be inside a clone's working tree if configured elsewhere.

Planned layout:

```text
application/
  src/
  songs/                         ignored by application Git repo
    <song-uuid>/
      song.json                  authoritative accepted document
      song.txt                   generated readable representation
      .git/                      independent per-song revision history
      .gitignore                 excludes local runtime/export files
      .local/                    run logs, temporary proposals, recovery data
      exports/                   generated audio; ignored by song Git repo
```

Each song is a separate local Git repository. Do not commit user songs to the application's source-code repo or automatically create/push GitHub repositories for them. Git must be available for history; report its absence with setup guidance. Use app-local/per-command commit identity without modifying the user's global Git configuration.

Application guidance ships with the app, not separately editable in every song project for the initial demo. Instrument implementations are versioned application assets. No credentials belong in song documents, Git commits, or exports.

### Authoritative song document

Required envelope fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Integer format version, independently versioned from edits |
| `id` | Backend-generated song UUID; matches the directory name |
| `title` | User-facing name; never a filesystem path or identifier |
| `createdAt`, `updatedAt` | UTC ISO timestamps controlled by the backend |
| `revision` | Monotonically increasing accepted-edit number, used for concurrency checks |
| `brief` | Persistent musical intent, separate from chat history |
| `music` | Tempo, meter, bar count, optional key/mode, and track array |

Tracks contain stable ID, display name, preset ID/version reference, `volumeDb`, saved mute state, and note events. Solo is a transient audition control by default, not a saved/exported mix decision. Track gain and saved mute state affect export; transient solo does not. Notes contain stable IDs, rational `start`/`duration` in beats, velocity, and either scientific pitch or an unpitched trigger. Validate field compatibility against the instrument registry. Initial scalar note velocity can be preset-derived even though the schema retains it for later editing.

Illustrative document fragment (one track shown; omitted beats contain no events):

```json
{
  "schemaVersion": 1,
  "id": "27f9d883-a440-46a8-b93f-960215bd47fe",
  "title": "Dungeon Theme",
  "createdAt": "2026-09-21T12:00:00Z",
  "updatedAt": "2026-09-21T12:05:00Z",
  "revision": 7,
  "brief": "A mysterious, gently swinging dungeon loop",
  "music": {
    "bpm": 120,
    "meter": [4, 4],
    "bars": 4,
    "key": { "root": "C", "mode": "minor" },
    "tracks": [{
      "id": "track-bass",
      "name": "Bass",
      "instrumentId": "chip_bass",
      "instrumentVersion": 1,
      "volumeDb": -6,
      "muted": false,
      "notes": [{
        "id": "note-001",
        "kind": "pitched",
        "pitch": "C3",
        "start": { "n": 0, "d": 1 },
        "duration": { "n": 2, "d": 3 },
        "velocity": 100
      }]
    }]
  }
}
```

Sparse canonical events imply silence where there are no notes. The agent-facing adapter must emit explicit `rest` tokens for that silence. The example's human-readable track/note IDs are placeholders for opaque stable IDs. Generated UUIDs are suitable for new songs, tracks, and notes. JSON ordering and formatting must be deterministic for useful Git diffs.

On load, validate schema and IDs before playback. Reject unsupported future schema versions without rewriting them. Implement deliberate migrations when formats evolve and retain a recoverable previous version. Stable event IDs must survive save/load and unchanged-content rewrites.

### Library UI and indexing

- The sidebar lists title and last-modified time; New, Open, Rename, and Duplicate are available. An empty library shows a clear Create Song action.
- New creates a UUID folder, a valid initial document, generated notation, and initial local history. An interrupted creation must not appear as a healthy song.
- Open loads the accepted document through the backend. If a proposal or active request exists, resolve it explicitly before switching: stay, accept a ready proposal, or discard/cancel and switch. Never silently accept or apply results to the newly opened song.
- Rename changes title/timestamps/revision and records an accepted revision; the directory stays unchanged.
- Duplicate copies accepted musical content into a fresh song identity with new timestamps and independent history. Regenerate track/note IDs consistently; do not copy the old `.git`, run logs, proposals, or exports.
- Initially scan song directories and read validated metadata from `song.json`; no mutable catalog/index is authoritative. Malformed or unreadable songs appear as unavailable entries without blocking healthy songs. Never overwrite invalid data automatically.
- Deletion, sharing, external import, and multi-user access are outside the initial library UI. A rebuildable metadata cache may be introduced if scanning proves slow.

### Save, history, and recovery

Backend owns project writes. Use atomic replacement of `song.json` through a temporary file on the same filesystem and serialize accepted mutations per song. Recheck the expected revision under the write lock. Increment revision and updated timestamp for each accepted persistent change, including metadata/mix edits. Group manual drag gestures into a single edit, not a commit per pointer movement.

File replacement and Git commit are not one atomic transaction. After the authoritative save, regenerate `song.txt` and commit the accepted tracked files with the application revision in the commit message. Report save success separately from history success. If generation/commit fails, mark history pending, preserve the recoverable last committed version and current document, and offer/retry history recording before the next persistent mutation. Never roll back or claim a successful commit silently. On restart, reconcile a newer valid document with Git and regenerate stale/missing derived notation; never treat `song.txt` as the authority.

Undo restores the selected earlier musical state as a new accepted revision and commit, preserving song identity and original creation timestamp. Revision numbers must not decrease. Do not use destructive Git reset. Scope proposals always reference the current application revision, not only a Git hash. Final crash-recovery and retry mechanics are an engineering task with explicit tests.

**Concurrency:** one active agent request and one pending proposal per song. Manual edits remain available but invalidate a pending proposal's revision. Keep the original proposal for inspection; ask the user to regenerate rather than silently rebasing it. One backend process owns a library; locking and mutation serialization are specified in ROADMAP.md.

## 11. Validation and acceptance criteria

Required deterministic checks: supported schema, unique IDs, known instruments, track count, pitch ranges, melodic-track monophony, harmonic chord-event overlap consistency, bar/beat/cell coverage, valid sustains, supported timing, song bounds, allowed edit scope, and current revision.

The demo is ready when:

1. A prompt generates a valid four-bar multitrack song that can be played and loops without scheduling gaps.
2. A selected bass passage can be rewritten while every out-of-scope canonical event remains unchanged.
3. One proposal can add an instrument track and edit an existing track, accepted atomically.
4. Invalid weights, missing required rows, or illegal holds produce precise errors and exercise the bounded repair path.
5. Rejecting a proposal leaves accepted data and Git history unchanged.
6. A manual edit during generation prevents stale acceptance.
7. Manual note edits, mute/solo, independent track-volume sliders, tempo, and looping work without model calls. Volume changes are audible during playback, persist across reopening, survive musical edits, and are reflected in audio export.
8. Saving and reopening reproduces musical content and instrument choices; undo restores an earlier accepted musical state.
9. Unsupported instruments and a ninth track are rejected before preview.
10. A 32-bar project can be inspected through summaries and targeted reads without injecting all notes into every request.
11. Audio export works: WAV containing one exact loop, using saved mix levels and mute state. Use a brief edge fade to suppress boundary clicks; no appended tail or cross-loop ties in the initial implementation.
12. Horizontal, vertical, rectangular, and single-note selections produce explicit permissions. A one-note pitch edit preserves adjacent notes, timing, other instruments, and mix levels even when all are supplied as context.
13. Adversarial candidates that shift a protected note through weight changes, add notes to protected silence, delete/recreate protected events, change unauthorized volume, or extend boundary-crossing holds are rejected atomically with specific scope errors.
14. Reading additional bars or receiving a model-generated scope claim never expands backend permissions. Boundary-crossing notes and gaps between selected notes remain protected unless explicitly authorized.
15. First launch creates the library. New/open/rename/duplicate work with stable IDs, independent per-song histories, and no application-repo song commits. Restart restores the saved musical content and mix. A malformed song does not break the library.
16. Concurrent/stale saves cannot overwrite newer state. Interrupted file writes leave a valid recoverable document; failed history recording is reported distinctly and recoverable. Unsupported schema versions are not silently rewritten.

Test parsers and adapters using fixtures for rests, repeated pitches, cross-bar sustains, triplets, percussion, partial replacements, and mixed create/edit operations. Include canonical → notation → canonical round-trip checks for representable musical content. Test scope protection and stale revisions separately. Verify playback and the UI through listening and browser interaction; syntactic validation alone is insufficient.

## 12. Readiness for roadmap and remaining engineering work

The major product choices are settled enough to write the roadmap: TypeScript/Node/LangGraph.js, OpenAI initially, weighted rhythm notation, precise edit permissions, manual track mixing, 4/4 with 1–32 bars, and a local file library with per-song Git history. Routine defaults should be chosen by the implementer rather than requiring more preference questions.

Carry these items into the roadmap as concrete work, not unresolved product blockers:

1. **First risk-reduction milestone:** exercise GPT-5 nano on real generation, a single-note/scoped creative edit, and a combined add-track/edit request. Measure format validity, scope preservation, repair count, latency, cost, and listen to results. The existing audio examples verify the deterministic notation prototype, not model composition quality. Adjust model configuration or notation based on evidence before building the full UI.
2. Freeze typed schemas, rational arithmetic limits, event-ID reconciliation, adapters, and scope fixtures. Ensure model-readable context does not accidentally grant writes.
3. Finalize the modest instrument registry and ranges through listening checks; verify mixing headroom and click-free gain changes.
4. Define predictable default key actions: changing key metadata is distinct from transposing notes or creatively recomposing into a mode. Label explicit actions; clarify only musically ambiguous natural-language requests.
5. Implement atomic persistence, Git failure recovery, and library operations with the contract in section 10.
6. Choose simple playback/export boundary defaults: no ties across the end/start of the loop initially; exact loop-length WAV export with a brief edge fade rather than unbounded tails. Document these defaults in the UI/export behavior and verify by listening.
7. Use backend environment configuration for API credentials, excluded from Git; do not collect keys in song documents. Store request logs locally; persistent graph checkpointing is not required initially.

Suggested roadmap order: shared notation/scope contracts and minimal real-model experiment → canonical storage/library and proposal lifecycle → browser instruments and editor/mixer → integrated agent UI → recovery/export/polish and acceptance checks. Some sound prototyping can run alongside the initial model experiment. Roadmap creation and application implementation remain separate steps.

## 13. Deferred experiments

Jev (TypeSafe) is a possible future selector for a curated rhythm library. Candidate units are coordinated one- or two-bar grooves containing percussion and bass rhythms, with metadata for meter, density, syncopation, and style. A generative model supplies pitches and phrase development; optional short pitch-contour templates could support that work. Neither the library nor Jev integration is required for the demo. Evaluate quality and total latency against the OpenAI baseline before adopting this architecture. OpenRouter integration is also deferred.
