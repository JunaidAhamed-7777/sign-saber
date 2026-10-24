# 04 — State Machine

The game is a single finite-state machine owned by `core/stateMachine.ts`. Every screen, every subsystem start/stop, and every input routing decision is a function of the current state. There are no "modes" outside this machine.

## States

```
                 ┌──────────────────────────────────────────────────────┐
                 │                                                      │
  ┌──────┐   ┌───▼────┐    ┌─────────────┐    ┌─────────┐    ┌────────┐ │
  │ BOOT ├──►│ SELECT ├───►│ CALIBRATION ├───►│ PLAYING ├───►│RESULTS ├─┘
  └──────┘   └───▲────┘    └──────┬──────┘    └──┬───▲──┘    └────────┘
                 │                │ back          │   │
                 │                └───────────────┘   │
                 │                             ┌──────▼──────┐
                 └─────────────────────────────┤   PAUSED    │
                                   quit        └─────────────┘
```

| State | Purpose | Tracking | Audio | Renderer |
| --- | --- | --- | --- | --- |
| `BOOT` | Load WASM, models, fonts, bundled beatmaps; request camera permission | Starting | Silent | Logo + progress |
| `SELECT` | Choose a bundled track, upload a file, or paste a YouTube URL; choose difficulty; generate beatmap | Running (preview silhouette in background) | Track preview optional | Attract scene: grid + silhouette, no blocks |
| `CALIBRATION` | Verify body + hands are tracked; measure body metrics; detect wave; countdown | Running | Song pre-buffered, silent | Silhouette + calibration overlay |
| `PLAYING` | The game | Running | Playing | Full scene |
| `PAUSED` | Tracking lost, tab hidden, or user paused | Running | Suspended | Frozen scene, dimmed |
| `RESULTS` | Score breakdown, kinetic energy, 3D highlight | Running (for background silhouette) | Results sting then silence | Results scene |

## Transitions

| From | Event | Guard | To | Side effects |
| --- | --- | --- | --- | --- |
| `BOOT` | `boot:ready` | All assets loaded, camera permission granted | `SELECT` | Start tracking worker |
| `BOOT` | `boot:error` | — | `BOOT` (error view) | Show actionable error: camera denied, WebGL2 missing, model fetch failed |
| `SELECT` | `select:start` | A `BeatmapV1` is loaded and validated for the chosen difficulty | `CALIBRATION` | Decode audio to `AudioBuffer`; reset session stats |
| `CALIBRATION` | `calib:back` | — | `SELECT` | — |
| `CALIBRATION` | `calib:complete` | Body present ≥ `CALIB_PRESENCE_MS`, both hands seen, wave detected, countdown finished | `PLAYING` | Store `BodyCalibration`; schedule audio start at `t0 = audioCtx.currentTime + SONG_START_LEAD_S`; spawn clock starts |
| `PLAYING` | `track:lost` | No pose and no hands for > `TRACKING_LOST_PAUSE_MS` | `PAUSED` | Suspend `AudioContext`, freeze clock, show "step back into frame" |
| `PLAYING` | `pause:request` | Key `Esc`/`Space`, or `visibilitychange` hidden | `PAUSED` | Same as above |
| `PAUSED` | `track:regained` or `pause:resume` | Pose present for ≥ 500 ms | `PLAYING` | 3-2-1 overlay (`RESUME_COUNTDOWN_MS`), then resume `AudioContext` and clock |
| `PAUSED` | `pause:quit` | — | `SELECT` | Stop audio, clear scene |
| `PLAYING` | `song:ended` | Song time ≥ `durationMs + SONG_TAIL_MS` and no live notes | `RESULTS` | Capture highlight render target, compute final stats |
| `RESULTS` | `results:retry` | — | `CALIBRATION` | Same beatmap, reset stats (skip wave: `calibrationCached = true` shortens to presence check + countdown) |
| `RESULTS` | `results:songs` | — | `SELECT` | — |

Transitions not in this table are illegal and MUST throw in development builds (`assertTransition`).

## Per-state responsibilities

### BOOT

Loads, in parallel, with a single aggregated progress bar (weights in parentheses):

1. MediaPipe WASM fileset from `/models/wasm/` (10 %).
2. `hand_landmarker.task` (20 %), `pose_landmarker_lite.task` (20 %).
3. Fonts (5 %), GLB assets (15 %), bundled tracks' beatmap JSON (5 %).
4. Camera permission + `getUserMedia` (25 %, done last so the permission prompt appears after the page looks alive).

Failure modes are rendered as full-screen cards with a retry button and a one-line fix:

