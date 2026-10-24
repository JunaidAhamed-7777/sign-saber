# 04 — State Machine

The game is a single finite-state machine owned by `core/stateMachine.ts`. Every screen, every subsystem start/stop, and every input routing decision is a function of the current state. Camera setup is an explicit `SELECT` subflow, not a second game state machine or a new top-level screen state.

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
| `BOOT` | Prepare shell, renderer, local catalog and required menu assets; no camera request | Off until explicit setup | Silent; context may remain locked | Logo + truthful progress |
| `SELECT` | Browse bundled tracks and choose difficulty; optional upload/generation; run camera-setup subflow when requested | Off, starting or ready according to camera setup | Preview only after explicit action and audio unlock | Central placeholder + **Set up camera** until valid calibration; then live silhouette, with controls around it |
| `CALIBRATION` | Recheck the valid setup, confirm readiness, arm countdown/pre-roll | Running | Music scheduled for future `t0`; countdown clicks only for confident tempo | Live silhouette + guide; incoming notes during armed pre-roll |
| `PLAYING` | The game | Running | Playing | Full scene |
| `PAUSED` | Tracking lost, tab hidden, audio interruption, or user paused | Running when visible; capture stopped while hidden | Suspended | Frozen scene, dimmed |
| `RESULTS` | Score breakdown, motion-energy estimate, 2.5D highlight | Runs only while the configured camera is available | Results sting if audio remains usable | Results scene; placeholder if current camera/calibration is unavailable, with any saved highlight clearly historical |

## Transitions

| From | Event | Guard | To | Side effects |
| --- | --- | --- | --- | --- |
| `BOOT` | `boot:ready` | Required shell/catalog assets ready and renderer usable; no camera/model/sample prerequisite | `SELECT` | Show browse menu and illustrative central placeholder with **Set up camera**; preserve real readiness evidence |
| `BOOT` | `boot:error` | Shell/catalog/renderer preparation failed | `BOOT` (error view) | Show actionable failure and retry; camera permission/model failures belong to camera setup instead |
| `SELECT` | `camera:setup` | Explicit action; no setup already in flight | `SELECT` (camera-setup panel) | Cancel armed menu click; begin setup generation, permission/device/model progress and labelled live tracking preview when available; selected song is optional |
| `SELECT` | `camera:ready` | Current setup generation, live required tracking, mirror/reach check and matching `BodyCalibration` confirmed | `SELECT` (browse panel) | Mark calibration valid; replace central placeholder with the actual live silhouette; enable eligible hand menu input |
| `SELECT` | `camera:error` | Current setup failed, permission/device lost or calibration invalidated | `SELECT` (setup recovery or browse) | Cancel setup/gesture work, invalidate calibration, stop failed resources and show the central placeholder plus **Set up camera** and useful error; keep mouse/keyboard music browsing |
| `SELECT` | `camera:cancel` | Setup panel open | `SELECT` (browse panel) | Invalidate pending setup generation, release incomplete resources and return to placeholder; never convert cancellation into ready |
| `SELECT` | `select:start` | Valid beatmap/current request, decoded audio, running audio context, valid camera/calibration identity and stable required live tracking | `CALIBRATION` | Reset session stats; cancel preview/generation/menu click work; recheck presence before countdown |
| `CALIBRATION` | `calib:back` | — | `SELECT` | Cancel scheduled source/clicks, invalidate epoch, clear pre-roll objects |
| `CALIBRATION` | `calib:complete` | Body/hands ready, wave or equivalent accessible confirmation accepted (or valid cached retry), countdown complete and armed audible song clock reaches 0 | `PLAYING` | Enable capture-time judgement; audio and spawn clock were already scheduled at countdown begin |
| `PLAYING` | `track:lost` | No pose and no hands for > `TRACKING_LOST_PAUSE_MS` | `PAUSED` | Suspend `AudioContext`, freeze clock, show "step back into frame" |
| `PLAYING` | `pause:request` | Key `Esc`/`Space`, or `visibilitychange` hidden | `PAUSED` | Same as above |
| `PAUSED` | `track:regained` | Pause reason is tracking loss; page visible; pose and required hands stable; no fatal error | `PLAYING` | Remain paused during `RESUME_COUNTDOWN_MS`; transition only after audio resume succeeds |
| `PAUSED` | `pause:resume` | Explicit button/key; page visible; pose and required hands stable; audio resume succeeds | `PLAYING` | Same countdown; clear stale motion histories before accepting input |
| `PLAYING` | `tracking:stalled`, `tracking:fatal`, or audio interruption | — | `PAUSED` | Freeze scoring, retain actionable error; fatal faults require successful retry before resume |
| `PAUSED` | `pause:quit` | — | `SELECT` | Stop audio, clear scene |
| `PLAYING` | `song:ended` | Song time ≥ `durationMs + SONG_TAIL_MS` and no live notes | `RESULTS` | Capture highlight render target, compute final stats |
| `RESULTS` | `results:retry` | Matching camera/calibration still valid, stable required tracking and audio can run | `CALIBRATION` | Same beatmap, reset stats (valid cached calibration shortens to presence check + countdown); otherwise keep results and offer Songs → **Set up camera** |
| `RESULTS` | `results:songs` | — | `SELECT` | — |

