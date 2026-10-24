# 09 — Beatmap Format (`BeatmapV1`)

A beatmap is JSON produced by [08](08-beatmap-generation.md), cached in IndexedDB, bundled under `app/public/assets/tracks/<slug>/<difficulty>.json`, and consumed by the [spawner](07-hit-detection-and-scoring.md). The format is planned; `beatmap/types.ts` and `validate.ts` are still stubs. Human edits must pass the same validator and carry an accurate provenance record; do not describe a hand-patched demo chart as untouched generator output.

## TypeScript definition

This is the authoritative type. `beatmap/types.ts` MUST export exactly this shape; `beatmap/validate.ts` MUST reject anything that violates the rules in §Validation.

```ts
export type Difficulty = 'easy' | 'normal' | 'hard';
export type NoteType = 'slash' | 'smash' | 'beam';
export type CutDirection = 'any' | 'up' | 'down' | 'left' | 'right'; // only 'any' is used in v1
export type ObstacleKind = 'wallLeft' | 'wallRight' | 'bar';          // 'bar' is [STRETCH] (duck)
export type EventKind = 'drop' | 'build' | 'calm' | 'kick';

export interface BeatmapV1 {
  version: 1;
  generatorVersion: number;        // bump when the generator's output changes meaningfully
  song: {
    title: string;
    artist: string;
    durationMs: number;
    bpm: number;                   // tracked tempo, 1 decimal
    beatOffsetMs: number;          // periodic grid phase in [0, 60000/bpm), not first tracked beat
    sourceHash: string;            // SHA-256 hex of the audio file bytes
    source: 'bundled' | 'upload' | 'youtube';
    audioUrl?: string;             // bundled tracks only; uploads keep the File in memory
  };
  difficulty: Difficulty;
  approachMs: number;              // spawn-to-hit-plane travel time for this difficulty
  notes: Note[];                   // sorted by t ascending
  obstacles: Obstacle[];           // sorted by t ascending
  events: MusicEvent[];            // sorted by t ascending
  analysis: {                      // debugging + visualisation, not needed to play
    beats: number[];               // beat times (ms)
    onsets: Onset[];               // all validated onsets, including ones not turned into notes
    energy: number[];              // RMS energy envelope sampled every ENERGY_HOP_MS, 0..1
  };
}

export interface Note {
  id: number;                      // unique ascending non-negative integer within notes
  t: number;                       // hit time (ms, song time)
  type: NoteType;
  col: 0 | 1 | 2 | 3;              // left → right from the player's point of view
  row: 0 | 1 | 2;                  // bottom → top
  dir: CutDirection;               // 'any' in v1
  strength: number;                // onset strength 0..1 (drives block scale/glow)
}

export interface Obstacle {
  id: number;
  t: number;                       // time the obstacle's leading face reaches the hit plane
  durationMs: number;              // how long the obstacle occupies the hit plane
  kind: ObstacleKind;
}

export interface MusicEvent {
  t: number;
  kind: EventKind;
  intensity: number;               // 0..1
}

export interface Onset {
  t: number;
  strength: number;                // 0..1 normalized spectral flux
  band: 'low' | 'mid' | 'high';
}
```

## Field semantics

### `song.bpm`, `song.beatOffsetMs`

The nominal grid is `beatOffsetMs + k * 60000 / bpm`; the offset is a phase modulo one period, not necessarily the first tracked beat. This grid can drive countdown and metronome cues for a confident tempo. Generator snapping interpolates **tracked** `analysis.beats`, which may drift; gameplay uses `notes[].t`, never an inferred grid. On the low-confidence path, keep the required numeric BPM as an internal estimate, suppress a precise BPM claim/pulse, and preserve the warning alongside the cached map. `analysis` is diagnostic; absence of useful analysis arrays must not change scoring.

### `approachMs`

| Difficulty | `approachMs` | Resulting speed (`SPAWN_DISTANCE` / approach) |
| --- | --- | --- |
| easy | 2600 | 18.5 m/s |
| normal | 2000 | 24.0 m/s |
| hard | 1600 | 30.0 m/s |

