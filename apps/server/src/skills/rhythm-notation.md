# Rhythm notation worker tutorial

Return one notation pattern for every requested beat row. The JSON response is only a wrapper for row references; the rhythm itself is written in `pattern` using `x`, `-`, and `.`.

## Symbols

- `x` starts a new attack.
- `-` continues the currently sounding pitched note. It never starts a note.
- `.` is silence.
- `:weight` gives an event a positive relative duration. Omitted weight means `1`.
- Separate events with spaces. Each `rowRef` is exactly one beat; weights in that row are normalized to fill the beat.

Percussion uses `x` and `.` only. Never use `-` on percussion.

## Basic patterns

```text
quarter note:           x
two eighth notes:       x x
four sixteenths:        x x x x
offbeat eighth:         .:2 x -
syncopation:            x . . x
silence:                .
one-beat triplet:       x x x
five equal attacks:     x x x x x
long-short 2:1 swing:   x:2 x
gentle 3:2 swing:       x:3 x:2
reverse swing:          x x:2
```

The task's musical instruction determines the intended feel. Do not add pitches or instrument details.

## Three equal attacks across two beats (3:2 tuplet)

```text
beat 1: x:2 x
beat 2: - x:2
```

The first beat's weights divide it into `2/3` and `1/3`. On beat 2, `-` holds the second attack for `1/3` beat, then the last `x` takes `2/3` beat. This places three attacks evenly across two beats. The dash is required to continue the middle note; it is not another attack.

Equivalent worker response:

```json
{"rows":[{"rowRef":"r1","pattern":"x:2 x"},{"rowRef":"r2","pattern":"- x:2"}]}
```

## More weighted examples

```text
one beat, three equal attacks:       x x x
one beat, weighted 2:1 pair:         x:2 x
one beat, weighted 3:2 pair:         x:3 x:2
one beat, rest then weighted pair:   . x:2 x
two-beat triplet:                    x:2 x | - x:2
```

The `|` above is explanatory only and separates two beat rows. In the JSON response, use a separate row object and preserve the provided `rowRef` values.

## General groove shapes

Each item between vertical bars is a separate beat row. These are broad starting ideas; vary them to fit the task.

```text
on the one:          x | . | . | .
backbeat:            . | x | . | x
offbeat pulse:       .:2 x - | .:2 x - | .:2 x - | .:2 x -
syncopated answer:   x .:2 x | . x .:2 | x .:2 x | .:2 x -
shuffle-like:        x:2 x | x:2 x | x:2 x | x:2 x
bossa-like:          x .:2 x | .:2 x - | x .:2 x | .:2 x -
```

## Output contract

Return compact JSON only, with every requested row reference exactly once:

```json
{"rows":[{"rowRef":"r1","pattern":"x:2 x"}]}
```

Do not return event objects, note pitches, a complete song, Markdown fences, or prose. Follow the task instruction. When it leaves rhythmic choices open, create a recognizable groove with deliberate variation rather than repeating a plain quarter-note pulse.