Transitions not in this table are illegal and MUST throw in development builds (`assertTransition`).

User-visible requests can race (double Start, Quit during analysis, Retry after an error). Validate guards at commit time, ignore duplicate in-flight commands, and use a session/request generation token so stale async completions cannot change a newer state. A rejected guard produces an actionable status in the current screen, not a blank render or a fabricated success.

## Per-state responsibilities

### BOOT

Prepare the renderer, shell, required fonts/menu assets and local bundled catalog. The menu must be reachable without a camera, a permission grant, loaded inference models or a prior calibration. No `getUserMedia` call is made merely because the page loaded. Byte-based asset progress and completed stages are distinguished; never show a moving percentage for an unknown denominator.

Shell/renderer failures use an actionable BOOT card with retry. A missing optional font uses the documented fallback; a bad catalog explains which content is unavailable instead of inventing songs. No WebGL2 shows the supported-browser/hardware-acceleration guidance. Required gameplay assets may prepare lazily, but Start stays unavailable until they are actually ready.

WASM/models, camera permission, device opening and tracking initialization have separate progress inside the `SELECT` camera-setup panel. Their failure does not strand music browsing behind BOOT. Camera-denied/busy/missing-model/delegate errors retain the illustrative central person and **Set up camera**/retry guidance. A replay is a separately labelled developer/demo path, never a substitute for camera readiness.

