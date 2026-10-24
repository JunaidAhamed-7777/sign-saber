# 09 — Beatmap Format (`BeatmapV1`)

A beatmap is a JSON document produced by the generator ([08](08-beatmap-generation.md)), cached in IndexedDB, bundled for demo tracks under `app/public/assets/tracks/<slug>/<difficulty>.json`, and consumed by the spawner ([07](07-hit-detection-and-scoring.md)). It is deliberately small, flat and human-readable so a map can be patched by hand in a pinch.

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
    beatOffsetMs: number;          // time of the first tracked beat
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
  id: number;                      // unique within the map, ascending
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

The beat grid is `beatOffsetMs + k * 60000 / bpm`. It is used by the HUD metronome pulse, the environment grid pulse, the calibration countdown, and by the generator for snapping. `analysis.beats` is the actual tracked beat list (which may drift from a perfect grid); gameplay uses `notes[].t`, never the grid.

### `approachMs`

| Difficulty | `approachMs` | Resulting speed (`SPAWN_DISTANCE` / approach) |
| --- | --- | --- |
| easy | 2600 | 18.5 m/s |
| normal | 2000 | 24.0 m/s |
| hard | 1600 | 30.0 m/s |

Spawn time for a note is `t - approachMs`. Beam notes ignore `approachMs` for travel (they hover at `BEAM_HOVER_Z`) but appear at `t - BEAM_LEAD_MS`.

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

The validator MUST check all of the following and return a list of `{ path, message }` errors; a map with any error is not playable.

1. `version === 1`; `generatorVersion` is a positive integer.
2. `song.durationMs > 1000`; `40 ≤ song.bpm ≤ 240`; `0 ≤ beatOffsetMs < 60000 / bpm`.
3. `notes`, `obstacles`, `events` sorted ascending by `t`; all `t` within `[0, durationMs]`.
4. Note ids unique and ascending; `col ∈ 0..3`, `row ∈ 0..2`; `strength ∈ [0,1]`.
5. No two notes share `(t, col, row)`; two notes in the same cell are ≥ `MIN_SAME_CELL_GAP_MS` apart.
6. Consecutive notes are ≥ `MIN_NOTE_GAP_MS[difficulty]` apart (the generator may emit chords; notes with `|Δt| < 20` count as one note for this rule).
7. Beam notes have no other notes within ± `BEAM_ISOLATION_MS`.
8. No note has `t` inside an obstacle's `[t, t + durationMs]` in a column the obstacle covers.
9. Obstacles are ≥ `MIN_OBSTACLE_GAP_MS` apart; `durationMs ∈ [MIN_OBSTACLE_MS, MAX_OBSTACLE_MS]`.
10. Note density over any sliding 4-second window ≤ `MAX_DENSITY_PER_S[difficulty] * 4`.

## Example (abridged)

```json
{
  "version": 1,
  "generatorVersion": 1,
  "song": {
    "title": "Neon Drift", "artist": "CC0 Demo", "durationMs": 182340,
    "bpm": 128.0, "beatOffsetMs": 412, "sourceHash": "9f2c…", "source": "bundled",
    "audioUrl": "/assets/tracks/neon-drift/audio.mp3"
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

Each bundled track lives in `app/public/assets/tracks/<slug>/` with `audio.mp3` (CC0 / CC-BY licensed, attribution in that folder's `README.md`), `easy.json`, `normal.json`, `hard.json`, and `cover.webp` (512×512). Bundled maps are generated by `npm run beatmaps` (runs the same generator in Node via `scripts/generate-beatmaps.mjs`) and committed, so the demo never depends on live generation.

Three bundled tracks are required for the demo ([20](20-demo-and-judging.md)):

| Slug | Purpose | Length |
| --- | --- | --- |
| `demo-cut` | A 45-second edit of a high-energy track with a clear drop, so a full run to RESULTS fits the 3-minute demo | 45 s |
| `<full-track-1>` | Full-length electronic track, 120–130 BPM, for judges who want to play | 2–3 min |
| `<full-track-2>` | Full-length track of a different genre (e.g. rock or hip-hop) to show generator robustness | 2–3 min |

## Versioning

- Any change to the schema → `version: 2` and a migration in `beatmap/migrate.ts`.
- Any change to generator tuning that changes output → bump `generatorVersion`, which invalidates the IndexedDB cache automatically because it is part of the cache key.