- Camera denied → "Allow camera access in the address bar, then Retry."
- No WebGL2 → "Open in Chrome or Edge with hardware acceleration on."
- Model fetch failed → "Run `npm run models` to download models into app/public/models."

BOOT also probes the quality tier (see [16 — Performance Budget](16-performance-budget.md#quality-tiers)) by rendering 30 frames of the attract scene and reading the median frame time.

### SELECT

- Library grid of bundled tracks (title, artist, BPM, duration, difficulties available).
- Upload zone (drag & drop or picker). On drop: hash the file (SHA-256), look up the `BeatmapV1` cache in IndexedDB keyed by `hash:difficulty:generatorVersion`; on miss, run the generator worker with a progress bar ("Listening… 43 %"); on completion show detected BPM and note count.
- YouTube field: calls the companion service ([23](23-youtube-companion-service.md)); if unreachable, the field shows "Companion service offline — upload a file instead" and is disabled.
- Difficulty selector: Easy / Normal / Hard.
- Start button is disabled until a validated beatmap exists.
- Background: the attract scene with the live silhouette so the player sees tracking is already working.

### CALIBRATION

Sequential checklist with live ticks (each line turns green when its condition has held for `CALIB_PRESENCE_MS`):

1. **"Step back until your shoulders and both hands are visible."** Condition: pose present with shoulders visible (visibility ≥ 0.6) and `shoulderWidthNorm` within `[CALIB_SHOULDER_MIN, CALIB_SHOULDER_MAX]`; both hands detected at least once in the last 2 s. If `shoulderWidthNorm > CALIB_SHOULDER_MAX` show "Too close — step back". If `< CALIB_SHOULDER_MIN` show "Too far — step closer".
2. **"Wave to confirm."** Condition: either hand's mirrored-image x coordinate reverses direction ≥ 3 times within 1.5 s with amplitude ≥ 0.06 of frame width (see [05 §Wave detector](05-tracking-pipeline.md#wave-detector)).
3. **"Get ready."** 3-2-1 countdown (`START_COUNTDOWN_MS` total), each digit on a beat of the track's BPM so the player feels the tempo before the first note.

On completion the following `BodyCalibration` is stored for the session:

```ts
interface BodyCalibration {
  centerX: number;           // mirrored-image x of shoulder midpoint at rest (0..1)
  shoulderWidthNorm: number; // shoulder distance in mirrored-image units
  headY: number;             // nose y at rest (0..1)
  physicalScale: number;     // metres per normalized image unit = 0.40 / shoulderWidthNorm
  capturedAt: number;
}
```

### PLAYING

Owns the game loop ordering described in [02 — Architecture §Frame loop](02-architecture.md#frame-loop). The HUD shows score, combo, multiplier, accuracy, song progress and two gesture indicators. Keyboard: `Esc`/`Space` pause; `D` toggles the debug overlay (landmarks, hit volumes, frame times) in development builds only.

### PAUSED

- Scene renders one final frame then stops updating (renderer keeps drawing the frozen frame with a dim overlay so bloom still looks alive).
- Reason text: "Tracking lost — step back into frame" or "Paused".
- Auto-resume only for the tracking-lost case; manual pause requires a key press or the on-screen Resume button (clickable, since hands may be unavailable).

### RESULTS

Displays, in this order, with staggered 120 ms entrance animations:

1. Rank letter (SS/S/A/B/C/D) with the highlight render on the right (3D silhouette skeleton pose at the peak-combo moment, slowly turntabling).
2. Score, accuracy %, max combo.
3. Judgement bars: Perfect / Great / Good / Miss / Bad Cut counts.
4. Kinetic energy: kJ and kcal with a one-line tooltip explaining the estimate.
5. Buttons: Retry, Songs.

## Implementation notes

- The machine is a plain object: `{ state, transition(event, payload) }` with an exhaustive `switch`; subscribers receive `(prev, next)` via the event bus (`state:change`). React screens subscribe through the Zustand store, which mirrors `state`.
- Subsystems implement `onEnter(state)` / `onExit(state)` hooks registered with the machine; e.g. the audio engine suspends on entering `PAUSED` and resumes on leaving it. Avoid scattering `if (state === …)` checks in update loops.
- All timing constants referenced here (`CALIB_PRESENCE_MS`, `TRACKING_LOST_PAUSE_MS`, `RESUME_COUNTDOWN_MS`, `START_COUNTDOWN_MS`, `SONG_TAIL_MS`, `CALIB_SHOULDER_MIN/MAX`) live in the [constants table](02-architecture.md#constants).
