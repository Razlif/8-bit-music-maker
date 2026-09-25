# Implementation and repair status

## Fresh-song starter channels — 2026-09-25

Fresh songs now start with six empty channels: Bright Lead, Chip Bass, Kick, Hi-Hat, Snare, and harmonic Harmony using the Chip Pad preset. The dispatcher is instructed to fill all six for broad, unrestricted song-creation requests, while respecting narrower requested ensembles. Updated the specification, prompt guide, roadmap, README, and starter-song expectations in test sources. Typecheck verification is pending; tests have not been run.

## Harmonic block-chord track support — 2026-09-25

Implemented the missing `harmonic` task path after a real request failed with `HARMONIC_TRACK_PIPELINE_NOT_IMPLEMENTED`. The dispatcher contract accepts a structured progression, track type, register, and voicing. The rhythm worker still receives only rhythm instructions; deterministic backend materialization maps its attacks to progression chords and holds to sustained chord tones. Harmonic tracks allow validated simultaneous pitched notes, notation round-trips chord tokens, and browser/offline audio uses polyphonic synthesis. Added the Chip Pad preset for a sustained chord sound. Arpeggios remain melodic rhythm→pitch tasks.

Verification: `npm run typecheck` passed after implementation. Automated tests and live provider generation/audio listening have not been run for this change; model compliance and sound quality remain to be evaluated in the UI.

## Per-track orchestration refactor — 2026-09-24

The active demo path is now one LangGraph flow for every AI request:

```text
whole-song scope → GPT-6 Luna dispatcher → validated one-track tasks
→ rhythm workers (four-task waves) → deterministic hits or pitch workers
→ aggregate candidate → original-snapshot validation → one save
```

The dispatcher receives the compact song overview, the complete seven-instrument catalog, and the user request. It does not receive or write notation. Each worker receives only its own task and local row bindings; pitch workers receive a locked rhythm and return actual note names, while percussion never enters a pitch phase. Multiple new tracks are supported and materialized transactionally in the aggregate candidate. Dispatcher plans are rejected before workers for duplicate tracks, invalid ranges, non-contiguous sections, instrument mismatches, unused new tracks, pitch guidance on hits, or more than eight total tracks.

For the demo, manual UI selection remains available for editing/playback but AI composition always resolves whole-song scope and the compose panel says so explicitly. This removes the previous ambiguity where a natural-language request could be routed through a different architecture merely because a selection was marked.

Verification for this refactor: `npm run typecheck` passed; server suite passed with 22 tests; the complete core/server suite passed before final documentation edits. No paid provider call was made. Live model quality and latency still require a configured key and listening evaluation.

## Scope-driven musical replacement — prompt version 3 (2026-09-21)

Removed the active classifier, intent categories, natural-language exact-edit branch, explanation/clarification output route and classifier model setting. Combined requests now go through one musical replacement path. Existing explicit UI commands remain deterministic. An old OPENAI_CLASSIFIER_MODEL entry is ignored without editing the user's .env.

The current request LangGraph resolves whole-song AI scope, calls one dispatcher, validates one-track tasks, then invokes bounded rhythm workers followed by deterministic hit materialization or pitch workers. The dispatcher plan is explicit rhythm/role/harmony guidance and never authority. Passages are at most four contiguous bars and 32 track-beat rows. Multiple new tracks are supported in one aggregate. The final candidate is validated against the original snapshot before the single save; no partial saves or A/B proposal stage are active.

Prompt ordering: role/boundaries, compact language tutorial/examples, read-only overview/instruments/shared plan/adjacent-bar notation, exact user request, edit boundary, masked editable snippet, output shape. Model output is {newTracks,rows:[{rowRef,body}]}; short row/track aliases replace persistent IDs. The backend attaches scopeId/revision from trusted state. Missing/extra/duplicate refs and model-supplied administrative fields fail. Selected-note replacement allows insertions only within the note's original span; gaps, protected neighbors and metadata remain protected. Leading holds across passages are covered by tests. Repair preserves the rejected model-facing output and precise diagnostics; protected-note errors are translated to musical locations rather than unexplained UUIDs.

Kept streamed summaries/output, saved trace history, cancel and original stale-acceptance protection. UI now displays passage count. GPT-5 nano stays the default; plan budget 4,000 output tokens, replacement budget 16,000, two repairs per passage, overall 180-second default deadline. No automatic model upgrade or deadline increase. Longer songs may still exceed the deadline; live latency/quality remains unverified.

Verification: typecheck passed; production build passed (existing Vite >500 kB bundle warning); 19 core tests passed; 27 server tests passed with --testTimeout=20000; all 6 Playwright tests passed. New/revised tests cover mixed edits without classification/planning for a tiny selection, shared-plan reuse, bounded 32-bar/eight-track generation, one new track across passages, sub-beat protected pitch/timing/velocity, complete cross-bar selected notes, cross-passage holds, forbidden plan-driven scope expansion, cancellation after planning, strict identity rejection, precise repair feedback, and persistence. No paid OpenAI calls, user-song edits or server restarts were performed. README, SPEC, ROADMAP, RUNNING and AI-PROMPTS reflect the new flow; historical entries below describe earlier versions, not the active contract.

