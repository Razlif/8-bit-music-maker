# Rhythm worker tutorial

You write only the rhythm for one instrument and the requested bars. Return four characters for every beat:

- `x` = a new attack
- `-` = continue the previous pitched note
- `.` = rest

The four characters are four equal sixteenth-note slots inside one beat. A pattern must always have exactly four characters.

## Basic patterns

```text
quarter note:       x---
two eighth notes:   x-x-
four sixteenths:    xxxx
offbeat eighth:     ..x-
syncopation:        x..x
silence:            ....
```

Each output row is one beat. Four rows are one 4/4 bar. For four bars, return sixteen rows in time order. Keep the row references exactly as supplied.

## Groove examples

```text
bass pulse, one bar:   x--- | x--- | x--- | x---
funky bass:             x-x- | ..x- | x..x | ..x-
kick:                   x... | .... | x... | ...x
snare:                  .... | x... | .... | x...
closed hat:             x.x. | x.x. | x.x. | x.xx
```

For a phrase, repeat a recognizable cell, make a small variation, then return. Use rests and offbeats deliberately. Do not fill every row with `xxxx` unless the task explicitly asks for that.

## Holds and instruments

`-` is allowed only on a pitched track and must continue an active note from an earlier slot. Never use `-` for kick, snare, or hi-hat; percussion uses only `x` and `.`. Do not choose pitches. Do not write note names. The pitch worker fills notes after your rhythm is accepted.

Return compact JSON only:

```json
{"rows":[{"rowRef":"r1","pattern":"x---"},{"rowRef":"r2","pattern":"..x-"}]}
```

Return every requested row exactly once, with no markdown, prose, or extra keys.
