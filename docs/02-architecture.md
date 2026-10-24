# 02 — Architecture & Contracts

This document defines the system boundaries, the data that crosses them, the coordinate frames, the frame loop, and every tunable constant. Subsystem documents ([05](05-tracking-pipeline.md)–[16](16-performance-budget.md)) go deep on *how*; this one is the *what talks to what*.

**Implementation status:** the shared types, constants, typed events, lifecycle and clock-normalization helpers are now executable. Subsystem implementation and browser verification are in progress; a shared-contract check is not a completed phase gate. [P0 in the roadmap](../ROADMAP.md) implements the shared types, constants and test fixtures before subsystems depend on them. Paths below describe the current scaffold and may change when a clearer boundary is justified; the data contracts and acceptance gates remain the authority.

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
| Beatmap Worker | Offline audio analysis | Not frame-bound; target < 4 s per 3-minute reference song, measured separately from decode |
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

**Dependency rule:** shared types, constants and math have no runtime dependency on higher layers. Workers communicate through typed messages. The game core publishes events; the renderer and UI subscribe. UI controls send commands to the state machine rather than changing session data. `render/` and `ui/` never mutate game state; `game/` never imports `three`. The table is a responsibility map, not a topological ordering of imports.

## Contracts

The identifiers below are normative. Implementation files MUST use these names so that doc terms are greppable.

### Tracking Worker → Main: `TrackingFrame`

```ts
export interface TrackingFrame {
  seq: number;              // monotonically increasing frame id
  tCapture: number;         // main performance timeline; sensor capture if available, otherwise frame callback receipt
  tInferDone: number;       // worker completion converted to the MAIN performance timeline (see [05])
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
  landmarks: Float32Array;        // 33 × (x, y, z, visibility) in MIRRORED image space; indices 25..32 are zeroed
  worldLandmarks: Float32Array;   // 33 × (x, y, z) metres, hip-centred; indices 25..32 are zeroed
}

export interface MaskFrame {
  width: number;                  // MASK_W
  height: number;                 // MASK_H
  data: Uint8Array;               // width*height, row-major, top-left origin, ALREADY MIRRORED; 0..255 person confidence
}
```

All typed arrays are transferred (zero-copy). The worker pre-allocates and recycles buffers from a two-slot ring so the main thread can hold the latest frame while the next is being written.

Ownership is exclusive: a transferred buffer is detached at its sender. `take()` lends a frame only until the input pipeline and renderer have copied the data they retain; recycling happens after that point. Retained masks, histories and highlight captures MUST own copies. A stalled consumer drops capture work rather than allocating an unbounded replacement ring. Browser/MediaPipe result objects can allocate internally; the zero-allocation requirement applies to application-owned hot-path buffers after warm-up, not to an unmeasured claim about third-party internals.

### Shared math and input source

`Vec2 = { x: number; y: number }`, `Vec3 = { x: number; y: number; z: number }`, and `Plane = { normal: Vec3; point: Vec3 }` are plain data types defined once in the shared type module. Vectors in persistent game state are reused objects. Event consumers copy values they retain beyond the dispatch; they MUST NOT retain a pooled object that the producer will mutate.

Live camera and replay fixtures feed the same `TrackingFrame` consumer. The source reports `live` or `replay` in diagnostics and benchmark metadata; replay MUST display a visible badge and MUST NOT be described as a live-camera measurement. Fixtures carry their original relative capture times, stable sequence numbers and a schema version ([17](17-testing-and-qa.md)). Reject non-finite timestamps, invalid array lengths, non-increasing sequences and live samples whose arrival age exceeds `INPUT_MAX_AGE_MS` before they reach scoring. Replay rebases relative times and uses a deterministic simulated delivery policy; JSON load time is never interpreted as tracking delay. Replaying identical inputs and a fixed beatmap produces identical judgement events and scores, independent of render cadence.

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
  pos: Vec3;                     // measured palm centre on the PLAY PLANE (world metres, z = 0); never render-extrapolated
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

### Menu navigation and camera setup

`MenuPointerState`, `MenuActivation` and `CameraSetupState` have their authoritative shapes in [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md). Export them once from the planned framework-free `core/menuInput.ts` contract module. They are separate from scored game events: `gestures/menuPointer.ts` consumes fresh mirrored image-space hands, while `ui/menuTargets.ts` registers app-owned target geometry and dispatches semantic actions through the same guards as mouse/keyboard.