## Streaming and actionable repair — 2026-09-21

Inspected saved run 8160536d-f5d5-4b1d-a87f-9e8291d07461 without modifying it: first candidate used the song ID instead of scope ID and returned 32/64 rows; repair invented scope-4bar-groove and returned 16/64. Validation rejected scope identity, then the next repair hit the overall 180-second deadline. Classification ~10s, first composition ~73s, first repair ~47s. First composition: 7,708 input tokens and 9,856 reasoning tokens. This is a confirmed malformed-output/poor-feedback case, not evidence of an API outage.

Prompt version 2: eliminated the duplicate requiredRows checklist, specified exact identity values and total required row count, and repair now includes the rejected wire-format candidate plus deterministic identity/coverage/duplicate/bracket/token/range diagnostics. Token diagnostics include track, bar, beat and 1-based body character position. Existing full musical/scope validation remains authoritative. Comparing the same saved input offline reduced first-prompt text from 15,817 to 11,650 characters (26%); token/latency improvement has not been measured live.

Switched the adapter to streaming Responses, structured output, store:false, reasoning.summary:auto. Model remains gpt-5-nano; output budget, deadline and two-repair maximum unchanged. Visible summary/output deltas are saved in batches, flushed on interruptions, and relayed as cumulative SSE snapshots. Final responses include usage, status, request/response IDs, summaries and incomplete/refusal details; no encrypted reasoning is requested or serialized. Durable progress entries outlive the bounded SSE replay buffer. UI displays provider-supplied summaries, partial unvalidated output, character count, connection state and the existing Cancel button. Account/model summary support remains a live verification gate.

Backend verification: 20 tests passed, including stream interruption, encrypted-data exclusion, diagnostics and repair-feedback round trip; production build passed. Browser verification: existing four editor/proposal/audio tests passed; both observability tests passed on the final focused rerun, including live SSE summary display before a proposal exists. The initial new SSE test incorrectly guessed the selected song from list order; corrected it to use the actual POST creation response, then reran successfully. No paid provider calls, user-song edits or automatic server restart were performed.

## Observability update — 2026-09-21

Added ordered, atomic run checkpoints: starting snapshot, exact API messages/output schema, model settings, visible response/refusal, provider request ID, timings, usage, adapted candidate and validation results including expected/received scope identity. Requests are checkpointed before provider calls. Failed request checkpointing prevents that call. Terminal events persist without waiting for provider completion. Traces remain readable after restart; storage errors are surfaced. The adapter does not serialize credentials, headers or hidden reasoning.

UI: independent AI activity, elapsed time/deadline, history selector, readable prompts, full trace JSON link and stage/usage timeline. Existing cancellation remains available. Full trace bodies are fetched only with the inspector open. AI-PROMPTS.md documents current templates/placeholders, model access and repair limitations. No model, timeout or editing-permission changes.

Verification: 19 core tests and 17 server tests passed; server command `npm --workspace apps/server run test -- --testTimeout=20000`. Initial concurrent test/build run exceeded the default 5-second limit in two filesystem/Git tests (one pre-existing); the extended test timeout passed without changing application deadlines or assertions. Five Playwright tests and production build passed. New coverage includes request checkpoint ordering, failed checkpoint preventing provider access, malformed raw-response capture, scope mismatch diagnostics, persistence after restart and browser prompt inspection. No paid model calls were made. The reported live timeout is not claimed fixed by observability alone; musical-quality evaluation remains pending.

## Previous repair pass

Updated 2026-09-21 after the review-driven repair pass. This replaces the earlier overly optimistic status report. The original test count included generated duplicate tests; the current counts below come from fresh runs.

## Reported defects

| Finding | Repair | Evidence |
|---|---|---|
| Protected notes rejected when unchanged / deletions accepted | Compare every protected event's identity, track, canonical pitch, exact timing and velocity; separately protect metadata and silent intervals | `packages/core/test/regressions.test.ts` |
| Cross-beat holds / incorrect serialized durations | Compile complete touched tracks with boundary context; clip each serialized event to each beat; exact BigInt weight reduction; reattach IDs/velocities | Core regressions and all four tutorial examples round-trip through the production adapter |
| Preview `/api/api/…` request | One API prefix; publish ready only after proposal exists; use run snapshots and close terminal SSE | Browser proposal workflow and API lifecycle tests |
| One-pass audio / non-live faders | Recurring transport events, explicit cleanup, bar-boundary candidate switching, live gain ramps and transient solo | Browser audio test: three loop attacks, stopped attack count unchanged, live gain approximately -30 dB, switch observed |
| Concurrent save races | Per-song mutex covers reload, revision/fingerprint check, atomic replacement and history; library ownership lock | Concurrent rename test: exactly one winner; second process owner rejected |
| Placeholder orchestration and absent editing/export | Endpoint invokes LangGraph; separate classifier/composer; deterministic exact edits; bounded repairs/passages; abort/deadline; real manual editor, A/B and WAV export | Controlled graph/API tests, browser manual workflow and audio export checks |

