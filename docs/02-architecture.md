# 02 — Architecture & Contracts

This document defines the system boundaries, the data that crosses them, the coordinate frames, the frame loop, and every tunable constant. Subsystem documents ([05](05-tracking-pipeline.md)–[16](16-performance-budget.md)) go deep on *how*; this one is the *what talks to what*.

## System overview

```
┌────────────────────────────── Browser tab (main thread) ──────────────────────────────┐
│                                                                                       │
│  ┌──────────┐  ImageBitmap   ┌──────────────────┐ TrackingFrame ┌──────────────────┐  │
│  │  Camera  ├──(transfer)───►│ Tracking Worker  ├──(transfer)──►│  Input Pipeline  │  │
│  │ capture  │                │ HandLandmarker   │               │ smoothing,       │  │
│  └──────────┘                │ PoseLandmarker   │               │ gestures, cursors│  │
│                              │ + segmentation   │               └────────┬─────────┘  │
│                              └──────────────────┘                        │ HandCursor[]│
│                                                                          │ BodyState   │
│  ┌──────────┐  AudioBuffer  ┌──────────────────┐  BeatmapV1               ▼            │
│  │  Audio   ├──────────────►│ Beatmap Worker   ├──────────────►┌──────────────────┐   │
│  │  decode  │               │ onsets, tempo,   │               │   Game Core      │   │
│  └────┬─────┘               │ beats, notes     │               │ state machine,   │   │
│       │ song clock          └──────────────────┘               │ spawner, hit     │   │
│       │                                                        │ detection, score │   │
│       ▼                                                        └────────┬─────────┘   │
│  ┌──────────┐  band energies                                            │ events      │
│  │ Analyser │────────────────────────────────┐                          ▼             │
│  └──────────┘                                │                ┌──────────────────┐    │
│                                              └───────────────►│    Renderer      │    │
│  ┌──────────┐  React (DOM overlay)                            │ Three.js scene,  │    │
│  │   UI     │◄──────── Zustand store ◄───────────────────────┤ shaders, post FX │    │
│  └──────────┘                                                 └──────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────────────┘
          ▲
          │ optional HTTP (localhost)
┌─────────┴────────────┐
│ server/ (Node + yt-dlp) │  YouTube URL → audio file
└──────────────────────┘
```

Threads:

| Thread | Owns | Budget per frame |
| --- | --- | --- |
| Main | Camera capture, input pipeline, game core, renderer, UI | ≤ 16.6 ms total, see [16](16-performance-budget.md) |
| Tracking Worker | MediaPipe inference (hands + pose + mask) | Async, target ≥ 24 Hz, ≤ 40 ms per frame |
| Beatmap Worker | Offline audio analysis | Not frame-bound; < 4 s per 3-minute song |
| Audio thread | `AudioContext` playback (browser-managed) | — |

## Module responsibilities

| Module (folder in `app/src/`) | Responsibility | Depends on |
| --- | --- | --- |
| `core/` | Game loop (`loop.ts`), state machine, event bus, clock, constants | — |
| `tracking/` | Camera capture, worker protocol, `TrackingFrame` decoding, One Euro filtering, wave detector, body metrics | core |
| `gestures/` | Finger-curl classifier, hysteresis, `HandCursor` construction, velocity, blade/charge state | tracking, core |
| `audio/` | Decode, `SongClock`, playback, `AnalyserNode` band energies, SFX bus | core |
| `beatmap/` | Types, validator, generator worker (DSP), IndexedDB cache, bundled loader | audio (decode), core |
| `game/` | Spawner, live note/obstacle sim, hit detection, judgement, scoring, kinetic energy, session stats, highlight capture trigger | core, gestures, beatmap, audio |
| `render/` | Three.js scene graph, materials/shaders, silhouette, blocks + destruction, trails, environment, camera rig, post FX, debug overlay | core, game (read-only), audio (band energies) |
| `ui/` | React screens and HUD, bound to the store | state |
| `state/` | Zustand store: mirrors machine state + display stats for React | core |
| `utils/` | Math (vec/quat helpers, One Euro, lerp/damp), object pools, typed event emitter, hashing | — |

**Dependency rule:** arrows point downward in this table; `render/` and `ui/` never mutate game state. The game core publishes events; the renderer and UI subscribe. `game/` never imports `three`.

## Contracts

The identifiers below are normative. Implementation files MUST use these names so that doc terms are greppable.

### Tracking Worker → Main: `TrackingFrame`