The menu pointer uses viewport CSS pixels and a separate comfortable 2D reach rectangle, not the play-plane/camera projection or body calibration. Open palm moves; an armed Open → Point transition activates once, with release/rearm and stale-input/layout/native-input cancellation. It runs only in allowed menu surfaces, never in PLAYING. Read [25](25-menu-and-hand-navigation.md#hand-pointer-contract) before implementing gesture navigation; hover does not select.

BOOT can reach SELECT with no camera/models/tracking sample. Until current body calibration is valid, browse mode shows an illustrative central placeholder and **Set up camera**. SELECT's camera setup subflow loads/trains no new models: it initializes the pinned tracker, verifies live input and records calibration without requiring a song. Its `camera:setup` / `camera:ready` / `camera:error` / `camera:cancel` commands are SELECT self-transitions in [04](04-state-machine.md). Only validated setup produces a live browse figure/readiness; the placeholder never produces tracking or benchmark data.

### Game → Renderer / UI: events

The event bus (`core/events.ts`) is a typed emitter. The following events are the complete public surface of the game core:

| Event | Payload | Emitted when |
| --- | --- | --- |
| `state:change` | `{ prev, next }` | State machine transition |
| `note:spawn` | `{ note: Note }` | Note becomes live |
| `note:hit` | `{ note, judgement: 'perfect'\|'great'\|'good', timingErrorMs, hand, cutPlane?: Plane, impactPos: Vec3, impactVel: Vec3, scoreDelta, combo, multiplier }` | Successful destruction |
| `note:miss` | `{ note }` | Capture-time hit window closed without a hit; see [07] for late-arrival grace |
| `note:badcut` | `{ note, hand, gesture }` | Wrong gesture made contact |
| `beam:fire` | `{ hand, from: Vec3, to: Vec3, note: Note \| null }` | Eligible charged beam fires; `null` is a defensive resolution-race whiff, never an automatic early shot |
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
  score: number; maxScore: number; accuracy: number;   // maxScore is a score ceiling; accuracy is unmultiplied base points / possible base points ([07])
  rank: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
  maxCombo: number;
  counts: { perfect: number; great: number; good: number; miss: number; badcut: number; obstaclesHit: number; obstaclesDodged: number };
  kineticJoules: number; kcal: number;               // playful motion estimate; never measured exercise calories
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

The player must see a mirror. The worker converts to mirrored image space once (`u′ = 1 − u`, mask flipped horizontally). A single input adapter converts the pinned model's handedness convention into the player's anatomical left/right identity; verify that mapping using a labelled right-hand fixture before shipping. A coordinate reflection alone does not change anatomical identity. Nothing downstream mirrors again. Pose landmark indices retain MediaPipe's anatomical meaning after the coordinate reflection.

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

An armed calibration countdown also runs this loop in **pre-roll**: `SongClock.now()` is negative, notes spawn/render on their normal approach schedule, and tracking updates prepare the input state. Judgement/scoring is gated off until the estimated audible song position reaches 0 and the machine enters `PLAYING`. Countdown cancellation stops the scheduled source/clicks and invalidates the session epoch; merely hiding the overlay must never leave music scheduled to start.

1. **Clock** — `songTime = songClock.now()` (output-aligned from the audio clock; frozen while paused). `dt = clamp(frameDelta, 0, 50 ms)`.
2. **Borrow tracking** — collect pending valid `TrackingFrame`s in capture-time/sequence order, including all due records in replay mode. Keep their bounded buffer ownership until consumed; do not collapse several samples into one newest cursor before judgement.
3. **Spawner** — make live every note/obstacle with `t − approachMs ≤ songTime` (or `t − BEAM_LEAD_MS` for beams). Emit `music:event`s whose `t ≤ songTime`.
4. **Simulate** — update every live note/obstacle position from `songTime` (positions are pure functions of time; no integration, so pausing and resuming is exact).
5. **Input and judgement** — for each borrowed sample, run filtering/gesture state, test measured sweeps against capture-time note/obstacle windows, resolve notes and apply score/combo/kinetic updates **before advancing to the next sample**. Retain the last measured `HandCursor[2]` and `BodyState` for display. No new sample means no rejudging or beam charging. Stable ordering is sample time, note `t`, note `id`, then left/right as the hand tie-breaker; valid-hit priority is defined in [07](07-hit-detection-and-scoring.md).
6. **Finalise** — close missed-note/obstacle windows only after the bounded late-arrival policy, then publish the latest session stats. Visual prediction is a separate render input and never changes scoring, charge, measured history or kinetic estimates.
7. **Audio reactive** — read `BandEnergies`.
8. **Render** — renderer consumes cursors, body state, live objects, band energies, pending events (destruction effects are started in the same frame as the `note:hit` event). Camera rig update. Post FX.
9. **UI** — Zustand store updated with display values (throttled to ≤ 20 Hz for text fields).

Fixed-step physics is not required: destruction fragments use closed-form ballistic motion; the trail ribbon uses the cursor history. Nothing in the game needs integration that would be sensitive to `dt`.

The `dt` clamp affects cosmetic animation only; authoritative time always comes from `SongClock`. A large hitch must advance note positions to the correct song time without inventing intermediate tracking samples. Pause/reset discards pending contacts and resets velocity/charge histories so a return to frame cannot sweep across stale positions.

## Latency model

| Stage | Planning estimate | Notes |
| --- | --- | --- |
| Camera exposure + delivery | 30–60 ms | Device/exposure dependent; not guaranteed by requested fps |
| `createImageBitmap` + transfer | 1–3 ms | Main thread |
| Inference (hands + pose + mask) | 15–35 ms | Worker, GPU delegate |
| Transfer back + pipeline | 1–2 ms | Main |
| Render to display | 16–33 ms | Depends on frame rate and compositor |
| **Total motion-to-photon** | **70–130 ms** | — |

These are unverified planning estimates, not a benchmark result. Judgements use `tCapture` (not inference arrival time); when capture metadata is unavailable that timestamp is a receipt estimate and camera delivery delay remains uncompensated. Visual cursors may extrapolate to hide the gap; the player-adjustable `inputOffsetMs` shifts judgements with a documented sign. Measure latency percentiles and missed deadlines, rather than adding the estimates and presenting their sum as observed motion-to-photon latency.

## Constants

This is the shared constants registry. `core/constants.ts` now exports these names. Record any tuning change here in the same commit; defaults remain unmeasured unless evidence is linked. Values below are initial defaults to validate, not proven optima. Subsystem prose references these names rather than creating a second authority.

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
| `MISS_Z` | +1.2 m | Obstacle trailing-face clearance only; NEVER the note judgement deadline |
| `DESPAWN_Z` | +3.5 m | Visual culling threshold; retain unresolved gameplay records until the capture-time deadline closes |
| `BEAM_LEAD_MS` | 1600 | Beam target appears this early |
| `BEAM_ESCAPE_MS` | 600 | Beam target leaves this long after `t` |
| `BEAM_CHARGE_MS` | 500 | Hold-to-charge duration |
| `BEAM_AIM_RADIUS` | 0.45 m | Play-plane distance from measured fingertip to the baseline-camera projection of the target centre |
| `BEAM_ISOLATION_MS` | 700 | No other notes within this of a beam note |
| `INPUT_OFFSET_DEFAULT_MS` | 0 | User-adjustable in settings |
| `INPUT_OFFSET_RANGE_MS` | ±150 | Slider range for `inputOffsetMs` |
| `WINDOW_SCALE` | 1.0 | Multiplier applied to all `WINDOW_*_MS` (fallback 1.25 if tracking latency is high, [21 R09](21-risks-and-fallbacks.md)) |
| `OBSTACLE_GRACE_MS` | 120 | Frames after a wall reaches the hit plane that are not evaluated (hides tracking latency) |
| `BEAM_REFIRE_LOCK_MS` | 150 | Lockout after a beam fire |
| `EXTRAPOLATE_MAX_MS` | 80 | Cursor extrapolation cap |
| `INPUT_MAX_AGE_MS` | 250 | Maximum receipt/capture age accepted for scoring; also bounds late-result grace before a miss |

### Scoring

| Name | Value |
| --- | --- |
| `SCORE_PERFECT` / `SCORE_GREAT` / `SCORE_GOOD` | 100 / 70 / 40 |
| `SCORE_DODGE` | 50 |
| `MULTIPLIER_LADDER` | `[[0,1],[5,2],[15,4],[30,8]]` (combo ≥ threshold → multiplier) |
| `RANK_THRESHOLDS` | SS ≥ 0.95, S ≥ 0.90, A ≥ 0.80, B ≥ 0.65, C ≥ 0.50, else D (accuracy uses unmultiplied base points; see [07]) |
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
| `ONE_EURO_BETA` | 10 (per image width/s) | Position filter speed coefficient. Raised from 0.08 on 2026-10-25: at 0.08 a 4.5 m/s swing lagged 0.079 image widths (≈0.42 m) after 200 ms and measured below `SLASH_MIN_SPEED`; see the synthetic-performer replay in [17](17-testing-and-qa.md#synthetic-performer) |
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

### Classifier feature defaults

These were previously inline thresholds in [06](06-gesture-recognition.md). They are tunables, so P0 exports them from the same constants module as the shared gesture thresholds.

| Name | Value | Meaning |
| --- | --- | --- |
| `GESTURE_PALM_SIZE_MIN` | 0.015 | Minimum wrist-to-middle-MCP span in normalized width units |
| `GESTURE_EDGE_ON_WIDTH` | 0.35 | Palm width/span below this is ambiguous |
| `GESTURE_TIP_REACH_MARGIN` | 0.15 | Tip reach beyond PIP in palm-size units |
| `GESTURE_CURL_REACH_MAX` | 1.15 | Tip reach below this supports curl |
| `GESTURE_THUMB_OUT_MIN` | 1.3 | Thumb-to-pinky reach for weak open evidence |
| `GESTURE_THUMB_IN_INDEX_MAX` / `GESTURE_THUMB_IN_MIDDLE_MAX` | 0.6 / 0.5 | Weak fist evidence |
| `GESTURE_CONFIDENCE_MIN` | 0.25 | Below this, advance ambiguity instead of confirmation |
| `GESTURE_FAST_OPEN_CONFIDENCE` | 0.7 | One-sample `none → open` fast-path confidence |
| `GESTURE_POINT_RELAX_DEG` | 35 | Index/middle angle gap for relaxed point rule |
| `GESTURE_CURL_MARGIN_ORIGIN` / `GESTURE_CURL_MARGIN_SPAN` | 0.7 / 0.6 | Normalize curl confidence from reach |
| `POINT_DIR_MIN_M` | 0.05 | Below this projected finger length, retain cosmetic direction |
| `BEAM_CHARGE_DECAY` | 3 | Charge decay relative to charge-up rate |

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
| `LOW_LIGHT_MASK_MEAN` / `LOW_LIGHT_MS` | 0.55 / 1000 | Retained identifiers: low body-mask confidence for this duration → uncertain-tracking coaching. Confidence is not luminance and cannot establish low light. |
| `TWO_BODY_BLOB_AREA` | 0.15 | Second mask blob with area ≥ this fraction of the frame → "one player at a time" coaching line |
| `WAVE_REVERSALS` / `WAVE_WINDOW_MS` / `WAVE_MIN_AMPLITUDE` | 3 / 1500 / 0.06 | Wave detector |
| `COUNTDOWN_STEPS` | 3 | Countdown digits/clicks before audible song time zero |
| `START_COUNTDOWN_MS` | 2000 | Minimum startup preparation duration; neutral countdown uses this span. Confident tempo uses `COUNTDOWN_STEPS` whole beat intervals; early-note pre-roll may extend preparation. See [15](15-audio-playback-sync.md#21-start). |
| `RESUME_COUNTDOWN_MS` | 1500 | Resume count |
| `SONG_TAIL_MS` | 1500 | Wait after song end before RESULTS |

### Tracking identity, recovery and motion defaults

| Name | Value | Meaning |
| --- | --- | --- |
| `TRACK_CONFIDENCE_MIN` | 0.5 | Initial detection/presence/tracking and shoulder-presence confidence floor |
| `CALIB_VISIBILITY_MIN` | 0.6 | Calibration shoulder visibility floor |
| `HAND_RESET_FRAMES` | 2 | Missing samples before resetting a logical slot/filter |
| `HAND_IDENTITY_GRACE_MS` | 300 | Recent-slot label matching interval |
| `HAND_IDENTITY_MATCH_DIST` / `HAND_IDENTITY_OVERRIDE_DIST` | 0.15 / 0.08 | Normalized-image identity matching distances |
| `TRACK_STALL_MS` / `TRACK_RECOVERY_MS` | 1000 / 5000 | No-result pause and one worker-recreation deadline |
| `TRACK_REGAIN_MS` | 500 | Continuous valid presence before tracking-loss resume |
| `TRACK_RATE_TOLERANCE_MS` | 2 | Capture-rate scheduling tolerance |
| `TRACK_STATS_WINDOW` | 30 | Diagnostic EMA/window sample count; benchmarks retain raw values |
| `DEBUG_TEXT_HZ` | 4 | Diagnostic text refresh cap |
| `WAVE_DEAD_BAND` | 0.002 | Normalized horizontal motion ignored by wave detector |
| `BODY_FILTER_BETA` | 0.02 | Calm shoulder-midpoint filter coefficient |
| `BODY_SPEED_EMA` | 0.5 | Torso-speed sample EMA |
| `LEAN_TILT_ASSIST_DEG` | 15 | Optional shoulder-tilt assist, with translation evidence |
| `DUCK_HYSTERESIS` | 0.03 | Normalized nose-height hysteresis [STRETCH] |
| `CALIB_SAMPLE_MS` / `CALIB_HAND_SEEN_MS` | 500 / 2000 | Rest-pose averaging and recent-hand visibility windows |
| `CALIB_ASSUMED_SHOULDER_M` | 0.40 | Assumed shoulder span for the playful physical-speed proxy; not a measurement |
| `SWING_REFRACTORY_MS` / `SWING_TROUGH_RATIO` | 150 / 0.5 | Motion-proxy peak separation and trough rule |

### Beatmap generation

| Name | Value | Meaning |
| --- | --- | --- |
| `ANALYSIS_SR` | 22050 Hz | Analysis sample rate |
| `FFT_SIZE` / `HOP` | 2048 / 512 | STFT (≈ 93 ms window, 23.2 ms hop) |
| `BAND_EDGES_HZ` | low 20–150, mid 150–2000, high 2000–10000 | Spectral flux bands |
| `ONSET_DELTA` | 0.15 | Adaptive threshold offset |
| `ONSET_MIN_GAP_MS` | 80 | Minimum inter-onset interval |
| `ONSET_MIN_STRENGTH` | 0.25 | Relative peak gate; exceeding it does not prove musical content |
| `BPM_MIN` / `BPM_MAX` / `BPM_PRIOR` | 60 / 200 / 120 | Tempo search range and log-Gaussian prior centre |
| `BEAT_TIGHTNESS` | 100 | DP beat tracker penalty weight |
| `SNAP_GRID` | 4 (sixteenths) | Onsets snap to 1/4-beat grid |
| `SNAP_MAX_MS` | 35 | Onsets farther than this from a grid line are dropped |
| `MAX_DENSITY_PER_S` | `{ easy: 0.75, normal: 1.5, hard: 2.5 }` | Sliding-window note density cap (generator v3) |
| `MIN_NOTE_GAP_MS` | `{ easy: 700, normal: 400, hard: 260 }` | Consecutive note-group gap at full energy |
| `MAX_VISIBLE_NOTES` | `{ easy: 3, normal: 4, hard: 5 }` | Most notes whose hit times share one `APPROACH_MS` span (simultaneously on screen) |
| `MIN_SAME_CELL_GAP_MS` | 400 | Same-cell gap |
| `MIN_OBSTACLE_GAP_MS` / `MIN_OBSTACLE_MS` / `MAX_OBSTACLE_MS` | 3000 / 600 / 2400 | Obstacle constraints |
| `DROP_RISE_RATIO` / `DROP_MIN_BUILD_MS` | 1.4 / 8000 | Drop detection |
| `ENERGY_HOP_MS` | 100 | Energy envelope sampling for `analysis.energy` |
| `TEMPO_PRIOR_SIGMA_OCT` | 0.9 | Log-Gaussian tempo prior width, octaves |
| `TEMPO_MIN_CONFIDENCE` | 0.35 | Below this → onset-only mode with a warning badge |
| `TEMPO_REFINE_RANGE` / `TEMPO_REFINE_STEP` | 0.01 / 0.0001 | Fine beat-period search span and step, as fractions of the period; maximises supported onsets on a rigid grid ([08 §5](08-beatmap-generation.md#5-tempo-estimation-dsptempots)) |
| `BEAM_SUSTAIN_MS` / `BEAM_SUSTAIN_DB` | 500 / 3 | Mid/high-band power within this many dB for this long → beam candidate |
| `BEAM_SUSTAIN_PERCENTILE` / `BEAM_SUSTAIN_MAX_DB` | 10 / 12 | Otherwise the song's most sustained mid/high onsets (this percentile of their dB variation) qualify, never above the ceiling |
| `BEAM_MIN_SPACING_MS` | `{ easy: 12000, normal: 8000, hard: 6000 }` | Minimum time between beam notes |
| `CHORD_WINDOW_MS` | 20 | Onsets closer than this in different bands form a chord |
| `CENTROID_ROW_HZ` | `[400, 2500]` | Spectral centroid boundaries for row 0 / 1 / 2 |
| `WALL_NOTE_MARGIN_MS` | 600 | No note in a wall's covered columns within this margin of the wall |
| `MIN_TRACK_MS` | 5000 | Shorter files are rejected (`tooShort`) |
| `MAX_TRACK_MS` | 300000 (5 min) | Maximum accepted playable duration; companion downloads still pass this app-level limit |
| `MAX_UPLOAD_BYTES` | 60 × 1024 × 1024 | Larger uploads are rejected before decoding |
| `MAX_DECODED_PCM_BYTES` | 128 × 1024 × 1024 | Decoded float PCM accepted before analysis/resampling; not a cap on native decoder peak memory |
| `PLAYBACK_DECODE_SR` | 44100 Hz | Offline playback decode rate before a live `AudioContext` exists; keeps full-band music (analysis still uses `ANALYSIS_SR`) |
| `GAPLESS_LENGTH_TOLERANCE_SAMPLES` | 2 | Extra output-sample tolerance (plus the resampling ratio) when matching decoded MP3 length to iTunSMPB trimmed/untrimmed counts |
| `ANALYSIS_CACHE_MAX` | 30 | Complete source-analysis groups kept, including their difficulty maps |
| `GENERATOR_VERSION` | 4 | Cache key component |

### DSP windows, section detection and playable flow

These are **initial, unmeasured design defaults** used by [08](08-beatmap-generation.md). Export them centrally during P0; calibrate on development fixtures during P2, bump `GENERATOR_VERSION` when behavior changes, then freeze before held-out evaluation. Unit conversions, FFT radix/Hann coefficients, fixed v1 topology and derived frame/bin indices are structural formulas, not additional tunables.

| Name | Default | Unit | Purpose |
| --- | --- | --- | --- |
| `DSP_EPSILON` | `1e-12` | normalized scalar | Finite denominator/degeneracy guard |
| `ANALYSIS_PEAK_TARGET` / `SILENCE_PEAK_MAX` | `0.95` / `1e-4` | linear full scale | Peak normalization / silent-file cutoff |
| `STFT_LOG_GAIN` | `10` | scalar | Log-magnitude compression gain |
| `FLUX_NORM_PERCENTILE` / `ENERGY_NORM_PERCENTILE` | `95` / `98` | percentile | Robust flux / RMS normalization |
| `ONSET_MEAN_PRE_FRAMES` / `ONSET_MEAN_POST_FRAMES` / `ONSET_MAX_RADIUS_FRAMES` | `10` / `3` / `3` | analysis frames | Asymmetric mean window / local-max radius |
| `ONSET_RAW_RMS_MIN` | `0.002` | linear full scale | Pre-normalization local RMS gate; approximately −54 dBFS |
| `TEMPO_DETREND_FRAMES` | `16` | analysis frames | Slow onset-envelope removal |
| `TEMPO_HARMONIC_WEIGHT` | `0.5` | scalar | Half/double-period autocorrelation contributions |
| `TEMPO_OCTAVE_SWITCH_RATIO` | `1.15` | ratio | Minimum harmonic gain before octave switch |
| `TEMPO_SUPPORT_MIN_STRENGTH` / `TEMPO_MIN_SUPPORT_ONSETS` | `0.4` / `4` | strength / count | Confidence alignment support; fewer onsets means zero confidence |
| `BEAT_MIN_PERIOD_FACTOR` / `BEAT_MAX_PERIOD_FACTOR` | `0.5` / `2` | period multipliers | DP predecessor search interval |
| `BEAT_EDGE_PAD_PERIODS` | `1` | beat periods | Trim extrapolated beats beyond onset extent |
| `UNSNAPPED_MIN_STRENGTH` / `FREE_RHYTHM_MIN_STRENGTH` | `0.8` / `0.4` | strength | Retained syncopation / labelled onset-only fallback gates |
| `SECTION_SMOOTH_MS` | `4000` | ms | RMS envelope smoothing window |
| `KICK_MIN_STRENGTH` / `KICK_MIN_GAP_BEATS` | `0.6` / `0.5` | strength / beats | Kick event gate and rate limit |
| `DROP_BASELINE_END_MS` / `DROP_MIN_GAP_MS` | `1000` / `16000` | ms | Baseline exclusion immediately before drop / event separation |
| `DROP_MIN_ENERGY` | `0.6` | normalized energy | Absolute section-energy floor |
| `BUILD_WINDOW_MS` / `BUILD_DROP_LOOKAHEAD_MS` | `8000` / `4000` | ms | Build rise window / following-drop horizon |
| `BUILD_MAX_DIPS` / `BUILD_MAX_DIP_DEPTH` / `BUILD_MIN_RISE` | `2` / `0.03` / `0.25` | count / energy / energy | Allowed adjacent-sample dips and required rise |
| `CALM_WINDOW_MS` / `CALM_MIN_GAP_MS` | `6000` / `12000` | ms | Low-energy duration / event separation |
| `CALM_PERCENTILE` | `25` | percentile | Track-relative calm ceiling |
| `DENSITY_WINDOW_MS` | `4000` | ms | Sliding note-density horizon; validator uses the same value |
| `DENSITY_ENERGY_FLOOR` / `DENSITY_ENERGY_SMOOTH_MS` | `0.5` / `2000` | fraction / ms | Local gap = `MIN_NOTE_GAP_MS / (floor + (1 − floor) · smoothed energy)`: quiet passages thin out |
| `PHRASE_MAX_MS` / `PHRASE_REST_MS` | `{ easy: 10000, normal: 14000, hard: 18000 }` / `{ easy: 2000, normal: 1600, hard: 1200 }` | ms | Longest continuous phrase / deliberate note-free rest inserted where it removes the least salience |
| `CHORD_MIN_STRENGTH` / `CHORD_MIN_SPACING_MS` | `0.85` / `{ easy: Infinity, normal: 6000, hard: 2500 }` | salience / ms | Two-hand chords only on strong multi-band accents; never on Easy |
| `SMASH_MAX_SHARE` / `SMASH_MIN_LOW_STRENGTH` / `GESTURE_MIX_WINDOW_MS` | `{ easy: 0.4, normal: 0.4, hard: 0.45 }` / `0.5` / `8000` | share / strength / ms | Within each phrase window the strongest low-band hits (at least one) become smashes; the rest slash |
| `FLOW_RESTART_GAP_MS` / `FLOW_RESTART_SIDE` | `1200` / `'right'` | ms / logical side | Reset alternation after a rest; not a handedness claim |
| `FLOW_OUTER_ACCENT_EVERY` / `FLOW_OUTER_ACCENT_MIN_STRENGTH` | `4` / `0.7` | same-side count / strength | Occasional outer-column accent |
| `FLOW_FULL_ROW_JUMP_MIN_GAP_MS` / `EASY_LOW_ROW_MIN_GAP_MS` | `400` / `2000` | ms | Full bottom↔top spacing / Easy low-row recovery |
| `FLOW_HAND_LEAD_MS` / `FLOW_HAND_FOLLOW_MS` / `FLOW_GESTURE_CHANGE_MS` | `{ strike: 350, beam: 720 }` / `{ strike: 270, beam: 160 }` / `80` | ms | Same-side (same-hand) spacing = follow(previous) + lead(next) + change when gestures differ; a hand-recovery budget checked by the synthetic performer, not measured human reach |
| `OBSTACLE_INTRO_MS` | `8000` | ms | Initial wall-free time |
| `OBSTACLE_PERIOD_BEATS` / `OBSTACLE_SPACING_MS` | `{ easy: 32, normal: 16, hard: 12 }` / `{ easy: 16000, normal: 10000, hard: 7000 }` | beats / ms | Planned wall cadence on tracked beats and its spacing floor; notes then make room on the open side |
| `OBSTACLE_DURATION_BEATS` | `{ easy: 1.5, normal: 2, hard: 2 }` | beats | Wall occupancy before global duration clamp |
| `EASY_OBSTACLE_MIN_GAP_MS` | `12000` | ms | Easy start-to-start wall spacing |
| `GEN_PROGRESS_WEIGHTS` | `{ stft: .45, flux: .05, onsets: .05, tempo: .10, beats: .05, energy: .05, assign: .20, validate: .05 }` | fractions summing to 1 | Completed-stage progress weights |
| `GEN_WORK_CHUNK_MS` / `GEN_MAX_RETRIES` | `8` / `1` | ms / retries | Worker task-yield budget / user-requested retry bound |

### Audio playback, reactive & SFX

| Name | Value |
| --- | --- |
| `SONG_START_LEAD_S` | 0.15 — scheduled start offset after `AudioContext.currentTime` |
| `ANALYSER_FFT` | 1024 |
| `BAND_LOW_HZ` / `BAND_MID_HZ` / `BAND_HIGH_HZ` | 20–150 / 150–2000 / 2000–10000 |
| `ANALYSER_SMOOTH` / `ANALYSER_LOW_ATTACK` | 0.6 / 0.3 — retained previous value per 60 Hz frame; actual blend uses `1 − retention^(dt · 60)` |
| `ANALYSER_PEAK_DECAY_S` / `ANALYSER_PEAK_FLOOR` / `ANALYSER_RMS_GAIN` | 4 / 0.15 / 3 — adaptive band peak release, normalization floor and RMS scale |
| `SFX_POLYPHONY` | 6 simultaneous one-shots per sound (default; see `SFX_VOICE_LIMITS`) |
| `SFX_PITCH_JITTER_CENTS` | 35 (≈ ±2 %) — seeded cosmetic jitter on non-tonal hits only |
| `SFX_JUDGEMENT_RATE` | `{ perfect: 1.03, great: 1, good: 0.97 }` — deterministic playback-rate modifier |
| `SFX_STOP_RAMP_S` | 0.01 — fade an evicted one-shot before stopping |
| `MASTER_GAIN_DEFAULT` / `SFX_GAIN_DEFAULT` | 0.8 / 1.0 — persisted volume defaults |
| `DUCK_DB` / `DUCK_ATTACK_S` / `DUCK_RELEASE_S` | −1.5 / 0.03 / 0.4 — music ducking on the drop sting |
| `SFX_LOUDNESS_LUFS` | Per-sound BS.1770 momentary loudness target for the 28 synthesized cues (−42 … −15 LUFS); its keys define `SfxId`. Table and rationale in [15 §6](15-audio-playback-sync.md#6-sfx-bus-and-audio-feel-audiosfxts) |
| `SFX_PEAK_CEILING_DBFS` / `SFX_PEAK_KNEE` | −5 / 0.85 — rendered-sample ceiling and soft-knee start (fraction of the ceiling) |
| `SFX_CALM_LOUDNESS_DB` / `SFX_CALM_LOWPASS_HZ` | −3 / 4500 — Calm renders: quieter and low-passed |
| `SFX_SEED` | `0x51675abe` — synthesis seed (mixed with the sound id) and cosmetic-jitter seed |
| `SFX_DEFAULT_ROOT_HZ` / `SFX_UI_ROOT_HZ` | 523.25 / 880 — pitched-cue root octave start (and fallback root) / fixed menu root |
| `SFX_COMBO_STEP_SEMITONES` / `SFX_MILESTONE_SEMITONES` | `{ major: [0, 0, 4, 7], minor: [0, 0, 3, 7] }` / `{ major: [0, 4, 7, 12], minor: [0, 3, 7, 12] }` — reward transposition by multiplier-ladder / milestone index |
| `SFX_TONIC_FFT` / `SFX_TONIC_FRAMES` | 4096 / 40 — tonal-centre FFT size and frame count |
| `SFX_TONIC_MIN_HZ` / `SFX_TONIC_MAX_HZ` / `SFX_TONIC_MIN_CORRELATION` | 130 / 1760 / 0.5 — chroma band and minimum key-profile correlation; weaker estimates keep the default root |
| `SFX_MAX_VOICES` | 24 — global voice cap across sounds |
| `SFX_VOICE_LIMITS` | `{ charge: 2, resultsHigh: 1, resultsLow: 1, drop: 2, wallWarn: 3, milestone: 2, combo: 3, uiEnable: 1, uiHover: 2 }` — per-sound overrides of `SFX_POLYPHONY` |
| `SFX_LIMITER` | `{ thresholdDb: −3, kneeDb: 0, ratio: 20, attackS: 0.001, releaseS: 0.08 }` — bus safety limiter; the bus trims the compressor's spec makeup gain (≈ 1.71 dB) |
| `SFX_LIMITER_LOOKAHEAD_S` | 0.006 — compressor pre-delay; future-scheduled cues start this much earlier |
| `SFX_CACHE_MAX_BUFFERS` | 96 — rendered-buffer LRU bound across voicings |
| `SFX_BEAT_SNAP_MS` / `SFX_LOOKAHEAD_MS` / `SFX_LATE_SKIP_MS` | 40 / 120 / 20 — early-hit snap to chart time, chart-cue scheduling horizon, skip a scheduled cue later than this |
| `SFX_PAN_LANE` / `SFX_PAN_HAND` / `SFX_PAN_WALL` / `SFX_PAN_BEAM` | 0.45 / 0.1 / 0.55 / 0.3 — stereo placement of outer lanes, hand bias, wall side, beam hand |
| `SFX_DYNAMICS_DB` / `SFX_DYNAMICS_FULL_RATIO` | `{ min: −2, max: 1 }` / 2.5 — gesture-hit gain from swing speed relative to the gesture minimum |
| `SFX_WALL_WARN_LEAD_S` | 0.52 — wall-warning swell start before arrival (its peak) |
| `SFX_CHARGE_START` / `SFX_CHARGE_CANCEL_DROP` / `SFX_RELEASE_S` | 0.05 / 0.1 / 0.04 — beam-charge cue start, cancel drop from peak, release fade |
| `SFX_MISS_MIN_GAP_MS` / `SFX_UI_MIN_GAP_MS` / `SFX_BREAK_MIN_COMBO` / `SFX_NEUTRAL_GO_RATE` | 90 / 45 / 10 / 1.25 — miss and hover rate limits, minimum broken combo for the break cue, final neutral tick rate |

### UI

| Name | Value |
| --- | --- |
| `UI_TEXT_HZ` | 20 — store flush rate for text fields |
| `POP_LIFETIME_MS` / `MAX_POPS` | 600 / 6 — judgement pops |
| `STARTER_TRACK_MIN_COUNT` | 3 — distinct full-length bundled songs required by P2; demo excerpts do not count |
| `MENU_LIBRARY_PAGE_SIZE` | 3 — initial bounded song-card page; explicit Previous/Next for larger libraries |
| `MENU_STAGE_MIN_FRACTION` | 0.44 — minimum clear central-stage fraction of viewport width on supported side-rail layout |
| `MENU_TARGET_MIN_PX` / `MENU_TARGET_GAP_PX` | 72 / 16 — minimum gesture target dimensions / separation in CSS pixels |
| `MENU_REACH_BOUNDS` | `{ left: .20, right: .80, top: .15, bottom: .85 }` — initial mirrored-image menu reach rectangle; personalize independently of game calibration |
| `MENU_GESTURE_CONFIDENCE_MIN` | 0.6 — current geometric-classifier confidence needed to arm/confirm; not a statistical probability |
| `MENU_OPEN_ARM_MS` | 160 — same-target open-palm readiness interval; hover never activates |
| `MENU_POINT_CONFIRM_MS` | 100 — stable Point confirmation after the armed pose transition |
| `MENU_TRANSITION_GRACE_MS` | 200 — fresh ambiguous pose allowed while changing an armed open palm into Point; never grants activation itself |
| `MENU_POINT_MAX_MOVE_PX` | 24 — maximum CSS-pixel displacement from the frozen open anchor during confirmation |
| `MENU_CLICK_COOLDOWN_MS` | 350 — minimum interval after committed menu activation; opening/rearming still required |
| `MENU_TRACK_MAX_AGE_MS` | 150 — maximum main-performance-domain sample age for menu arming/clicking |
| `MENU_HANDOVER_COOLDOWN_MS` | 500 — hand quiet period after native input or explicit controlling-hand change |
| `MENU_COMPACT_MAX_WIDTH_PX` / `MENU_COMPACT_MAX_HEIGHT_PX` | 1099 / 699 — at or below either bound the side rails reflow above/below the figure stage with grouped inline pages; `ui/theme.css` mirrors both values (asserted by `tests/unit/compactBreakpoint.test.mjs`) |
| `HUD_TWEEN_TAU_MS` | 90 — exponential damping constant for the displayed HUD score; Calm shows the exact value |
| `HUD_COMBO_MILESTONES` | `[10, 25, 50, 100]` — unbroken combo counts that show the HUD milestone callout |

Menu defaults are initial unmeasured values; tune with held-out menu fixtures and live standing-distance trials, recording changes with their test results. `DWELL_SELECT_MS` is retired: point-click navigation is CORE rather than an optional dwell mode. Runtime central exports remain a P0 implementation task.

### Implementation admission and procedural fallback defaults

| Name | Value | Purpose |
| --- | --- | --- |
| `VALIDATION_MAX_ERRORS` | 32 | Bounded validation diagnostics |
| `ASSET_TEXT_MAX_CHARS` | 512 | Catalog/credit text admission bound |
| `MAX_ASSET_JSON_BYTES` | 8 × 1024 × 1024 | Local JSON admission bound |
| `TELEMETRY_CAPACITY` | 36000 | Retained samples per instrumentation ring; older values wrap |
| `ONSET_SPECTRAL_NOVELTY_MIN` | 0.02 | Positive log-spectrum growth / preceding total magnitude before normalization |
| `ONSET_RMS_RISE_RATIO` | 1.08 | Local raw RMS rise required by onset refinement |
| `GEOMETRY_EPSILON` | 1e-10 | Numerical degeneracy tolerance |
| `RESAMPLE_TAPS` / `RESAMPLE_PHASES` | 64 / 1024 | Band-limited analysis resampler kernel/phase table |
| `TRACK_RECORD_MS` / `TRACK_RECORD_MAX_BYTES` | 20000 / 2 × 1024 × 1024 | Explicit opt-in landmark-only recorder duration/JSON cap |
| `UPPER_BODY_LAST_LANDMARK` | 24 | Last retained MediaPipe pose index; knees/ankles/feet are zeroed |
| `UPPER_BODY_MASK_FADE_NORM` | 0.035 | Mask feather entirely above the actual hip line |
| `TRACK_FIRST_RESULT_TIMEOUT_MS` | 15000 | First submitted result deadline during setup only; steady-state stall remains 1000 ms |
| `ARRANGEMENT_VERSION` | 1 | Separate derivative-edit receipt version |
| `ARRANGEMENT_TOTAL_MS` / `ARRANGEMENT_FADE_MS` / `ARRANGEMENT_HIGHLIGHT_MS` | 80000 / 10000 / 60000 | Full-length 10→60→10 arrangement; shorter admitted sources scale proportionally |
| `ARRANGEMENT_SELECTION_HOP_MS` | 1000 | Continuous candidate-window search stride |
| `ARRANGEMENT_ENERGY_WEIGHT` / `ARRANGEMENT_ONSET_WEIGHT` | 0.65 / 0.35 | Declared highlight heuristic weights |
| `ARRANGEMENT_SILENCE_ENERGY` / `ARRANGEMENT_SILENCE_PENALTY` | 0.08 / 1 | Low-activity penalty in highlight selection |
| `DATASET_TRIAL_HZ` / `DATASET_TRIAL_HOLD_MS` / `DATASET_TRIAL_CROP_FRACTION` | 30 / 10000 / 0.8 | Simulated delivery of independent still annotations; no recorded motion/fingers/depth |
| `DATASET_TRIAL_MAX_SAMPLES` / `DATASET_TRIAL_MAX_CATCHUP_FRAMES` | 100 / 300 | Bounded fixture admission and catch-up; oversized clock jumps stop the trial instead of fabricating continuity |
| `DATASET_TRIAL_URL` / `DATASET_TRIAL_SHA256` | Local fixture path/hash in central exports | Exact attributed fixture integrity pins, not tunable motion evidence |
| `DATASET_CAMERA_MANIFEST_URL` / `DATASET_CAMERA_MAX_ITEMS` / `DATASET_CAMERA_MAX_FILE_BYTES` | `/dataset-camera/manifest.json` / 200 / 4 × 1024 × 1024 | Local ignored dataset-camera reel admission (prepared by `scripts/prepare-dataset-camera.mjs`; per-photo SHA-256 checked) |
| `DATASET_CAMERA_HOLD_MS` / `DATASET_CAMERA_HOLD_MIN_MS` / `DATASET_CAMERA_HOLD_MAX_MS` | 5000 / 1000 / 60000 | Photo hold per reel step and `?reelHold=` bounds |
| `DATASET_CAMERA_SWEEP_FIRST_HOLD_MS` | 20000 | `?reel=sweep` calibration-photo hold before cycling every photo by stream time |
| `DATASET_CAMERA_TRANSITION_GUARD_MS` / `DATASET_CAMERA_TIMELINE_CAPACITY` | 300 / 1024 | Captures this soon after a drawn-photo change are not attributed; bounded draw history |
| `DATASET_CAMERA_MATCH_SHOULDER_FRACTION` / `DATASET_CAMERA_PCK_SHOULDER_FRACTION` | 0.5 / 0.5 | Dataset-camera evaluation: wrist-to-hand match radius and PCK threshold, in annotated shoulder widths |
| `JUDGEMENT_TRACE_CAPACITY` | 8192 | Typed judgement-trace events per session; further events are counted as explicit overflow |
| `ASSET_MODEL_MAX_BYTES` / `MAX_LIVE_OBSTACLES` | 1048576 / 8 | Model admission and pooled wall capacity |
| `GRAVITY_MPS2` / `GLYPH_FACE_OFFSET_M` | 9.8 / 0.31 | Cosmetic ballistic gravity and block-front glyph plane |
| `ARENA_REACTIVE_GAIN` / `SIL_HEAD_RADIUS_M` | 2 / 0.11 | Actual audio-energy emission gain / nose-anchored head marker |

These are implementation defaults and development-fixture tuning, not held-out quality results. `BodyCalibration` additionally carries a current `identity` string covering camera/crop/player/mapping and `capturedAt` on the main performance timeline; its presence alone never establishes readiness.

### Synthetic performer (labelled trials only)

Used by `performer/*` to plan a performance that satisfies a chart under the game's own contact rules. These never tune gameplay and never count as live evidence ([17](17-testing-and-qa.md#synthetic-performer)).

| Name | Value | Meaning |
| --- | --- | --- |
| `PERFORMER_SHOULDER_WIDTH_NORM` | 0.24 | Performer shoulder span in image widths (inside the calibration bounds) |
| `PERFORMER_SHOULDER_V` | 0.36 | Shoulder-line height in normalized image coordinates |
| `PERFORMER_REST` | `{ x: 0.75, y: 1.15 }` m | Resting palm position on the play plane (mirrored per hand) |
| `PERFORMER_SLASH_SPEED` | 4.5 m/s | Constant play-plane speed through a slash |
| `PERFORMER_SLASH_WINDUP_M` / `PERFORMER_SLASH_FOLLOW_M` | 0.75 / 0.4 m | Slash start distance before, and follow-through after, the block centre |
| `PERFORMER_SLASH_CONTACT_MS` | 75 | Stroke start before the note so the first eligible contact lands on it |
| `PERFORMER_SMASH_SPEED` | 3 m/s | Constant fist speed through a smash |
| `PERFORMER_SMASH_DRAW_M` / `PERFORMER_SMASH_FOLLOW_M` | 0.62 / 0.1 m | Smash draw-back and follow-through distances |
| `PERFORMER_SMASH_CONTACT_MS` | 55 | Stroke start before the note for a smash |
| `PERFORMER_SETTLE_MARGIN_MS` | 30 | Settled at the stroke start this long before the judgement window opens |
| `PERFORMER_TRAVEL_MIN_MS` | 120 | Minimum relaxed travel time between strokes of one hand |
| `PERFORMER_RECOVER_MS` | 80 | Recovery after a stroke before travelling |
| `PERFORMER_BEAM_CONFIRM_LEAD_MS` | 60 | Point adoption lead beyond `BEAM_CHARGE_MS` so the charge completes at the note |
| `PERFORMER_LEAN_SHOULDERS` | 0.9 | Torso shift (shoulder widths) used to clear a wall |
| `PERFORMER_LEAN_EASE_MS` | 250 | Lean ease in/out duration |

### Rigged upper-body avatar (presentation only)

Used by `render/avatar*.ts` to retarget tracked, dataset, synthetic or idle joints onto the Blender-authored rig ([10](10-rendering-silhouette.md#11-rigged-avatar), [18](18-blender-mcp-asset-pipeline.md#11-rigged-avatar)). They never affect hit detection, scoring, calibration or tracking evidence.

| Name | Value | Meaning |
| --- | --- | --- |
| `AVATAR_URL` | `/assets/models/avatar.glb` | Same-origin skinned avatar |
| `AVATAR_TIER_FIGURE` | high/medium `avatar`, low `skeleton` | Figure requested per fixed tier; GLB failure also uses the line skeleton |
| `AVATAR_DEPTH_GAIN` / `AVATAR_DEPTH_MAX_M` | 0.6 / 1.1 m | World-landmark depth → play-space depth gain and clamp |
| `AVATAR_STRETCH_MAX` | 1.15 | Maximum arm lengthening so hands reach tracked wrists |
| `AVATAR_SMOOTH_MS` / `AVATAR_MISSING_SMOOTH_MS` | 55 / 320 | Rotation smoothing for tracked bones / bones easing toward neutral |
| `AVATAR_ROOT_SMOOTH_MS` / `AVATAR_SCALE_SMOOTH_MS` | 70 / 450 | Root translation and scale smoothing |
| `AVATAR_HOLD_MS` | 250 | A briefly missing joint holds its last target before easing |
| `AVATAR_LIMITS_DEG` | torso twist 45, lean 60, head 70, clavicle 16, wrist 85, MCP −25…95, PIP −5…110, DIP −5…85, spread 22, thumb base 50, thumb −15…75 | Joint limits relative to the parent |
| `AVATAR_RELAXED_CURL` | 0.22 | Finger curl without hand landmarks |
| `AVATAR_IDLE` | breath 4.6 s / 6 mm, sway 7.4 s / 12 mm, look 11.3 s / 6°, arm swing 12 mm, curl ±0.12 | Illustrative idle (static in Calm) |
| `AVATAR_PLACEHOLDER_SCALE` / `AVATAR_PLACEHOLDER_HIP_Y` | 2.85 / 0.12 m | Menu placeholder scale and hip height on the play plane |
| `AVATAR_RIM_COLOR_A` / `AVATAR_RIM_COLOR_B` | `#19F5FF` / `#B36BFF` | Fresnel rim gradient |
| `AVATAR_FILL_COLOR` / `AVATAR_ACCENT_COLOR` | `#070B16` / `#19F5FF` | Dark glass body and seam glow |
| `AVATAR_RIM_POWER` / `AVATAR_RIM_GAIN` / `AVATAR_ACCENT_GAIN` / `AVATAR_AUDIO_GAIN` | 2.6 / 1.5 / 2.2 / 0.9 | Fresnel exponent, rim, seam and music-energy gains |
| `AVATAR_OUTLINE_M` | 0.0045 | Outline hull offset (model metres) |

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

This is the existing scaffold map, not a required repository structure or a set of exclusive team ownership boundaries. Move files when needed and update paths/spec links in the same change. Build dependencies and acceptance gates are in [the roadmap](../ROADMAP.md).

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
│       └── sfx/           empty: every SFX is synthesized at runtime by src/audio/sfxSynth.ts
├── src/
│   ├── main.tsx           bootstraps renderer + React root
│   ├── App.tsx            screen router keyed on machine state
│   ├── core/              loop.ts, stateMachine.ts, events.ts, clock.ts, constants.ts, flags.ts
│   ├── tracking/          camera.ts, tracking.worker.ts, workerClient.ts, filters.ts, body.ts, wave.ts
│   ├── gestures/          classifier.ts, cursor.ts, blade.ts
│   ├── audio/             decode.ts, songClock.ts, player.ts, analyser.ts, sfx.ts, sfxSynth.ts, sfxBank.ts,
│   │                      sfxRender.worker.ts, sfxDirector.ts, sfxMetrics.ts, tonic.ts
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
| `?replay=<name>` | Planned dev/benchmark mode: logical name resolves through a local fixture allowlist; no arbitrary paths/URLs; visible REPLAY badge | [17 §Replay mode](17-testing-and-qa.md) |
| `?speed=0.25` | Planned replay inspection only: scale simulated song/input time together; never a release timing measurement | [17 §Replay mode](17-testing-and-qa.md#replay-mode) |
| `?stats=1` | Planned read-only diagnostics overlay; does not enable replay or change scoring | [16](16-performance-budget.md) |
| `?tier=low\|medium\|high` | Force a quality tier (skips the probe) | [16 §Quality tiers](16-performance-budget.md#quality-tiers) |
| `?probe=1` | Re-run the boot quality probe even if `localStorage` has `ss:tier` | [16](16-performance-budget.md) |
| `?contrast=1` | High-contrast mode: mask threshold `CONTRAST_MASK_THRESHOLD`, edge gain `CONTRAST_EDGE_GAIN` | [10](10-rendering-silhouette.md), [21 R02](21-risks-and-fallbacks.md) |
| `?seg=selfie` | Use `ImageSegmenter` (selfie model) for the mask instead of the pose model's mask | [05](05-tracking-pipeline.md), [ADR-003](03-decisions.md) |
| `?difficulty=easy\|normal\|hard` | Preselect difficulty in SELECT | [14](14-ui-ux.md) |
| Key `D` | Toggle debug overlay | [16 §Measurement](16-performance-budget.md) |
| Key `T` | Cycle quality tier; `Q` remains Quit while PAUSED | [16](16-performance-budget.md) |
| Key `H` | Toggle high-contrast mode | [10](10-rendering-silhouette.md) |
| Key `R` | Start/stop fixture recording (20 s) → downloads JSON | [17 §Fixtures](17-testing-and-qa.md) |
| `Esc` / `Space` | Pause (all builds) | [04](04-state-machine.md) |

## Build & tooling

- **Vite** dev server with HTTPS off (camera works on `http://localhost`). Workers are created with `new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' })` so Vite bundles them.
- **TypeScript strict**, `noUncheckedIndexedAccess` on.
- **ESLint** (typescript-eslint recommended) + **Prettier**; CI runs `typecheck`, `lint`, `test`, `build`.
- **Vitest** for unit tests (jsdom not needed; DSP and logic are pure).
- Required cross-origin headers are *not* needed: no `SharedArrayBuffer` is used. MediaPipe loads its WASM from `/models/wasm/` (same origin).