BOOT may choose a conservative initial graphics tier. Defer the full tracking-on probe until setup succeeds (see [16 — Performance Budget](16-performance-budget.md#quality-tiers)); an empty scene or placeholder's median cannot certify gameplay performance. Store measured device/browser context with the final choice and permit the documented override.

### SELECT

- Library grid of bundled tracks (title, artist, BPM, duration, difficulties available).
- Upload zone (drag & drop or picker). On drop: hash the file (SHA-256), look up the `BeatmapV1` cache in IndexedDB keyed by `hash:difficulty:generatorVersion`; on miss, run the generator worker with stage progress. Show detected BPM and note count only for confident tempo. Preserve `lowTempoConfidence` on cache hits, show "Free rhythm — beats not detected" on that path, and carry the warning into calibration/session configuration.
- YouTube field: calls the companion service ([23](23-youtube-companion-service.md)); if unreachable, the field shows "Companion service offline — upload a file instead" and is disabled.
- Difficulty selector: Easy / Normal / Hard.
- Start is disabled until the selected map/audio, audio unlock, actual camera/tracking and matching body calibration are ready. Put the missing requirement next to Start. **Set up camera** remains prominent while the camera is unconfigured, permission is denied, or calibration is invalid; choosing a song never bypasses that guard.
- Decoding, cache writes and analysis have separate failure/cancel states. Changing track or difficulty invalidates old progress/results. Never reuse an old chart under a new song title. Empty/silent analysis explains that no playable chart was generated rather than inventing notes.
- The menu reserves its central stage for the person, as in [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md). Before setup/calibration, show a static clearly illustrative placeholder, the exact action **Set up camera**, and an honest status. It must not mirror motion, emit input, show TRACKING OK or enter tracking/latency metrics.
- Once setup is valid, the live silhouette occupies that same stage and controls stay in the side rails. Mouse and keyboard remain usable throughout. Open-palm pointer movement followed by pointing activates app-owned controls only when the menu driver has fresh confident input; it does not require body calibration to map the 2D pointer and cannot fire gameplay beams.

#### Camera setup within SELECT

This subflow works with no track selected and does not schedule song audio. The explicit **Set up camera** action opens camera/device guidance, then requests permission and loads/initializes the required models. A real browser click/key action is still needed when the browser requires trusted activation; webcam pointing cannot grant permission, unlock a blocked audio context or operate the native permission dialog.

After valid frames arrive, show a labelled **Live tracking preview** using silhouette/pose data, with a static target guide. This is an instructional preview, not a claim that calibration has completed. Verify camera/crop mapping, the selected anatomical control hand, comfortable shoulder/hand framing and rest metrics; average the same `BodyCalibration` fields described below, then confirm with a deliberate app-owned action. Setup succeeds only when the matching camera/crop/player/mapping identity and live readiness are valid. Returning to the browse panel then replaces the placeholder with the real tracked figure.

Cancel, denied permission, missing/busy hardware, worker/model failure and stale completion preserve the selected music and mouse/keyboard controls. Failed/incomplete setup returns to a placeholder with a useful recovery instruction. Camera/device/crop/mapping changes or revoked permission invalidate calibration immediately; a saved calibration object cannot falsely make the menu look tracked. A successful setup may reuse resources until the explicit camera-off action or app teardown; switching songs does not re-request permission.

### CALIBRATION

This is the pre-play check after successful SELECT setup, not the first permission dialog. Reuse `BodyCalibration` only for the same camera/crop/player/mapping identity; fresh required pose/hands are still checked. The sequential checklist uses live ticks (each line turns green when its condition has held for `CALIB_PRESENCE_MS`):

1. **"Step back until your shoulders and both hands are visible."** Condition: pose present with shoulders visible (visibility ≥ `CALIB_VISIBILITY_MIN`) and `shoulderWidthNorm` within `[CALIB_SHOULDER_MIN, CALIB_SHOULDER_MAX]`; both hands detected at least once within `CALIB_HAND_SEEN_MS`. If `shoulderWidthNorm > CALIB_SHOULDER_MAX` show "Too close — step back". If `< CALIB_SHOULDER_MIN` show "Too far — step closer".
2. **"Wave to confirm."** Condition: either hand's mirrored-image x coordinate meets `WAVE_REVERSALS`, `WAVE_WINDOW_MS` and `WAVE_MIN_AMPLITUDE` (see [05 §Wave detector](05-tracking-pipeline.md#wave-detector)).
3. **"Get ready."** At this step's beginning, freeze session configuration and choose/schedule future `t0` using [15 §Start](15-audio-playback-sync.md#21-start). The song clock starts negative immediately; spawn/render early notes during the countdown so every note receives its full approach. For confident tempo the last `COUNTDOWN_STEPS` digits/clicks land on whole beat intervals before `t0`. Free-rhythm/low-confidence maps use a neutral evenly spaced countdown over `START_COUNTDOWN_MS`, with no asserted BPM or musical metronome. A longer required approach adds a short ready/preparation interval before the final digits; it does not shorten the note's travel.

Confirmation is latched for the current attempt; the player need not keep waving throughout the countdown. Body/required-hand readiness must remain valid. Tracking loss, Back, hidden tab, changed selection or failed audio readiness cancels the attempt: stop and disconnect the scheduled music/click sources, clear pre-roll objects, and invalidate the clock/session epoch. A late `onended`/worker callback from that cancelled attempt cannot start play or show results. Re-arm only after readiness and confirmation are valid again. Give a keyboard/button alternative to the wave; it changes confirmation, not scoring input. Show the pause key, comfortable-range coaching and camera-shake control before motion starts. Never require an unsafe reach.

The following `BodyCalibration` is captured during SELECT setup and refreshed if the pre-play presence check requires it. It is committed only after actual stable samples and explicit confirmation; its mere existence is not a valid-cache flag:

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
- Fresh menu hand input may activate Resume/Quit through the same guarded actions as mouse/keyboard. It never charges a beam or changes gameplay state directly. If the camera was revoked/device mapping changed, invalidate calibration, keep Resume unavailable and offer Quit → Songs → **Set up camera**; do not auto-resume a stale setup.
- Preserve a discriminated pause reason (`manual`, `tracking`, `hidden`, `audio`, `fatal`) and the last valid song time. Regaining tracking cannot resume a manual/tab-hidden/fatal pause. Hidden pages do not keep requesting camera frames or drawing decorative animation.
- The countdown is an in-state subphase: `PAUSED → PLAYING` happens at its successful completion, never at the beginning. If tracking drops or `AudioContext.resume()` rejects, stay paused, cancel the countdown, and expose the appropriate retry/enable-audio button. Do not auto-start music merely because the page regained focus.

### RESULTS

Displays, in this order, with staggered 120 ms entrance animations:

1. Rank/statistics in the side rails with the highlight in the central figure stage: an owned 2.5D silhouette/skeleton composition from an actual captured moment, viewed with a shallow orbit rather than presented as a reconstructed body. Caption the actual saved timestamp; if capture was throttled, do not claim it is the exact peak.
2. Score, accuracy %, max combo.
3. Judgement bars: Perfect / Great / Good / Miss / Bad Cut counts.
4. Motion-energy estimate, labelled as a playful proxy. If kJ/kcal are displayed, the estimate label remains visible and must not imply measured workout energy or health benefit.
5. Buttons: Retry, Songs.

## Implementation notes

- The machine is a plain object: `{ state, transition(event, payload) }` with an exhaustive `switch`; subscribers receive `(prev, next)` via the event bus (`state:change`). React screens subscribe through the Zustand store, which mirrors `state`.
- Subsystems implement `onEnter(state)` / `onExit(state)` hooks registered with the machine; e.g. the audio engine suspends on entering `PAUSED` and resumes on leaving it. Avoid scattering `if (state === …)` checks in update loops.
- State transitions have a single owner and an observable sequence number. Hooks are idempotent; listeners, media streams, decoded buffers, workers and render resources have an explicit owner/dispose path. Quit/Retry resets note pools, filters, gesture charge and capture watermarks, so old input cannot score in a new run.
- Retry may reuse body calibration only for the same camera/crop/player and unchanged viewport mapping. If any of those change, rerun calibration. A cached wave skip never skips readiness or the countdown.
- Camera-setup progress and async tokens are owned by the SELECT subflow. Returning to browse/cancelling cannot permit a late permission/model/worker result to replace a newer setup or hide the placeholder falsely. The placeholder is renderer/UI decoration, not a synthetic `TrackingFrame`.
- All timing constants referenced here (`CALIB_PRESENCE_MS`, `TRACKING_LOST_PAUSE_MS`, `RESUME_COUNTDOWN_MS`, `START_COUNTDOWN_MS`, `SONG_TAIL_MS`, `CALIB_SHOULDER_MIN/MAX`) live in the [constants table](02-architecture.md#constants).

## State-machine acceptance

- [ ] Every table transition and rejected guard has a meaningful unit test, including repeated Start, quit while decoding and stale worker completion.
- [ ] With permission unset, denied or no camera attached, BOOT reaches a usable mouse/keyboard SELECT with three real catalog entries when installed, a central illustrative person and **Set up camera**. No camera prompt appears until requested and no fake tracking metrics are emitted.
- [ ] Setup works before choosing a track; cancel/error retains music selection, and only current confirmed live calibration replaces the browse placeholder. Changing device/crop invalidates it and prevents Start/Retry until setup succeeds again.
- [ ] A map with a first note before `approachMs` spawns it at negative song time and gives the full approach; no score changes before song time 0. Cancelling at the final countdown digit leaves no scheduled song, click, live note or stale callback.
- [ ] A low-confidence/onset-only map, including a cache hit, shows the free-rhythm warning and a neutral countdown without claiming detected musical beats.
- [ ] Manual pause, hidden tab, tracking loss and audio interruption resume only through their documented route; no input scores during countdown or pause.
- [ ] Denied camera, corrupt audio, missing model and failed resume each show a recoverable screen with the actual failure reason.
- [ ] Twenty consecutive retry/quit cycles do not accumulate workers, media tracks, listeners or live note objects.