```ts
export interface TrackingFrame {
  seq: number;              // monotonically increasing frame id
  tCapture: number;         // performance.now() ms when the video frame was captured (main-thread clock)
  tInferDone: number;       // performance.now() ms when the worker finished (for latency stats)
  inferenceMs: number;      // worker-side wall time for hands + pose
  hands: HandRaw[];         // 0..2 entries
  pose: PoseRaw | null;
  mask: MaskFrame | null;   // present only when pose is present
}

export interface HandRaw {
  handedness: 'left' | 'right';   // the PLAYER's hand, after mirroring (see §Mirroring)
  score: number;                  // handedness confidence 0..1
  landmarks: Float32Array;        // 21 × (x, y, z) in MIRRORED image space; z is MediaPipe relative depth
  worldLandmarks: Float32Array;   // 21 × (x, y, z) metres, hand-centred (for finger angles)
}

export interface PoseRaw {
  landmarks: Float32Array;        // 33 × (x, y, z, visibility) in MIRRORED image space
  worldLandmarks: Float32Array;   // 33 × (x, y, z) metres, hip-centred
}

export interface MaskFrame {
  width: number;                  // MASK_W
  height: number;                 // MASK_H
  data: Uint8Array;               // width*height, row-major, top-left origin, ALREADY MIRRORED; 0..255 person confidence
}
```

All typed arrays are transferred (zero-copy). The worker pre-allocates and recycles buffers from a two-slot ring so the main thread can hold the latest frame while the next is being written.

### Input Pipeline → Game: `HandCursor`, `BodyState`

```ts
export type Gesture = 'open' | 'fist' | 'point' | 'none';

export interface HandCursor {
  hand: 'left' | 'right';
  present: boolean;              // false → every other field is stale and MUST be ignored
  tCapture: number;              // from the TrackingFrame that produced this update
  gesture: Gesture;
  gestureConfidence: number;     // 0..1 from the classifier margin
  gestureHeldMs: number;         // how long the current gesture has been stable
  pos: Vec3;                     // palm centre on the PLAY PLANE (world metres, z = 0)
  vel: Vec3;                     // play-plane velocity, m/s, smoothed over VEL_WINDOW_FRAMES
  speed: number;                 // |vel|
  tip: Vec3;                     // index fingertip on the play plane (world metres)
  pointDir: Vec2;                // unit vector, play-plane direction from index MCP to fingertip
  bladeActive: boolean;          // speed ≥ BLADE_ON_SPEED (with hysteresis to BLADE_OFF_SPEED) and gesture === 'open'
  bladeLength: number;           // metres, 0 when inactive, see [12]
  charge: number;                // 0..1 beam charge, gesture === 'point' held for BEAM_CHARGE_MS → 1
  history: Vec3[];               // last TRAIL_HISTORY positions of `pos`, newest last, for the trail ribbon
}

export type Lean = 'left' | 'center' | 'right';

export interface BodyState {
  present: boolean;
  tCapture: number;
  centerX: number;        // shoulder-midpoint x, mirrored image space 0..1
  leanX: number;          // (centerX - calib.centerX) / calib.shoulderWidthNorm, clamped to [-2, 2]
  lean: Lean;             // thresholded with hysteresis: LEAN_ON / LEAN_OFF
  tilt: number;           // shoulder line angle in degrees, positive = player's right shoulder lower
  duck: boolean;          // [STRETCH] nose y below calib.headY + DUCK_DROP
  torsoSpeed: number;     // m/s physical estimate of shoulder-midpoint speed, for kinetic energy
}
```

### Game → Renderer / UI: events

The event bus (`core/events.ts`) is a typed emitter. The following events are the complete public surface of the game core:

| Event | Payload | Emitted when |
| --- | --- | --- |
| `state:change` | `{ prev, next }` | State machine transition |
| `note:spawn` | `{ note: Note }` | Note becomes live |
| `note:hit` | `{ note, judgement: 'perfect'\|'great'\|'good', timingErrorMs, hand, cutPlane?: Plane, impactPos: Vec3, impactVel: Vec3, scoreDelta, combo, multiplier }` | Successful destruction |
| `note:miss` | `{ note }` | Note passed `MISS_Z` without a hit |
| `note:badcut` | `{ note, hand, gesture }` | Wrong gesture made contact |
| `beam:fire` | `{ hand, from: Vec3, to: Vec3, note }` | Charged beam resolves on a target |
| `obstacle:spawn` | `{ obstacle }` | Obstacle becomes live |
| `obstacle:hit` | `{ obstacle }` | Player inside an obstacle at the hit plane |
| `obstacle:dodged` | `{ obstacle, scoreDelta }` | Obstacle passed without contact |
| `combo:change` | `{ combo, multiplier, broke: boolean }` | Combo increment or reset |
| `music:event` | `MusicEvent` | Beatmap event time reached |
| `song:progress` | `{ songTimeMs, durationMs }` | Every frame (UI throttles to 10 Hz) |
| `highlight:capture` | `{ songTimeMs }` | New peak combo reached — renderer snapshots silhouette + skeleton |
| `session:end` | `SessionStats` | Song ended |

