# 04 — State Machine

The game is a single finite-state machine owned by `core/stateMachine.ts`. Every screen, every subsystem start/stop, and every input routing decision is a function of the current state. There are no "modes" outside this machine.

This is a build specification. The present source files are stubs; completing [P1/P2 in the roadmap](../ROADMAP.md) makes these transitions real. Quality, accessibility and replay settings are session configuration attached to this machine, not alternative routes that bypass readiness checks.

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
| `PAUSED` | Tracking lost, tab hidden, audio interruption, or user paused | Running when visible; capture stopped while hidden | Suspended | Frozen scene, dimmed |
| `RESULTS` | Score breakdown, kinetic energy, 3D highlight | Running (for background silhouette) | Results sting then silence | Results scene |

## Transitions

| From | Event | Guard | To | Side effects |
| --- | --- | --- | --- | --- |
| `BOOT` | `boot:ready` | Required assets ready, renderer usable, tracking worker ready and first valid sample received (or explicitly labelled replay ready) | `SELECT` | Start attract scene; preserve readiness evidence |
| `BOOT` | `boot:error` | — | `BOOT` (error view) | Show actionable error: camera denied, WebGL2 missing, model fetch failed |
| `SELECT` | `select:start` | Beatmap validated for selected difficulty, audio decoded, audio context running, selected analysis request still current | `CALIBRATION` | Reset session stats; cancel stale preview/generation work |
| `CALIBRATION` | `calib:back` | — | `SELECT` | — |
| `CALIBRATION` | `calib:complete` | Body present ≥ `CALIB_PRESENCE_MS`, both hands seen, wave detected, countdown finished | `PLAYING` | Store `BodyCalibration`; schedule audio start at `t0 = audioCtx.currentTime + SONG_START_LEAD_S`; spawn clock starts |
| `PLAYING` | `track:lost` | No pose and no hands for > `TRACKING_LOST_PAUSE_MS` | `PAUSED` | Suspend `AudioContext`, freeze clock, show "step back into frame" |
| `PLAYING` | `pause:request` | Key `Esc`/`Space`, or `visibilitychange` hidden | `PAUSED` | Same as above |
| `PAUSED` | `track:regained` | Pause reason is tracking loss; page visible; pose and required hands stable; no fatal error | `PLAYING` | Remain paused during `RESUME_COUNTDOWN_MS`; transition only after audio resume succeeds |
| `PAUSED` | `pause:resume` | Explicit button/key; page visible; pose and required hands stable; audio resume succeeds | `PLAYING` | Same countdown; clear stale motion histories before accepting input |
| `PLAYING` | `tracking:stalled`, `tracking:fatal`, or audio interruption | — | `PAUSED` | Freeze scoring, retain actionable error; fatal faults require successful retry before resume |
| `PAUSED` | `pause:quit` | — | `SELECT` | Stop audio, clear scene |
| `PLAYING` | `song:ended` | Song time ≥ `durationMs + SONG_TAIL_MS` and no live notes | `RESULTS` | Capture highlight render target, compute final stats |
| `RESULTS` | `results:retry` | — | `CALIBRATION` | Same beatmap, reset stats (skip wave: `calibrationCached = true` shortens to presence check + countdown) |
| `RESULTS` | `results:songs` | — | `SELECT` | — |

Transitions not in this table are illegal and MUST throw in development builds (`assertTransition`).

User-visible requests can race (double Start, Quit during analysis, Retry after an error). Validate guards at commit time, ignore duplicate in-flight commands, and use a session/request generation token so stale async completions cannot change a newer state. A rejected guard produces an actionable status in the current screen, not a blank render or a fabricated success.

## Per-state responsibilities

### BOOT

Loads with an aggregated progress bar. Byte-based fetch progress and completed initialization stages are distinguished; do not show invented percentages for opaque model initialization. The following weights are initial UI estimates:

1. MediaPipe WASM fileset from `/models/wasm/` (10 %).
2. `hand_landmarker.task` (20 %), `pose_landmarker_lite.task` (20 %).
3. Fonts (5 %), GLB assets (15 %), bundled tracks' beatmap JSON (5 %).
4. Camera permission + `getUserMedia` (25 %, after an explicit "Enable camera" action and a short explanation that frames remain local).

Failure modes are rendered as full-screen cards with a retry button and a one-line fix:

- Camera denied → "Allow camera access in the address bar, then Retry."
- No WebGL2 → "Open in Chrome or Edge with hardware acceleration on."
- Model fetch failed → "Run `npm run models` to download models into app/public/models."
- No camera / busy camera → explain the actual device error, offer retry and device change when supported.
- Tracking worker/delegate initialization failed → display the failing stage, retry the supported fallback once, then offer a labelled replay demonstration only if that feature is implemented. Replay never claims camera tracking is working.