Spawn time for a note is `t - approachMs`. Beam notes ignore `approachMs` for travel (they hover at `BEAM_HOVER_Z`) but appear at `t - BEAM_LEAD_MS`.

Negative spawn times are valid. [15](15-audio-playback-sync.md) schedules pre-roll so early notes receive their full approach; truncating approach at song time zero would make the example below unfair.

### `notes[].col`, `notes[].row`

Grid cell → play-plane position, from the constants table: `x = LANE_X[col]`, `y = LANE_Y[row]`. Column 0 is the player's left (it appears on the left of the screen because the image is mirrored).

### `obstacles[]`

- `wallLeft` occupies columns 0–1 for `durationMs`; the player must lean **right**. `wallRight` occupies columns 2–3; lean **left**.
- `bar` [STRETCH] occupies rows 1–2 across all columns; the player must duck.
- Obstacles travel at the same speed as notes of the same difficulty.

### `events[]`

| kind | meaning | consumer |
| --- | --- | --- |
| `kick` | Strong low-band onset | Camera shake impulse, grid flash |
| `drop` | Section energy jumps ≥ `DROP_RISE_RATIO` after ≥ `DROP_MIN_BUILD_MS` of lower energy | FOV punch + heavy shake + bloom bump + colour shift |
| `build` | Rising energy section start | Grid speed ramps up, fog tightens |
| `calm` | Low-energy section start | Palette cools, grid slows |

## Validation rules (`validateBeatmap`)

Accept `unknown`, validate structure before dereferencing, and return bounded `{ path, message }` errors. Never cast parsed JSON directly to `BeatmapV1`. Malformed shapes, oversized arrays and non-finite numbers fail before expensive pairwise work. Use indexed/two-pointer checks rather than quadratic scans for density/spacing. A map with an error is not playable.