```ts
export interface SessionStats {
  score: number; maxScore: number; accuracy: number;   // accuracy = score / maxScore
  rank: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
  maxCombo: number;
  counts: { perfect: number; great: number; good: number; miss: number; badcut: number; obstaclesHit: number; obstaclesDodged: number };
  kineticJoules: number; kcal: number;
  peakComboSongTimeMs: number;
}
```

### Beatmap: `BeatmapV1`

Defined in full in [09 — Beatmap Format](09-beatmap-format.md).

### Audio → Renderer: `BandEnergies`

```ts
export interface BandEnergies { low: number; mid: number; high: number; rms: number; }   // each 0..1, smoothed, read every frame
```

Produced by `audio/analyser.ts` from an `AnalyserNode` (FFT 1024) with band edges `BAND_LOW_HZ`, `BAND_MID_HZ`, `BAND_HIGH_HZ`, exponential smoothing `ANALYSER_SMOOTH`.

## Coordinate frames

Five frames, named exactly as follows everywhere in code and docs.

| Frame | Axes | Range | Produced by |
| --- | --- | --- | --- |
| **image space** | u right, v down | 0..1 | MediaPipe (raw camera orientation) |
| **mirrored image space** | u′ = 1 − u, v | 0..1 | Tracking worker, before posting |
| **play plane** | x right, y up, z = 0 | x ∈ ±PLAY_W/2, y ∈ PLAY_CENTER_Y ± PLAY_H/2 | `mapToPlayPlane()` in `gestures/cursor.ts` |
| **world** | Three.js right-handed, y up, metres | — | Renderer |
| **screen** | CSS pixels | viewport | Renderer / UI |

### Mirroring