BOOT also probes the quality tier (see [16 — Performance Budget](16-performance-budget.md#quality-tiers)). Warm models/shaders first and test with tracking active; an empty attract scene's median over 30 frames is insufficient to choose a gameplay tier. Store the measured device/browser context with the decision and permit an explicit quality override.

### SELECT

- Library grid of bundled tracks (title, artist, BPM, duration, difficulties available).
- Upload zone (drag & drop or picker). On drop: hash the file (SHA-256), look up the `BeatmapV1` cache in IndexedDB keyed by `hash:difficulty:generatorVersion`; on miss, run the generator worker with a progress bar ("Listening… 43 %"); on completion show detected BPM and note count.
- YouTube field: calls the companion service ([23](23-youtube-companion-service.md)); if unreachable, the field shows "Companion service offline — upload a file instead" and is disabled.
- Difficulty selector: Easy / Normal / Hard.
- Start button is disabled until a validated beatmap exists.
- Decoding, cache writes and analysis have separate failure/cancel states. Changing track or difficulty invalidates old progress/results. Never reuse an old chart under a new song title. Empty/silent analysis explains that no playable chart was generated rather than inventing notes.
- Background: the attract scene with the live silhouette so the player sees tracking is already working.

### CALIBRATION

Sequential checklist with live ticks (each line turns green when its condition has held for `CALIB_PRESENCE_MS`):

1. **"Step back until your shoulders and both hands are visible."** Condition: pose present with shoulders visible (visibility ≥ `CALIB_VISIBILITY_MIN`) and `shoulderWidthNorm` within `[CALIB_SHOULDER_MIN, CALIB_SHOULDER_MAX]`; both hands detected at least once within `CALIB_HAND_SEEN_MS`. If `shoulderWidthNorm > CALIB_SHOULDER_MAX` show "Too close — step back". If `< CALIB_SHOULDER_MIN` show "Too far — step closer".
2. **"Wave to confirm."** Condition: either hand's mirrored-image x coordinate meets `WAVE_REVERSALS`, `WAVE_WINDOW_MS` and `WAVE_MIN_AMPLITUDE` (see [05 §Wave detector](05-tracking-pipeline.md#wave-detector)).
3. **"Get ready."** 3-2-1 countdown (`START_COUNTDOWN_MS` total), each digit on a beat of the track's BPM so the player feels the tempo before the first note.

The checklist must remain satisfied through the countdown; loss cancels the countdown without starting the song. Give a keyboard/button alternative to the wave confirmation for players who cannot perform it. This changes only confirmation, not scoring input. Show a clear pause key, comfortable-range coaching and the option to disable camera shake before motion starts. Never require an unsafe reach to satisfy calibration.

On completion the following `BodyCalibration` is stored for the session:

```ts
interface BodyCalibration {
  centerX: number;           // mirrored-image x of shoulder midpoint at rest (0..1)
  shoulderWidthNorm: number; // shoulder distance in mirrored-image units
  headY: number;             // nose y at rest (0..1)
  physicalScale: number;     // CALIB_ASSUMED_SHOULDER_M / shoulderWidthNorm; rough proxy, not a measurement
  capturedAt: number;        // main performance timeline, not wall-clock date
}
```

### PLAYING

Owns the game loop ordering described in [02 — Architecture §Frame loop](02-architecture.md#frame-loop). The HUD shows score, combo, multiplier, accuracy, song progress and two gesture indicators. Keyboard: `Esc`/`Space` pause; `D` toggles the debug overlay (landmarks, hit volumes, frame times) in development builds only.

### PAUSED

- Scene renders one final frame then stops updating (renderer keeps drawing the frozen frame with a dim overlay so bloom still looks alive).
- Reason text: "Tracking lost — step back into frame" or "Paused".
- Auto-resume only for the tracking-lost case; manual pause requires a key press or the on-screen Resume button (clickable, since hands may be unavailable).
- Preserve a discriminated pause reason (`manual`, `tracking`, `hidden`, `audio`, `fatal`) and the last valid song time. Regaining tracking cannot resume a manual/tab-hidden/fatal pause. Hidden pages do not keep requesting camera frames or drawing decorative animation.
- The countdown is an in-state subphase: `PAUSED → PLAYING` happens at its successful completion, never at the beginning. If tracking drops or `AudioContext.resume()` rejects, stay paused, cancel the countdown, and expose the appropriate retry/enable-audio button. Do not auto-start music merely because the page regained focus.

### RESULTS

Displays, in this order, with staggered 120 ms entrance animations:

1. Rank letter (SS/S/A/B/C/D) with the highlight render on the right (3D silhouette skeleton pose at the peak-combo moment, slowly turntabling).
2. Score, accuracy %, max combo.
3. Judgement bars: Perfect / Great / Good / Miss / Bad Cut counts.
4. Motion-energy estimate, labelled as a playful proxy. If kJ/kcal are displayed, the estimate label remains visible and must not imply measured workout energy or health benefit.
5. Buttons: Retry, Songs.

## Implementation notes

- The machine is a plain object: `{ state, transition(event, payload) }` with an exhaustive `switch`; subscribers receive `(prev, next)` via the event bus (`state:change`). React screens subscribe through the Zustand store, which mirrors `state`.
- Subsystems implement `onEnter(state)` / `onExit(state)` hooks registered with the machine; e.g. the audio engine suspends on entering `PAUSED` and resumes on leaving it. Avoid scattering `if (state === …)` checks in update loops.
- State transitions have a single owner and an observable sequence number. Hooks are idempotent; listeners, media streams, decoded buffers, workers and render resources have an explicit owner/dispose path. Quit/Retry resets note pools, filters, gesture charge and capture watermarks, so old input cannot score in a new run.
- Retry may reuse body calibration only for the same camera/crop/player and unchanged viewport mapping. If any of those change, rerun calibration. A cached wave skip never skips readiness or the countdown.
- All timing constants referenced here (`CALIB_PRESENCE_MS`, `TRACKING_LOST_PAUSE_MS`, `RESUME_COUNTDOWN_MS`, `START_COUNTDOWN_MS`, `SONG_TAIL_MS`, `CALIB_SHOULDER_MIN/MAX`) live in the [constants table](02-architecture.md#constants).

## State-machine acceptance

- [ ] Every table transition and rejected guard has a meaningful unit test, including repeated Start, quit while decoding and stale worker completion.
- [ ] Manual pause, hidden tab, tracking loss and audio interruption resume only through their documented route; no input scores during countdown or pause.
- [ ] Denied camera, corrupt audio, missing model and failed resume each show a recoverable screen with the actual failure reason.
- [ ] Twenty consecutive retry/quit cycles do not accumulate workers, media tracks, listeners or live note objects.
