# Music language tutorial — draft 0.1

This is the app's compact musical language. It describes musical events, not synthesizer settings. A track selects an instrument preset; the application handles its sound. AI workers currently return compact JSON rhythm and pitch contracts; the backend uses this notation internally to validate and materialize the result.

The audio below is generated directly from the complete examples in this document by [the example renderer](scripts/render-language-examples.mjs). These are illustrative chip sounds, not the final instrument library. This is a notation prototype, not the application implementation.

## 1. A song is bars, beats, and instrument rows

Our demo uses 4/4: four quarter-note beats per bar. At 120 BPM, each beat lasts half a second, so one bar lasts two seconds.

```text
SONG | meter=4/4 | bpm=120
TRACK lead | instrument=bright_lead
TRACK bass | instrument=chip_bass

BAR 1
beat 1
  lead [C5 E5]
  bass [C3]
```

This is a fragment, not a complete playable song. A complete bar also needs beats 2, 3, and 4, with a row for each declared track. A scoped edit may include fewer tracks/beats if its surrounding request explicitly identifies that scope.

`lead` and `bass` are stable track IDs. Friendly display names belong in project metadata. Instrument IDs come from the app's preset library. Row order and indentation do not determine timing; bar numbers, beat numbers, track IDs, and brackets do.

## 2. Every row fills exactly one beat

Without weights, items share the beat equally:

| Row | Meaning in 4/4 |
|---|---|
| `lead [C5]` | One quarter note |
| `lead [C5 D5]` | Two eighth notes |
| `lead [C5 D5 E5]` | Three eighth-note triplets |
| `lead [C5 D5 E5 G5]` | Four sixteenths |
| `lead [C5 D5 E5 F5 G5]` | Five equal notes within the beat |

No `/16` grid label is needed. The number of items determines the subdivision. One track can play three notes while another plays two in the same beat; both start and end on the same beat boundaries.

Adding an item changes the timing of every item in that row. To insert a note without shifting the other onsets, explicitly redistribute the weights or replace an existing rest.

## 3. Notes, rests, holds, hits, and block chords

| Token | Meaning |
|---|---|
| `C5`, `G#2`, `Bb3` | Start a pitched note, using scientific pitch notation |
| `rest` | Silence for this item's share of the beat |
| `hold` | Extend the preceding active pitched note without restarting it |
| `hit` | Trigger the track's percussion instrument |

On a harmonic pitched track only, `{C4,E4,G4}` means play those chord tones together as one event. The backend derives these pitches from the track's structured progression, register, and voicing; workers do not need to spell chord tokens. A `hold` after a chord sustains every tone until the next attack. Arpeggios are not block chords: they use an ordinary melodic track with separate note attacks.

Every pitch occurrence is a new attack: `[C5 C5]` plays two notes; `[C5 hold]` plays one sustained note for the whole beat.

`hold` can cross a beat or bar boundary, but must have an active note immediately before it on the same track. `[rest hold]` is invalid. A standalone song cannot start with a hold. A partial edit starting with a hold needs preceding context and boundary validation.

Use pitch/hold tokens only on pitched instruments, and hit tokens only on percussion. Both types support rests. Percussion has a fixed preset decay: a weighted hit allocates time until the next item; it does not stretch the drum sample or envelope. For pitched examples, note gates occupy their allotted duration; a hold extends that gate. Preset articulation/release affects the audible envelope.

## 4. Weights express unequal durations

Add `:weight` to an item. An omitted weight is 1. Weights are positive whole numbers, interpreted relative to the other items in the row.

```text
lead [C5:2 D5]          # C gets 2/3 beat; D gets 1/3
lead [C5:3 D5:2]        # C gets 3/5 beat; D gets 2/5
lead [C5:3 D5]          # C gets 3/4 beat; D gets 1/4
lead [rest C5:2 rest]   # Rest 1/4, note 1/2, rest 1/4
```

Comments begin with `#` after whitespace; the `#` inside `C#5` is an accidental, not a comment.

The calculation is: **item duration = its weight / total row weight**, in beats. The agent supplies small relative weights; the adapter performs the arithmetic. Weights do not have to sum to four. `[C5:2 D5:1]` and `[C5:4 D5:2]` have identical timing; prefer the smaller ratio.

A 2:1 pair provides a triplet-style long–short feel. A 3:2 pair gives a milder long–short feel. These are fixed timing ratios, not a claim to reproduce every aspect of a human swing performance.

## 5. Listen: straight, gentle swing, stronger swing

All three examples use the same pitches, tempo, instruments, and kick on each beat. Only the relative timing of each lead pair changes. Each one-bar example plays twice in its audio file.

### A. Straight eighths — 1:1

Notice that both notes in each pair have equal duration.

[Play/download straight eighths](examples/audio/01-straight.wav)

```song straight
SONG | meter=4/4 | bpm=120
TRACK lead | instrument=bright_lead
TRACK kick | instrument=kick

BAR 1
beat 1
  lead [C5 E5]
  kick [hit]
beat 2
  lead [G5 E5]
  kick [hit]
beat 3
  lead [F5 A5]
  kick [hit]
beat 4
  lead [G5 D5]
  kick [hit]
```

### B. Gentle long–short — 3:2

The second note arrives slightly later than in the straight version, while the kick stays fixed.

[Play/download gentle swing](examples/audio/02-gentle-swing.wav)

