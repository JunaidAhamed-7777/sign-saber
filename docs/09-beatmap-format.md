# 09 — Beatmap Format (`BeatmapV1`)

Local arrangements use the existing `source: 'upload'` in-memory File playback path even when their original source was bundled. The separate versioned edit receipt retains original identity/rights/hash, source sample bounds, fade/highlight intervals and new WAV/PCM hashes. The derived `song.sourceHash` identifies the actual edited WAV; the original map cannot be reused.


A beatmap is JSON produced by [08](08-beatmap-generation.md), cached in IndexedDB, bundled under `app/public/assets/tracks/<slug>/<difficulty>.json`, and consumed by the [spawner](07-hit-detection-and-scoring.md). The v1 schema, validator and bundled loaders are implemented; generated maps currently use generator version 4. Human edits must pass the same validator and carry an accurate provenance record; do not describe a hand-patched demo chart as untouched generator output.

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
10a. At most `MAX_VISIBLE_NOTES[difficulty]` notes have hit times inside any `[t, t + APPROACH_MS[difficulty])` span, so the screen never holds more than 3/4/5 approaching notes (generator v3+).
11. `sourceHash` is 64 lowercase hexadecimal SHA-256 characters; metadata strings have bounded lengths and render as text. Source is one of the declared values. Bundled `audioUrl` resolves only to the expected local track asset path; reject arbitrary URLs/path traversal. Upload/companion maps do not persist executable or remote resource references.
12. `analysis.beats` and onsets are sorted, finite and inside the song. Energy values lie in `[0,1]`, with length bounded by the duration and `ENERGY_HOP_MS`; empty diagnostics are allowed for a hand-authored fixture. Unknown generator versions are not silently treated as locally generated proof.
13. At least one note exists for a playable map. Silence/unsuitable audio produces an error/disabled Start, not an empty successful level.
14. Simulated approach/active windows fit the logical note/obstacle capacities. Cosmetic pool exhaustion is allowed to reduce effects, never gameplay objects. Reject unsupported concurrency before PLAYING.
15. The final assignment passes the ergonomic checks in [08 §9](08-beatmap-generation.md#9-note-assignment-assignts), including wall safety and the per-side hand budget: consecutive notes on one side (columns 0–1 or 2–3) are at least `handGapMs(previous.type, next.type) = FLOW_HAND_FOLLOW_MS[kind(previous)] + FLOW_HAND_LEAD_MS[kind(next)] + (types differ ? FLOW_GESTURE_CHANGE_MS : 0)` apart, where `kind` is `beam` or `strike`. Imported maps receive the same checks; density alone does not establish playability.

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

**[CORE] Ship at least three distinct, full-length starter songs with the game.** A first-time player can choose a song and play immediately after browser/camera setup, without supplying a file, installing the companion, visiting an external music site or generating a chart. The first validated starter song or a properly credited prototype excerpt is a P1 dependency; all three full songs with Easy/Normal/Hard maps are a P2 gate. A short derivative demo excerpt is additional content and does not count as a third full song.

The selected pack and exact credits are maintained once in the [starter music registry](../app/public/assets/tracks/README.md#selected-starter-pack). The proposed range is an approachable electronic groove, a contrasting mid-tempo rhythm and a more energetic showcase. These roles are selection intent; decoded timing, generator quality, difficulty and human playability must still be checked. Catalog BPM is reference metadata, not evidence of our detector's output.

Each planned track folder contains licensed local audio, attribution/change records, three validated difficulty JSON files and optionally original or separately licensed cover art. Missing cover art gets a generated typographic fallback; do not reuse catalog artwork without its own rights record. The eight full tracks, 24 maps and manifest are now packaged; musical/human acceptance remains pending. `npm run beatmaps` now runs the shared DSP/assignment generator against canonical gapless PCM; packaged maps and provenance are committed. Node does not provide browser `AudioContext`; the build must explicitly supply PCM (for example, a licensed canonical WAV or documented ffmpeg preprocessing), not assume browser decode works in Node. Bundled playback must not depend on live generation.

### Starter library manifest

Implemented `app/public/assets/tracks/manifest.json` has this versioned shape. `BundledTrackEntry` is the source of truth for the library adapter; menu-only view state does not change track identity. The paths below are manifest data, not arbitrary user URLs.

```ts
export interface BundledTrackEntry {
  slug: string;                       // unique lowercase slug, stable selection identity
  title: string;
  artist: string;
  role: 'intro' | 'groove' | 'showcase'; // editorial guidance, not a difficulty restriction
  audioUrl: string;                   // local /assets/tracks/<slug>/audio.mp3
  coverUrl?: string;                  // local asset with its own rights record, or omit
  durationMs: number;                 // measured from the packaged decoded audio
  bpm: number | null;                 // confident analysis result; null means unknown
  preview: { startMs: number; durationMs: number }; // measured, in-track bounds
  difficultyMaps: Record<Difficulty, string>;     // local easy/normal/hard JSON URLs
  generatorVersion: number;
  warnings: string[];                 // preserve uncertain-tempo/onset-only disclosure
  hashes: {
    audioSha256: string;
    canonicalPcmSha256: string;
    maps: Record<Difficulty, string>;
  };
  rights: {
    sourceUrl: string;                // provenance link; never fetched to play
    license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0';
    licenseUrl: string;
    attribution: string;
    changes: string;                  // actual edits/encoding, or explicitly unchanged
  };
}

export interface BundledTrackManifest {
  version: 1;
  tracks: BundledTrackEntry[];
}
```

Validate the manifest before populating SELECT: object/array shape, supported version, unique safe slugs, bounded text, allowed role/license, finite duration/BPM/preview values, in-track preview range, all required difficulty paths and lowercase SHA-256 strings. Local runtime paths must stay beneath the entry's track directory; provenance/license URLs are displayed as links and never treated as executable/fetchable audio. On selection, validate the actual `BeatmapV1`, audio/map hashes, source identity, packaged duration and generator version. A catalog BPM must not silently overwrite a different measured tempo; review the discrepancy and retain the warning.

### Selection, preview and failure behavior

- SELECT lists the bundled library on first launch, with clear title, artist, duration, available difficulty and selected state. Mouse, keyboard and the core palm-to-point controls in [14](14-ui-ux.md#input-handling) select the same stable slug and invoke the same actions. Keep the human figure in the central stage; song choices live in the bounded side rail.
- Selecting a card does not start a song or play a preview. A labelled Preview action starts/stops the bounded preview segment only after the browser's trusted audio enable action. Hover and palm motion remain silent. New preview/Start/Back/Retry cancels the previous preview; only one preview source is active.
- Load/decode selected audio on demand, with actual progress/errors, rather than retaining the full library in decoded buffers. Asset readiness and native audio unlock are distinct. Pre-generated maps make the bundled path independent of the analysis worker or optional service.
- All runtime music, charts, optional covers and credits are served from the prepared local bundle; no CDN, thumbnail request or catalog fetch is required. Verify the full eight-song library with external network disconnected. Credits remain readable in the app and repository without visiting the publisher.
- A missing/corrupt audio/map disables only the affected entry, explains the error and offers Retry or another available song. Do not substitute a different track under the same title. An empty library shows a useful setup error and optional upload path; it cannot pass the P2/release starter-pack gate.
- The release content check confirms at least three distinct full songs, all three valid difficulty maps per song, actual preview bounds, audio/map hashes and complete credits. Complete each track with real inputs during QA. Original music and a three-song catalog do not replace the independent held-out evaluation in [24](24-benchmark-and-evidence.md).

### Demo excerpt

During P3, create the separate `demo-cut` derivative described in [20](20-demo-and-judging.md): approximately 45 seconds, with declared source track, edit boundaries and changes/credits. Generate and validate its map from that exact edited audio; reusing the full song's timestamps/hash would be invalid. Rehearse the excerpt only after the real mechanics and charts support the intended sequence. Keep the three full starter songs available alongside it.

## Versioning

- Any change to the schema → `version: 2` and a migration in `beatmap/migrate.ts`.
- Any change to generator tuning that changes output → bump `generatorVersion`, which invalidates the IndexedDB cache automatically because it is part of the cache key.