1. `version === 1`; `generatorVersion` positive integer; required objects/arrays present; difficulty, note type, direction, wall kind, event kind and onset band are supported enum values. Core v1 accepts `dir: 'any'` and left/right walls; directional/duck maps remain unsupported until their versioned feature ships.
2. All numeric fields finite; `MIN_TRACK_MS ≤ song.durationMs ≤ MAX_TRACK_MS`; `40 ≤ song.bpm ≤ 240`; `0 ≤ beatOffsetMs < 60000 / bpm`; `approachMs` equals the registered difficulty preset. Audio admission separately checks `MAX_DECODED_PCM_BYTES`; map metadata cannot prove its audio buffer is small.
3. `notes`, `obstacles`, `events` sorted by `t`, with deterministic tie order; times within `[0, durationMs]`. An obstacle must finish within the song.
4. Note IDs unique non-negative ascending integers; obstacle IDs independently unique/ascending. `col`/`row` are integers in range; strengths/intensities lie in `[0,1]`.
5. No two notes share `(t, col, row)`; two notes in the same cell are ≥ `MIN_SAME_CELL_GAP_MS` apart.
6. Consecutive anchored note groups are ≥ `MIN_NOTE_GAP_MS[difficulty]` apart. A chord has at most two members within `CHORD_WINDOW_MS` of its first member, different bands/evidence where available and opposite-side columns; no easy chords or transitive chains. Do not infer band membership solely from note type.
7. Beam notes have no other notes within ± `BEAM_ISOLATION_MS`.
8. No note in covered columns occurs within `[obstacle.t - WALL_NOTE_MARGIN_MS, obstacle.t + durationMs + WALL_NOTE_MARGIN_MS]`.
9. Obstacles are ≥ `MIN_OBSTACLE_GAP_MS` apart; `durationMs ∈ [MIN_OBSTACLE_MS, MAX_OBSTACLE_MS]`.
10. Count every note, including chord members, in each candidate-anchored half-open `[t, t + DENSITY_WINDOW_MS)` window; count ≤ `floor(MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS / 1000)`. The initial window is four seconds; changing it updates generation and validation together.
11. `sourceHash` is 64 lowercase hexadecimal SHA-256 characters; metadata strings have bounded lengths and render as text. Source is one of the declared values. Bundled `audioUrl` resolves only to the expected local track asset path; reject arbitrary URLs/path traversal. Upload/companion maps do not persist executable or remote resource references.
12. `analysis.beats` and onsets are sorted, finite and inside the song. Energy values lie in `[0,1]`, with length bounded by the duration and `ENERGY_HOP_MS`; empty diagnostics are allowed for a hand-authored fixture. Unknown generator versions are not silently treated as locally generated proof.
13. At least one note exists for a playable map. Silence/unsuitable audio produces an error/disabled Start, not an empty successful level.
14. Simulated approach/active windows fit the logical note/obstacle capacities. Cosmetic pool exhaustion is allowed to reduce effects, never gameplay objects. Reject unsupported concurrency before PLAYING.
15. The final assignment passes the ergonomic checks in [08 §9](08-beatmap-generation.md#9-note-assignment-assignts), including beam/gesture transition space and wall safety. Imported maps receive the same checks; density alone does not establish playability.

## Example (synthetic validation fixture)

This is a complete schema example with intentionally synthetic metadata/hash, not a claim that a licensed track or generated map is committed. It should pass after the validator is implemented; include it in its tests.

```json
{
  "version": 1,
  "generatorVersion": 1,
  "song": {
    "title": "Synthetic validator fixture", "artist": "Sign Saber tests", "durationMs": 182340,
    "bpm": 128.0, "beatOffsetMs": 412,
    "sourceHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "source": "upload"
  },
  "difficulty": "normal",
  "approachMs": 2000,
  "notes": [
    { "id": 1, "t": 412,  "type": "smash", "col": 1, "row": 0, "dir": "any", "strength": 0.91 },
    { "id": 2, "t": 646,  "type": "slash", "col": 2, "row": 1, "dir": "any", "strength": 0.62 },
    { "id": 3, "t": 880,  "type": "slash", "col": 0, "row": 2, "dir": "any", "strength": 0.58 },
    { "id": 4, "t": 4162, "type": "beam",  "col": 3, "row": 2, "dir": "any", "strength": 0.70 }
  ],
  "obstacles": [
    { "id": 1, "t": 15412, "durationMs": 937, "kind": "wallLeft" }
  ],
  "events": [
    { "t": 412,   "kind": "kick", "intensity": 0.9 },
    { "t": 30412, "kind": "drop", "intensity": 1.0 }
  ],
  "analysis": { "beats": [412, 880, 1349], "onsets": [], "energy": [] }
}
```

## Bundled tracks

Each planned track folder contains licensed audio, attribution/edits, three difficulty JSON files and an optional 512×512 cover. No tracks/maps are committed yet. `npm run beatmaps` is currently a TODO failure; implement it in P2 using the same DSP/assignment code and canonical decoded input, then commit valid maps plus source/PCM/map hashes. Node does not provide browser `AudioContext`; the build must explicitly supply PCM (for example, a licensed canonical WAV or a documented ffmpeg preprocessing step), not assume browser decode works in Node. Bundled playback must not depend on live generation.

Three bundled tracks are required for the demo ([20](20-demo-and-judging.md)):

| Slug | Purpose | Length |
| --- | --- | --- |
| `demo-cut` | A 45-second edit of a high-energy track with a clear drop, so a full run to RESULTS fits the 3-minute demo | 45 s |
| `<full-track-1>` | Full-length electronic track, 120–130 BPM, for judges who want to play | 2–3 min |
| `<full-track-2>` | Full-length track of a different genre (e.g. rock or hip-hop) to show generator robustness | 2–3 min |

## Versioning

- Any change to the schema → `version: 2` and a migration in `beatmap/migrate.ts`.
- Any change to generator tuning that changes output → bump `generatorVersion`, which invalidates the IndexedDB cache automatically because it is part of the cache key.