```song gentle
SONG | meter=4/4 | bpm=120
TRACK lead | instrument=bright_lead
TRACK kick | instrument=kick

BAR 1
beat 1
  lead [C5:3 E5:2]
  kick [hit]
beat 2
  lead [G5:3 E5:2]
  kick [hit]
beat 3
  lead [F5:3 A5:2]
  kick [hit]
beat 4
  lead [G5:3 D5:2]
  kick [hit]
```

### C. Triplet-style long–short — 2:1

The first note now takes two-thirds of each beat, and the second takes one-third.

[Play/download triplet swing](examples/audio/03-triplet-swing.wav)

```song swing
SONG | meter=4/4 | bpm=120
TRACK lead | instrument=bright_lead
TRACK kick | instrument=kick

BAR 1
beat 1
  lead [C5:2 E5]
  kick [hit]
beat 2
  lead [G5:2 E5]
  kick [hit]
beat 3
  lead [F5:2 A5]
  kick [hit]
beat 4
  lead [G5:2 D5]
  kick [hit]
```

[Listen to all three in order: straight → gentle → triplet swing](examples/audio/00-timing-comparison.wav). Each version plays two bars, separated by a short silence.

## 6. Tuplets across beats and ties across bars

Three equal notes across **two beats** are easy with holds:

```text
beat 1
  lead [C5:2 D5]
beat 2
  lead [hold E5:2]
```

C lasts 2/3 beat. D starts at 2/3 of beat 1 and continues through the first 1/3 of beat 2, also totaling 2/3 beat. E occupies the remaining 2/3 beat. The parser merges the hold into D, so D does not retrigger.

The same principle works across a bar:

```text
BAR 1
beat 4
  lead [G5]
BAR 2
beat 1
  lead [hold rest]
```

This fragment describes G lasting one and a half beats. Musical phrases may cross bar boundaries freely, while complete bars still contain four beats. The current tutorial uses whole-bar songs. In these audio examples, the final note ends at the song boundary and playback restarts with the first event; tying the last note into the next loop is not defined yet.

## 7. Listen: a four-track, two-bar phrase

This example combines triplets, a five-note subdivision, a note tied across the bar, a two-beat triplet, rests, and percussion. Listen for the unbroken G between bars and the three evenly spaced C–D–E notes across beats 2–3 of bar 2. The two-bar phrase plays twice.

[Play/download the mixed-rhythm phrase](examples/audio/04-mixed-phrase.wav)

```song phrase
SONG | meter=4/4 | bpm=120
TRACK lead | instrument=bright_lead
TRACK bass | instrument=chip_bass
TRACK kick | instrument=kick
TRACK hat | instrument=closed_hat

BAR 1
beat 1
  lead [C5 E5 G5]
  bass [C3]
  kick [hit]
  hat [hit rest hit rest]
beat 2
  lead [A5:2 G5]
  bass [rest G2]
  kick [rest]
  hat [hit:2 hit]
beat 3
  lead [F5 E5 D5 E5 F5]
  bass [F2]
  kick [hit]
  hat [hit rest hit rest]
beat 4
  lead [G5]
  bass [G2]
  kick [rest hit]
  hat [hit hit]

BAR 2
beat 1
  lead [hold rest]
  bass [C3]
  kick [hit]
  hat [hit rest hit rest]
beat 2
  lead [C5:2 D5]
  bass [rest G2]
  kick [rest]
  hat [hit hit]
beat 3
  lead [hold E5:2]
  bass [C3]
  kick [hit]
  hat [hit rest hit rest]
beat 4
  lead [C5:3 rest]
  bass [G2 C3]
  kick [rest hit]
  hat [hit hit hit rest]
```

## 8. What the validator should reject

- Empty rows: `lead []`.
- Zero, negative, fractional, or malformed weights in this draft: `[C5:0 D5]`.
- A hold following silence, or at the start of a standalone song.
- Pitches on a drum track, or `hit` on a pitched track.
- Unknown tracks/instruments, duplicate rows, or missing required rows/beats.
- Unsupported nested brackets, such as `[C5 [D5 E5]]`.
- Notes outside the selected instrument's declared playable range.

The example renderer validates standalone examples, not production edit scopes or revisions. It imposes prototype limits of eight tracks, 32 items per row, and weights 1–64 to catch accidental output explosions. These are prototype limits to review, not settled product constraints.

## 9. Foundations and deferred features

Keep the timeline in exact fractions of a beat, even though playback ultimately uses seconds. This accommodates thirds, fifths, sevenths, and weighted ratios without choosing an enormous fixed tick grid. Fractional event positions should survive persistence and edits; MIDI export may need explicit quantization.

This small language has no nesting, randomness, repeat operators, raw sound design, chords within a track, or per-note velocity syntax. Accents, fine expressive timing, loop-boundary ties, and final instrument envelopes remain future decisions. Stable event IDs and scoped replacement behavior live in the application contract, outside this text tutorial.

No Strudel code or packages are used by these examples. The prototype parser and synthesizer are independently implemented for this tutorial.

## 10. Reproduce the audio

From the project directory, with Node.js installed:

```sh
node scripts/render-language-examples.mjs
```

The script reads the four `song` blocks above, validates them, compiles exact fractional event times, and writes mono 44.1 kHz PCM WAV files plus a machine-readable manifest to `examples/audio/`. It also creates the timing-comparison clip. No API key, model call, external package, or application server is needed.