The player must see a mirror. The worker converts to mirrored image space once (`u′ = 1 − u`, mask flipped horizontally, handedness labels swapped so `'right'` means the player's right hand). Nothing downstream mirrors again.

### Image → play plane

```
x = (u′ − 0.5) · PLAY_W
y = PLAY_CENTER_Y + (0.5 − v) · PLAY_H
z = 0
```

`PLAY_W : PLAY_H` is 16:9, the same as the camera frame, so there is no anisotropic distortion. The camera is opened at 16:9; if the device delivers another aspect, the frame is centre-cropped to 16:9 before inference.

### Silhouette plane

The silhouette is drawn on a plane at `z = SILHOUETTE_Z` (behind the play plane). To keep it aligned with the hand cursors in screen space, each play-plane point `P` maps to the silhouette plane by projecting from the camera position `C`: `P_sil = C + (P − C) · k`, with `k = (SILHOUETTE_Z − C.z) / (0 − C.z)`. With the default camera (`CAM_POS.z = 4.6`, `SILHOUETTE_Z = −1.4`) `k = 1.304`, so the silhouette plane is `PLAY_W·k × PLAY_H·k` metres, positioned at the projected centre.

### Lane geometry

Notes travel along the **lane direction** `d = (0, −sin(LANE_PITCH_DEG), cos(LANE_PITCH_DEG))`, normalised, pointing toward the player. A note targeting cell `(col,row)` is at

```
target     = (LANE_X[col], LANE_Y[row], 0)
progress   = (songTime − (note.t − approachMs)) / approachMs      // 0 at spawn, 1 at hit plane, > 1 after
position   = target − d · SPAWN_DISTANCE · (1 − progress)
```

At spawn the note is `SPAWN_DISTANCE` metres away along `d`, i.e. far and slightly *above* the hit plane (the lane is inclined upward into the distance, so objects descend gently toward the player). Obstacles use the same equation with `target.x` at the wall centre.

Beam notes do not travel. They fade in at `t − BEAM_LEAD_MS` at `(LANE_X[col], LANE_Y[row] + BEAM_HOVER_Y_OFFSET, BEAM_HOVER_Z)` and, if not popped by `t + BEAM_ESCAPE_MS`, fly upward and count as a miss.

## Frame loop

`core/loop.ts` runs on `requestAnimationFrame`. Order per frame is fixed:

1. **Clock** — `songTime = songClock.now()` (from `AudioContext.currentTime`; frozen while paused). `dt = clamp(frameDelta, 0, 50 ms)`.
2. **Drain tracking** — take the newest `TrackingFrame` if one arrived (older ones are dropped). Run the input pipeline → updated `HandCursor[2]`, `BodyState`. If no new frame, cursors extrapolate `pos += vel · dt` for at most `EXTRAPOLATE_MAX_MS` then hold.
3. **Spawner** — make live every note/obstacle with `t − approachMs ≤ songTime` (or `t − BEAM_LEAD_MS` for beams). Emit `music:event`s whose `t ≤ songTime`.
4. **Simulate** — update every live note/obstacle position from `songTime` (positions are pure functions of time; no integration, so pausing and resuming is exact).
5. **Hit detection** — for each hand cursor and each live note in the hit zone, test contact; judge; emit. Then obstacles vs `BodyState`. Then beam resolution. Details in [07](07-hit-detection-and-scoring.md).
6. **Score / stats** — apply judgements, update combo, kinetic energy accumulator.
7. **Audio reactive** — read `BandEnergies`.
8. **Render** — renderer consumes cursors, body state, live objects, band energies, pending events (destruction effects are started in the same frame as the `note:hit` event). Camera rig update. Post FX.
9. **UI** — Zustand store updated with display values (throttled to ≤ 20 Hz for text fields).

Fixed-step physics is not required: destruction fragments use closed-form ballistic motion; the trail ribbon uses the cursor history. Nothing in the game needs integration that would be sensitive to `dt`.

## Latency model

| Stage | Typical | Notes |
| --- | --- | --- |
| Camera exposure + delivery | 30–60 ms | Reduced by requesting 30 fps and the lowest exposure the camera allows automatically |
| `createImageBitmap` + transfer | 1–3 ms | Main thread |
| Inference (hands + pose + mask) | 15–35 ms | Worker, GPU delegate |
| Transfer back + pipeline | 1–2 ms | Main |
| Render to display | 16–33 ms | Depends on frame rate and compositor |
| **Total motion-to-photon** | **70–130 ms** | — |

Consequences, applied throughout: judgements use `tCapture` (not arrival time); hit zones are expressed as timing windows (so being ~100 ms late reads as “Great”, not a miss); cursors extrapolate to hide the gap; the player-adjustable `inputOffsetMs` shifts all judgements.

## Constants

Single source of truth. `core/constants.ts` MUST export these names with these values. Docs reference the names only.

**Rendering-only tunables** carry a subsystem prefix (`SIL_*`, `SLICE_*`, `SHATTER_*`, `BADCUT_*`, `BLADE_CORE_W` / `BLADE_GLOW_W` / `BLADE_SPINE_SAMPLES` / `BLADE_MIX_*`, `ORBIT_*`, `INDICATOR_R`, `HAND_TINT_*`, `TRAUMA_*`, `SHAKE_*`, `DROP_FOV_PUNCH_DEG` / `DROP_DOLLY_M` / `DROP_DECAY_MS`, `KICK_DECAY_MS`, `LEAN_PARALLAX_M`, `BLOOM_*`, `CHROMA_*`, `GLITCH_MS`, `FOG_DENSITY`, `BG_COLOR`, `GRID_LINE_COLOR`, `PYLON_*`, `OBSTACLE_ALPHA`, `SPAWN_FADE_MS`, `BEAM_VISUAL_MS`, `HIGHLIGHT_RT_SIZE`). Their values are specified in the "Constants required" table of the owning rendering doc ([10](10-rendering-silhouette.md), [11](11-rendering-blocks-and-destruction.md), [12](12-rendering-hands-trails.md), [13](13-rendering-environment-camera-postfx.md)), which is their authority; they MUST still be exported from `core/constants.ts` under a `// render` section so there is one file to tune. Everything below is cross-subsystem and is authoritative here.

### Play space & camera

| Name | Value | Meaning |
| --- | --- | --- |
| `PLAY_W` | 5.33 m | Play plane width (16:9 with `PLAY_H`) |
| `PLAY_H` | 3.0 m | Play plane height |
| `PLAY_CENTER_Y` | 1.5 m | Play plane vertical centre |
| `LANE_X` | `[-1.8, -0.6, 0.6, 1.8]` | Column centres (m) |
| `LANE_Y` | `[0.75, 1.5, 2.25]` | Row centres (m) |
| `BLOCK_SIZE` | 0.6 m | Cube edge |
| `LANE_PITCH_DEG` | 6° | Lane inclination |
| `SPAWN_DISTANCE` | 48 m | Spawn distance along the lane |
| `SILHOUETTE_Z` | −1.4 m | Silhouette plane depth |
| `CAM_POS` | `(0, 1.75, 4.6)` | Default camera position |
| `CAM_LOOK_AT` | `(0, 1.35, −8)` | Default camera target |
| `CAM_FOV_DEG` | 55° | Default vertical FOV |
| `BEAM_HOVER_Z` | −14 m | Beam target hover depth |
| `BEAM_HOVER_Y_OFFSET` | 0.6 m | Beam targets sit a little higher so they read as “distant” |

### Timing & judgement

| Name | Value | Meaning |
| --- | --- | --- |
| `APPROACH_MS` | `{ easy: 2600, normal: 2000, hard: 1600 }` | Travel time spawn → hit plane |
| `WINDOW_PERFECT_MS` | 60 | \|timing error\| ≤ → Perfect |
| `WINDOW_GREAT_MS` | 120 | → Great |
| `WINDOW_GOOD_MS` | 200 | → Good; beyond this no contact is possible |
| `MISS_Z` | +1.2 m | Note z past which it is a miss (≈ 50 ms late at normal) — the hit zone is `[−WINDOW_GOOD_MS, +WINDOW_GOOD_MS]` in time, this is only the visual despawn trigger |
| `DESPAWN_Z` | +3.5 m | Remove from scene |
| `BEAM_LEAD_MS` | 1600 | Beam target appears this early |
| `BEAM_ESCAPE_MS` | 600 | Beam target leaves this long after `t` |
| `BEAM_CHARGE_MS` | 500 | Hold-to-charge duration |
| `BEAM_AIM_RADIUS` | 0.45 m | Play-plane distance from fingertip ray to target centre |
| `BEAM_ISOLATION_MS` | 700 | No other notes within this of a beam note |
| `INPUT_OFFSET_DEFAULT_MS` | 0 | User-adjustable in settings |
| `INPUT_OFFSET_RANGE_MS` | ±150 | Slider range for `inputOffsetMs` |
| `WINDOW_SCALE` | 1.0 | Multiplier applied to all `WINDOW_*_MS` (fallback 1.25 if tracking latency is high, [21 R09](21-risks-and-fallbacks.md)) |
| `OBSTACLE_GRACE_MS` | 120 | Frames after a wall reaches the hit plane that are not evaluated (hides tracking latency) |
| `BEAM_REFIRE_LOCK_MS` | 150 | Lockout after a beam fire |
| `EXTRAPOLATE_MAX_MS` | 80 | Cursor extrapolation cap |

### Scoring

| Name | Value |
| --- | --- |
| `SCORE_PERFECT` / `SCORE_GREAT` / `SCORE_GOOD` | 100 / 70 / 40 |
| `SCORE_DODGE` | 50 |
| `MULTIPLIER_LADDER` | `[[0,1],[5,2],[15,4],[30,8]]` (combo ≥ threshold → multiplier) |
| `RANK_THRESHOLDS` | SS ≥ 0.95, S ≥ 0.90, A ≥ 0.80, B ≥ 0.65, C ≥ 0.50, else D (accuracy = score / maxScore where maxScore assumes all Perfect at full combo) |
| `HAND_MASS_KG` | 2.5 (hand + forearm effective mass for kinetic energy) |
| `TORSO_MASS_KG` | 30 |
| `METABOLIC_EFFICIENCY` | 0.25 (kcal = J / 4184 / efficiency) |
| `SWING_MIN_SPEED` | 1.0 m/s physical — a hand speed peak below this is not a swing |
| `TORSO_SWING_MIN_SPEED` | 0.3 m/s physical — torso speed peak floor |
| `HIGHLIGHT_MIN_COMBO` | 5 — a new peak combo below this does not trigger `highlight:capture` |
| `HIGHLIGHT_DEBOUNCE_MS` | 2000 — at most one highlight capture per this interval |
| `MILESTONE_COMBOS` | `[10, 25, 50, 100]` — combo milestone flashes |

### Gestures & motion

| Name | Value | Meaning |
| --- | --- | --- |
| `GESTURE_CONFIRM_FRAMES` | 3 | Consecutive frames before a gesture switches |
| `GESTURE_DROP_FRAMES` | 6 | Ambiguous frames before falling to `'none'` |
| `FINGER_EXT_ANGLE_DEG` | 160 | PIP angle ≥ → finger extended |
| `FINGER_CURL_ANGLE_DEG` | 115 | PIP angle ≤ → finger curled |
| `ONE_EURO_MIN_CUTOFF` | 1.2 Hz | Position filter |
| `ONE_EURO_BETA` | 0.08 | Position filter speed coefficient |
| `ONE_EURO_D_CUTOFF` | 1.0 Hz | Derivative filter |
| `VEL_WINDOW_FRAMES` | 3 | Central-difference window for velocity |
| `BLADE_ON_SPEED` | 3.0 m/s | Blade appears (play-plane speed) |
| `BLADE_OFF_SPEED` | 1.8 m/s | Blade retracts |
| `SLASH_MIN_SPEED` | 2.5 m/s | Minimum speed at contact for a valid slash |
| `SMASH_MIN_SPEED` | 1.2 m/s | Minimum speed at contact for a valid smash |
| `BLADE_LEN_MIN` / `BLADE_LEN_MAX` | 0.4 / 1.6 m | Blade length at `BLADE_ON_SPEED` / `BLADE_FULL_SPEED` |
| `BLADE_FULL_SPEED` | 12 m/s | Speed at which the blade is longest |
| `TRAIL_HISTORY` | 24 | Positions kept for the ribbon |
| `HAND_HIT_RADIUS` | 0.22 m | Palm sphere radius for contact tests |
| `LEAN_ON` / `LEAN_OFF` | 0.55 / 0.35 | \|leanX\| thresholds (in shoulder widths) with hysteresis |
| `DUCK_DROP` | 0.12 | Nose drop (fraction of frame height) for duck [STRETCH] |

### Tracking & calibration

| Name | Value | Meaning |
| --- | --- | --- |
| `CAM_REQ_W` / `CAM_REQ_H` / `CAM_REQ_FPS` | 1280 / 720 / 30 | `getUserMedia` request |
| `INFER_W` / `INFER_H` | 640 / 360 | Frame size sent to the worker for hands |
| `POSE_W` / `POSE_H` | 320 / 180 | Downscale inside the worker for pose + mask |
| `MASK_W` / `MASK_H` | 320 / 180 | Mask resolution posted to main |
| `TRACK_TARGET_HZ` | 30 | Worker processes at most this rate |
| `TRACKING_LOST_PAUSE_MS` | 1500 | Auto-pause threshold |
| `CALIB_PRESENCE_MS` | 800 | Condition must hold this long to tick |
| `CALIB_SHOULDER_MIN` | 0.14 | Minimum shoulder width (fraction of frame width) accepted — smaller means too far |
| `CALIB_SHOULDER_MAX` | 0.40 | Maximum shoulder width accepted — larger means too close |
| `CONTRAST_MASK_THRESHOLD` | 0.65 | Mask threshold in high-contrast mode (`?contrast=1`); default mode uses 0.5 |
| `CONTRAST_EDGE_GAIN` | 1.5 | Silhouette edge glow multiplier in high-contrast mode |
| `LOW_LIGHT_MASK_MEAN` / `LOW_LIGHT_MS` | 0.55 / 1000 | Mean mask confidence inside the body box below this for this long → low-light coaching line |
| `TWO_BODY_BLOB_AREA` | 0.15 | Second mask blob with area ≥ this fraction of the frame → "one player at a time" coaching line |
| `WAVE_REVERSALS` / `WAVE_WINDOW_MS` / `WAVE_MIN_AMPLITUDE` | 3 / 1500 / 0.06 | Wave detector |
| `START_COUNTDOWN_MS` | 3 beats of the song (min 1500, max 3000) | Pre-start count |
| `RESUME_COUNTDOWN_MS` | 1500 | Resume count |
| `SONG_TAIL_MS` | 1500 | Wait after song end before RESULTS |

### Beatmap generation

| Name | Value | Meaning |
| --- | --- | --- |
| `ANALYSIS_SR` | 22050 Hz | Analysis sample rate |
| `FFT_SIZE` / `HOP` | 2048 / 512 | STFT (≈ 93 ms window, 23.2 ms hop) |
| `BAND_EDGES_HZ` | low 20–150, mid 150–2000, high 2000–10000 | Spectral flux bands |
| `ONSET_DELTA` | 0.15 | Adaptive threshold offset |
| `ONSET_MIN_GAP_MS` | 80 | Minimum inter-onset interval |
| `ONSET_MIN_STRENGTH` | 0.25 | Below this an onset is noise |
| `BPM_MIN` / `BPM_MAX` / `BPM_PRIOR` | 60 / 200 / 120 | Tempo search range and log-Gaussian prior centre |
| `BEAT_TIGHTNESS` | 100 | DP beat tracker penalty weight |
| `SNAP_GRID` | 4 (sixteenths) | Onsets snap to 1/4-beat grid |
| `SNAP_MAX_MS` | 35 | Onsets farther than this from a grid line are dropped |
| `MAX_DENSITY_PER_S` | `{ easy: 1.2, normal: 2.2, hard: 3.5 }` | Note density cap |
| `MIN_NOTE_GAP_MS` | `{ easy: 300, normal: 180, hard: 120 }` | Consecutive note gap |
| `MIN_SAME_CELL_GAP_MS` | 400 | Same-cell gap |
| `MIN_OBSTACLE_GAP_MS` / `MIN_OBSTACLE_MS` / `MAX_OBSTACLE_MS` | 3000 / 600 / 2400 | Obstacle constraints |
| `DROP_RISE_RATIO` / `DROP_MIN_BUILD_MS` | 1.4 / 8000 | Drop detection |
| `ENERGY_HOP_MS` | 100 | Energy envelope sampling for `analysis.energy` |
| `TEMPO_PRIOR_SIGMA_OCT` | 0.9 | Log-Gaussian tempo prior width, octaves |
| `TEMPO_MIN_CONFIDENCE` | 0.35 | Below this → onset-only mode with a warning badge |
| `BEAM_SUSTAIN_MS` / `BEAM_SUSTAIN_DB` | 500 / 3 | Mid-band energy within this many dB for this long → beam candidate |
| `BEAM_MIN_SPACING_MS` | `{ easy: 8000, normal: 4000, hard: 4000 }` | Minimum time between beam notes |
| `CHORD_WINDOW_MS` | 20 | Onsets closer than this in different bands form a chord |
| `CENTROID_ROW_HZ` | `[400, 2500]` | Spectral centroid boundaries for row 0 / 1 / 2 |
| `WALL_NOTE_MARGIN_MS` | 600 | No note in a wall's covered columns within this margin of the wall |
| `MIN_TRACK_MS` | 5000 | Shorter files are rejected (`tooShort`) |
| `MAX_UPLOAD_BYTES` | 60 × 1024 × 1024 | Larger uploads are rejected before decoding |
| `ANALYSIS_CACHE_MAX` | 30 | IndexedDB entries kept (most recent) |
| `GENERATOR_VERSION` | 1 | Cache key component |

### Audio playback, reactive & SFX

| Name | Value |
| --- | --- |
| `SONG_START_LEAD_S` | 0.15 — scheduled start offset after `AudioContext.currentTime` |
| `ANALYSER_FFT` | 1024 |
| `BAND_LOW_HZ` / `BAND_MID_HZ` / `BAND_HIGH_HZ` | 20–150 / 150–2000 / 2000–10000 |
| `ANALYSER_SMOOTH` | 0.6 (attack 0.3 for `low`), expressed as 60 Hz-equivalent time constants |
| `SFX_POLYPHONY` | 6 simultaneous one-shots per sound |
| `SFX_PITCH_JITTER_CENTS` | 69 (≈ ±4 %) |
| `DUCK_DB` / `DUCK_ATTACK_S` / `DUCK_RELEASE_S` | −1.5 / 0.03 / 0.4 — music ducking on the drop sting |

### UI

| Name | Value |
| --- | --- |
| `UI_TEXT_HZ` | 20 — store flush rate for text fields |
| `POP_LIFETIME_MS` / `MAX_POPS` | 600 / 6 — judgement pops |
| `DWELL_SELECT_MS` | 900 — [STRETCH] hands-free hover-dwell selection |

### Companion service (YouTube)

| Name | Value |
| --- | --- |
| `COMPANION_URL` | `http://localhost:8787` |
| `COMPANION_HEALTH_TIMEOUT_MS` | 800 — health probe timeout on entering SELECT |
| `YT_HEALTH_INTERVAL_MS` | 10000 — re-probe interval while in SELECT |
| `COMPANION_POLL_MS` | 500 — download status polling |
| `COMPANION_MAX_VIDEO_MS` | 720000 (12 min) — longer videos are refused |

### Rendering

| Name | Value |
| --- | --- |
| `TARGET_FPS` / `FLOOR_FPS` | 60 / 40 |
| `BLOOM_RESOLUTION_SCALE` | 0.5 |
| `MAX_LIVE_NOTES` | 48 (pool) |
| `MAX_FRAGMENTS` | 256 (pool, across all shattered blocks) |
| `MAX_TRAIL_PARTICLES_PER_HAND` | 256 |
| `FRAGMENT_LIFETIME_MS` | 1400 |
| `HALF_LIFETIME_MS` | 1200 (sliced halves) |
| `POOF_LIFETIME_MS` | 700 |

## Source layout

```
app/
├── index.html
├── package.json / vite.config.ts / tsconfig.json / eslint.config.js
├── public/
│   ├── models/            MediaPipe wasm/ + .task files (downloaded by scripts/download-models)
│   └── assets/
│       ├── tracks/<slug>/ audio.mp3, easy|normal|hard.json, cover.webp, README.md
│       ├── models/        GLB: block_fractured.glb, glyphs.glb, armor.glb, pylon.glb
│       ├── fonts/         Orbitron, Rajdhani (woff2, bundled for offline)
│       └── sfx/           slash, smash, poof, miss, badcut, dodge, combo, drop, count (ogg)
├── src/
│   ├── main.tsx           bootstraps renderer + React root
│   ├── App.tsx            screen router keyed on machine state
│   ├── core/              loop.ts, stateMachine.ts, events.ts, clock.ts, constants.ts, flags.ts
│   ├── tracking/          camera.ts, tracking.worker.ts, workerClient.ts, filters.ts, body.ts, wave.ts
│   ├── gestures/          classifier.ts, cursor.ts, blade.ts
│   ├── audio/             decode.ts, songClock.ts, player.ts, analyser.ts, sfx.ts
│   ├── beatmap/           types.ts, validate.ts, generator.worker.ts, generatorClient.ts, assign.ts, cache.ts, bundled.ts,
│   │                      dsp/ (resample, fft, stft, flux, peaks, tempo, beats, energy)
│   ├── game/              spawner.ts, liveObjects.ts, hit.ts, judge.ts, score.ts, kinetic.ts, session.ts
│   ├── render/            renderer.ts, scene.ts, silhouette.ts, skeleton.ts, blocks.ts, slicer.ts, shatter.ts, poof.ts,
│   │                      trails.ts, blade.ts, environment.ts, cameraRig.ts, postfx.ts, quality.ts, highlight.ts, debugOverlay.ts
│   │   └── shaders/       *.vert.glsl, *.frag.glsl (imported via vite-plugin-glsl)
│   ├── ui/                screens/ (Boot, Select, Calibration, Hud, Paused, Results), components/
│   ├── state/             store.ts
│   └── utils/             math.ts, oneEuro.ts, pool.ts, emitter.ts, hash.ts
└── tests/
    ├── unit/              classifier, judge, hit, score, dsp, assign, validate, cache, oneEuro, slicer
    └── fixtures/          tracking/ (recorded TrackingFrame sequences, JSON), audio/ (short clips with tapped beats)
```

## Runtime flags & debug keys

All flags are read once at boot by `core/flags.ts` (URL query parameters) and exposed as a frozen object. Debug keys are active in development builds only (`import.meta.env.DEV`).

| Flag / key | Effect | Spec |
| --- | --- | --- |
| `?replay=<fixture>.json` | Feed a recorded `TrackingFrame` fixture instead of the camera | [17 §Replay mode](17-testing-and-qa.md) |
| `?tier=low\|medium\|high` | Force a quality tier (skips the probe) | [16 §Quality tiers](16-performance-budget.md#quality-tiers) |
| `?probe=1` | Re-run the boot quality probe even if `localStorage` has `ss:tier` | [16](16-performance-budget.md) |
| `?contrast=1` | High-contrast mode: mask threshold `CONTRAST_MASK_THRESHOLD`, edge gain `CONTRAST_EDGE_GAIN` | [10](10-rendering-silhouette.md), [21 R02](21-risks-and-fallbacks.md) |
| `?seg=selfie` | Use `ImageSegmenter` (selfie model) for the mask instead of the pose model's mask | [05](05-tracking-pipeline.md), [ADR-003](03-decisions.md) |
| `?difficulty=easy\|normal\|hard` | Preselect difficulty in SELECT | [14](14-ui-ux.md) |
| Key `D` | Toggle debug overlay | [16 §Measurement](16-performance-budget.md) |
| Key `Q` | Cycle quality tier | [16](16-performance-budget.md) |
| Key `H` | Toggle high-contrast mode | [10](10-rendering-silhouette.md) |
| Key `R` | Start/stop fixture recording (20 s) → downloads JSON | [17 §Fixtures](17-testing-and-qa.md) |
| `Esc` / `Space` | Pause (all builds) | [04](04-state-machine.md) |

## Build & tooling

- **Vite** dev server with HTTPS off (camera works on `http://localhost`). Workers are created with `new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' })` so Vite bundles them.
- **TypeScript strict**, `noUncheckedIndexedAccess` on.
- **ESLint** (typescript-eslint recommended) + **Prettier**; CI runs `typecheck`, `lint`, `test`, `build`.
- **Vitest** for unit tests (jsdom not needed; DSP and logic are pure).
- Required cross-origin headers are *not* needed: no `SharedArrayBuffer` is used. MediaPipe loads its WASM from `/models/wasm/` (same origin).