Also repaired `.env` loading and app-root path resolution, replaced permissive mutation schemas, added history restore/retry and durable accepted-proposal receipts, implemented local status/usage logs, and removed/upgraded dependencies with known audit findings.

## Verification run

- `npm run typecheck` — passed for core, server and browser.
- `npm test` — **32 tests passed**: 19 core / tutorial tests and 13 server / graph / storage / API tests.
- `npm run test:e2e` — **4 tests passed** in Chromium: studio shell; controlled preview URL/A-B/discard; no-key create/rename/draw/move/mix/export/reload; live audio and offline rendering.
- `npm run build` — passed. Windows sandbox blocked esbuild's path resolution; the approved build outside that sandbox succeeded. Vite warns about the approximately 549 kB main bundle; this is a size warning, not a failed build.
- Production `npm start` — started with an isolated temporary library. `/`, its hashed JavaScript asset, and `/api/health` returned HTTP 200; health correctly reported no agent key. Test server stopped afterward.
- Dependency installation/audit after upgrades — **0 known vulnerabilities** reported by npm.
- `npm run eval:live` — correctly reported **LIVE_EVAL_PENDING**, because no OpenAI API key is configured. No provider calls were made and no real-model quality result is claimed.
- Desktop (1440 px) and narrow (600 px) screenshots visually inspected. Browser checks confirm no document-width overflow. Screenshots are in ignored `apps/web/test-results/studio-desktop.png` and `studio-narrow.png`.

Audio evidence from the actual browser implementation (not the tutorial renderer): one second at 240 BPM / one bar exports 176,444 bytes, including the WAV header, 44,100 stereo frames and 16-bit PCM. Lead peak was 1,240; reducing gain 12 dB reduced peak to 312 and energy by roughly 16×. All-muted output peak was 0. All seven presets rendered non-silent output. The test exercises the same factories used by live playback and export. Human listening for timbre, clicks and musical quality is still a separate check.

Storage evidence includes atomic-write failure preserving accepted JSON, post-save Git failure returning `saved: true / history: pending`, blocking later mutations while history remains pending, retry without another revision/commit, history restore as a new revision, stale/conflicting saves, external-edit detection, duplicate acceptance after reopening, and preserving malformed JSON instead of overwriting it.

## Roadmap mapping

| Slice | Implemented | Remaining gate / limitation |
|---|---|---|
| 01 Domain | Strict schemas, safe exact fractions, presets, validation | Further adversarial property-based tests would improve coverage |
| 02 Notation | Weighted rows, holds across beats/bars, per-beat clipping, exact fixture/tutorial round-trips | None of the reviewed notation failures remain |
| 03 Scope / commands | Protected canonical diffs, explicit metadata/new-track permission, complete row coverage, stable IDs, deterministic manual commands | Scope expansions use explicit UI selection / new-track checkbox or clarification, not a general expansion dialog |
| 04 Agent | Actual graph, official OpenAI SDK, separate classification/composition, exact edit route, bounded repairs, <=4-bar creative passages | Ten real-model evaluations and musical listening are pending credentials |
| 05 Library | Root-relative files, mutex/process lock, atomic writes, history/retry/restore, duplicate, accepted receipts | Corrupt-file recovery is documented manual recovery from Git/snapshot; no automated UI repair action |
| 06 API / lifecycle | Validated commands, bounded SSE replay, snapshots, cancellation, deadline, idempotent/stale acceptance, local logs; reopening a song reconnects to its active run/proposal | Server restart intentionally interrupts rather than resumes generation |
| 07 Audio | Seven presets, recurring playback, cleanup, gain/mute/solo, selection loops, candidate switching, master limiter | Human listening / eight-track stress audition not claimed |
| 08 Shell | Library/create/open/rename/duplicate/history, responsive studio, clear errors/no-key state | Narrow screens stack panels rather than drawer controls |
| 09 Editor | Draw/move/resize/delete, percussion toggle, note/track/rectangular/ruler selections, fractional snap, faders | Further gesture edge-case coverage remains useful |
| 10 Integrated UI | Request/progress/cancel, preview fetch, canonical change counts, A/B, accept/discard, stale warning | End-to-end live-provider acceptance remains unverified; per-note diff overlay is not yet implemented |
| 11 Export / delivery | Shared-factory WAV, exact frame count/fades, saved mix, startup instructions and recovery guidance | Full roadmap acceptance is not claimed while the above gates remain |

No Strudel code/dependencies were introduced. Existing tutorial audio and user song folders were not changed. See `RUNNING.md` for startup, `.env`, editor controls and recovery instructions.
