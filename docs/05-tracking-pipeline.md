# 05 — Tracking Pipeline

Scope: everything between photons hitting the webcam and a smoothed, mirrored, timestamped `TrackingFrame` plus derived `BodyState` being available to the game core. Gesture classification and `HandCursor` construction are in [06](06-gesture-recognition.md). Contracts and constants come from [02 — Architecture](02-architecture.md); this doc never redefines them.

```
video element ──rVFC──► crop 16:9 ──► createImageBitmap(INFER_W×INFER_H) ──transfer──► Worker
                                                                                        │ HandLandmarker (640×360)
                                                                                        │ downscale → PoseLandmarker + mask (320×180)
                                                                                        │ mirror once, pack, transfer
main: workerClient ◄──TrackingFrame──────────────────────────────────────────────────────┘
      │
      ├─► One Euro filters (per landmark set)   ─► filtered HandRaw / PoseRaw for [06]
      ├─► hand identity tracker
      ├─► presence / tracking-lost
      ├─► wave detector (CALIBRATION only)
      └─► body metrics ─► BodyState
```

## 1. Camera capture (`tracking/camera.ts`)

### 1.1 Opening the stream

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    width:  { ideal: CAM_REQ_W },
    height: { ideal: CAM_REQ_H },
    frameRate: { ideal: CAM_REQ_FPS, max: CAM_REQ_FPS },
    facingMode: 'user',
  },
});
```

1. Attach to a hidden `<video playsinline muted autoplay>`; `await video.play()`.
2. Read the actual settings via `stream.getVideoTracks()[0].getSettings()`; log `width × height @ fps`. If the delivered frame rate is below the P4 tracking floor, log a warning (the pipeline still works; `TRACK_TARGET_HZ` is a cap, not a floor).
3. If `getUserMedia` rejects with `NotAllowedError` → `boot:error` with the camera-denied card ([04 §BOOT](04-state-machine.md#boot)). `NotFoundError` → "No camera found". `OverconstrainedError` → retry once with no constraints at all.
4. The raw feed MUST never be attached to a visible element in production builds. The debug overlay (`D` key, dev only) MAY show it at 25 % opacity.

### 1.2 Frame callback and centre-crop

Frames are pulled with `video.requestVideoFrameCallback((now, meta) => …)`, not `requestAnimationFrame`, so capture runs at the camera rate regardless of render rate.

- `tCapture = finite(meta.captureTime) ? meta.captureTime : now`, in the main performance timeline. `captureTime` is optional metadata; on an ordinary local camera it may be unavailable. Record `capture` versus `callback-receipt` as the timestamp source in diagnostics/benchmark metadata. `receiveTime` describes remote network receipt and MUST NOT be presented as sensor exposure. The fallback cannot remove exposure/delivery delay; measure that separately. See the [video-frame metadata contract](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
- Rate limit: if `now − lastSentAt < 1000 / TRACK_TARGET_HZ − TRACK_RATE_TOLERANCE_MS` skip the frame.
- Back-pressure: reserve `inFlight = true` **before** awaiting `createImageBitmap`, so two asynchronous capture requests cannot overlap. Clear it only on the request's result/error/drop acknowledgement. If capture/inference is still reserved, or both fixed ring slots are borrowed by the consumer, skip the callback; no camera work is queued. Count skipped callbacks separately from inference failures.
- Centre-crop to 16:9: given delivered `vw × vh`, if `vw / vh > 16/9` crop width to `vh · 16/9`, else crop height to `vw · 9/16`, centred. The crop rectangle `(sx, sy, sw, sh)` is passed to `createImageBitmap(video, sx, sy, sw, sh, { resizeWidth: INFER_W, resizeHeight: INFER_H, resizeQuality: 'low' })`.
- The resulting `ImageBitmap` is posted to the worker with `[bitmap]` as the transfer list. After a successful transfer the worker owns it and closes it in `finally`, including errors. If capture finishes after stop/cancellation, or posting fails before ownership transfers, the main thread closes the bitmap and releases the reservation. Every success, error and dropped-frame path acknowledges the reservation.

Cost target on the main thread: ≤ 1.5 ms of synchronous capture work per processed frame. Record asynchronous bitmap completion separately; a promise's wall time is not main-thread CPU time, and GPU backing is browser/driver dependent. Measure both with performance marks and a browser trace.

## 2. The tracking worker (`tracking/tracking.worker.ts`)

Created as a module worker so Vite bundles it:

```ts
new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
```

### 2.1 Initialisation

```ts
const fileset = await FilesetResolver.forVisionTasks('/models/wasm');   // same-origin, bundled (ADR-013)
const handCanvas = new OffscreenCanvas(INFER_W, INFER_H);
const poseGlCanvas = new OffscreenCanvas(POSE_W, POSE_H);
hands = await HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numHands: 2,
  minHandDetectionConfidence: TRACK_CONFIDENCE_MIN,
  minHandPresenceConfidence: TRACK_CONFIDENCE_MIN,
  minTrackingConfidence: TRACK_CONFIDENCE_MIN,
  canvas: handCanvas,
});
pose = await PoseLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: TRACK_CONFIDENCE_MIN,
  minPosePresenceConfidence: TRACK_CONFIDENCE_MIN,
  minTrackingConfidence: TRACK_CONFIDENCE_MIN,
  outputSegmentationMasks: true,
  canvas: poseGlCanvas,
});
```

- Use independent task-owned WebGL canvases; do not assume sharing a canvas/context between tasks is supported. P0 MUST smoke-test module worker + GPU delegate + callback masks on the pinned package and intended browsers before committing to this route. If GPU creation throws, close partially constructed tasks, retry once with `delegate: 'CPU'`, and report the actual delegate so the UI can show a useful fallback message. A slower delegate must pass its own tracking/latency gate; successful initialisation alone is insufficient.
- A second `OffscreenCanvas(POSE_W, POSE_H)` with a `2d` context (`{ alpha: false, willReadFrequently: false }`) is kept for the pose downscale.

### 2.2 Per-frame processing

```
on 'frame' { bitmap, seq, tCapture }:
  t0 = performance.now()
  ts = max(tCapture, lastTs + 1)            // detectForVideo REQUIRES strictly increasing timestamps
  lastTs = ts
  handRes = hands.detectForVideo(bitmap, ts)
  poseCtx.drawImage(bitmap, 0, 0, POSE_W, POSE_H)
  pose.detectForVideo(poseCanvas, ts, poseRes => {
    pack landmarks and copy/resample the mask into ring[slot]
  })                                       // masks are callback-scoped
  bitmap.close()                           // actually in finally, even when inference throws
  post 'result' with transfer list
  slot = 1 - slot
```

Rules:

1. `detectForVideo` timestamps MUST be strictly monotonic per task. The `max(…, lastTs + 1)` guard handles clock jitter; both tasks share `ts`.
2. Both tasks run on the same frame so hands, pose and mask are mutually consistent in time.
3. Use the callback overload of `PoseLandmarker.detectForVideo`: mask lifetime is guaranteed only inside that callback. Read the person confidence with `mask.getAsFloat32Array()`, clamp to 0..1 and quantise into our owned `Uint8Array` before returning. The result-returning overload copies masks and is discouraged for high-throughput use. Never post an `MPMask` or borrow its GPU texture across contexts. See the [PoseLandmarker API](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.poselandmarker) and [MPMask API](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.mpmask).
4. Read `mask.width` and `mask.height`; do not assume model output resolution equals input resolution. Resample the actual result into fixed `MASK_W × MASK_H`, flipping horizontally during that copy. Missing pose/mask produces `null`, never an old mask relabelled as current. Readback cost is a measured substage, not a promised 1–2 ms.
5. If a frame arrives while processing (should not happen thanks to main-thread back-pressure) it is closed and dropped; a `dropped` counter is included in the next result.

### 2.3 Mirroring, done exactly once

The player must see a mirror ([02 §Mirroring](02-architecture.md#mirroring)). In the worker, after inference:

- Every normalized landmark: `u′ = 1 − u`; `v`, `z`, `visibility` unchanged.
- World landmarks (`worldLandmarks`): `x′ = −x`; `y`, `z` unchanged. (These are only used for finger angles and skeleton depth; flipping x keeps chirality consistent with the mirrored image.)
- Handedness: one adapter maps the pinned task's label convention to the player's anatomical hand. Verify the adapter against labelled left/right camera fixtures, including raw versus already-mirrored input; do not swap labels merely because x was reflected. Store `score = category.score`, which is handedness confidence, not landmark accuracy. The [Hand Landmarker result guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) defines the output fields; our fixture defines how that model/input combination maps to the player.
- Mask flip: while resampling from the actual mask dimensions, reverse destination columns and write `round(clamp(confidence, 0, 1) · 255)`. The source is a floating-point confidence array; `getAsUint8Array()` is not an interchangeable confidence conversion.

Downstream code MUST NOT mirror again. Tests: a fixture with a known right-hand wave MUST produce `handedness: 'right'` and increasing `u′` when the real hand moves to the player's right.

### 2.4 Buffer ring and transfer

The worker owns two slots; each slot holds:

| Buffer | Type | Length |
| --- | --- | --- |
| `handLm[2]` | `Float32Array` | 21 × 3 |
| `handWorld[2]` | `Float32Array` | 21 × 3 |
| `poseLm` | `Float32Array` | 33 × 4 |
| `poseWorld` | `Float32Array` | 33 × 3 |
| `mask` | `Uint8Array` | `MASK_W × MASK_H` |

Buffers are transferred to the main thread with the result (the worker loses access), and transferred **back** with the next `frame` message once both the input pipeline and renderer have consumed them (`recycle` field). Each slot has one owner and an explicit available/in-flight/borrowed state. The two-slot ring is a hard bound: if neither slot is available, skip capture and count it rather than allocating replacements. A dedicated `recycle` message returns buffers when stopping before another frame is sent. Never recycle a mask while a texture upload or highlight still refers to it; those consumers copy into their own fixed storage. `allocs` measures application buffer allocation after warm-up and should remain zero during steady state.

### 2.5 Message protocol

```ts
// main → worker
type ToWorker =
  | { type: 'init'; wasmBase: string; handModel: string; poseModel: string; mainTimeOrigin: number }
  | { type: 'frame'; seq: number; tCapture: number; bitmap: ImageBitmap; recycle?: RecycledBuffers }
  | { type: 'setOptions'; trackHz?: number }      // reserved for quality tiers
  | { type: 'recycle'; buffers: RecycledBuffers }
  | { type: 'dispose' };

// worker → main
type FromWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; initMs: number }
  | { type: 'result'; frame: TrackingFrame; dropped: number; allocs: number }
  | { type: 'error'; where: 'init' | 'frame'; seq?: number; message: string; fatal: boolean };

interface RecycledBuffers { handLm: Float32Array[]; handWorld: Float32Array[]; poseLm?: Float32Array; poseWorld?: Float32Array; mask?: Uint8Array }
```

Transfer lists: `frame` → `[bitmap, ...recycled.buffers]`; `result` → every typed array's `.buffer` inside `frame`.

The worker stamps completion in the **main** timeline: `tInferDone = performance.timeOrigin + performance.now() − mainTimeOrigin`. `inferenceMs` remains a worker-local difference. Main and worker have different origins; do not subtract their unconverted `performance.now()` values or estimate skew from a one-way message, which mixes clock offset with delivery delay. `tCapture` is never changed because it originated on the main thread. This follows the [cross-context time-origin mapping](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin).

### 2.6 Worker client (`tracking/workerClient.ts`)

```ts
class TrackingClient {
  readonly latest: TrackingFrame | null;      // borrowed result; lifetime ends after consumption/recycle
  readonly stats: { hz: number; inferenceMs: number; mainToMainMs: number; dropped: number; delegate: string };
  start(video: HTMLVideoElement): void;        // begins rVFC loop
  stop(): void;
  take(): TrackingFrame | null;                // returns next pending sample in capture/sequence order
}
```

- The loop calls `take()` until the bounded pending ring is drained ([02 §Frame loop](02-architecture.md#frame-loop)). If no new result arrived it returns `null`. The input state advances once per sequence; replay drains all samples due at the current song time rather than dropping intermediate records to match render fps.
- `hz` is an EMA over recent results; benchmark percentiles use raw samples, not that EMA. `mainToMainMs = arrivalTime − tCapture` is capture-to-game only when capture metadata exists; otherwise label it callback-receipt-to-game. Never call it true motion-to-photon latency.
- On `error.fatal` the client stops and emits `tracking:fatal` so BOOT/PLAYING can show the error card.
- `stop()` cancels rVFC, invalidates asynchronous capture work and returns borrowed buffers. Full disposal additionally stops media tracks, clears `video.srcObject`, closes MediaPipe tasks/canvases and terminates the worker. Retrying creates a fresh generation token; a late old-generation result cannot revive a stopped session.

## 3. Filtering (`tracking/filters.ts`)

### 3.1 One Euro filter

Per scalar, state `{ xPrev, dxPrev, tPrev }`:

```
alpha(cutoff, dt) = 1 / (1 + (1 / (2π · cutoff · dt)))
filter(x, t):
  dt   = max(t − tPrev, 1e-3)
  dx   = (x − xPrev) / dt
  dxF  = lerp(dxPrev, dx, alpha(ONE_EURO_D_CUTOFF, dt))
  cut  = ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA · |dxF|
  xF   = lerp(xPrev, x, alpha(cut, dt))
  store xF, dxF, t; return xF
```

- `t` is `tCapture` in seconds. Using capture time (not arrival time) keeps `dt` honest when frames are dropped.
- Filter sets: `handLm[hand]` (21 × 3 → 63 filters each), `poseLm` (33 × 2 — only x,y; `z`/visibility are passed through), and the shoulder-midpoint used by body metrics has its own pair with a lower `BODY_FILTER_BETA` because lean should be calm.
- Units: filters run in mirrored image space (0..1). `ONE_EURO_BETA` was tuned for that unit; do not filter in play-plane metres.
- Reset: when a hand/pose was absent for `HAND_RESET_FRAMES` samples, its filters are re-seeded with the new raw value (no smoothing across a gap).
- `worldLandmarks` are not filtered (used only for angles, which are then hysteresis-gated in [06]).

### 3.2 Hand identity

MediaPipe returns up to two hands with independent handedness labels that can flip frame to frame (especially when hands cross or one is edge-on). The identity tracker keeps two logical slots `left`/`right` and assigns detected hands to slots as follows:

1. On initialization, use the verified handedness adapter when two confident labels differ. If both labels are the same and no previous slots exist, keep the uncertain slot absent and coach uncrossed visible hands; screen-side guessing is not reliable anatomical identity.
2. With recent slots, compare both possible 2×2 assignments by total position-continuity distance, using handedness confidence to resolve an exact tie. Do this even when labels differ: trusting every differing pair would still swap both slots when both labels flip. Keep the assignment deterministic in replay.
3. With one hand, use the labelled recent slot when within `HAND_IDENTITY_MATCH_DIST`; override only when the other recent slot is within `HAND_IDENTITY_OVERRIDE_DIST` and is the clear continuity match. Beyond `HAND_IDENTITY_GRACE_MS`, reinitialize instead of extending an old swing across a gap.
4. A slot missing for `HAND_RESET_FRAMES` samples is marked `present: false`. Identity reassignment clears its filter, velocity, gesture, charge and trail history; uncertain identity never inherits another hand's charged beam.

Rationale: wrong slot assignment makes a trail jump across the screen; position continuity is more reliable than the classifier at close range.

## 4. Presence and tracking-lost

- `handPresent[h]`: slot assigned this frame with `score ≥ TRACK_CONFIDENCE_MIN`.
- `posePresent`: `poseRes.landmarks.length > 0` and mean visibility of landmarks 11, 12 (shoulders) ≥ TRACK_CONFIDENCE_MIN.
- `anyPresent = posePresent || handPresent[0] || handPresent[1]`.
- `lostSince` is set when `anyPresent` becomes false and cleared when true. In `PLAYING`, `now − lostSince > TRACKING_LOST_PAUSE_MS` emits `track:lost`. In `PAUSED`, `posePresent` continuous for `TRACK_REGAIN_MS` emits `track:regained` ([04 §Transitions](04-state-machine.md#transitions)).
- `TrackingFrame` arrival itself stalling (no results for `TRACK_STALL_MS` while the worker is `ready`) is a separate fault: emit `tracking:stalled`, which PLAYING treats like `track:lost`.

## Wave detector

Used only in `CALIBRATION` step 2 ([04](04-state-machine.md#calibration)). Runs per hand on the filtered wrist landmark (index 0) `u′`.

State per hand: `dir ∈ {−1, 0, +1}`, `extremeU`, `prevU`, and a fixed timestamp ring with capacity `WAVE_REVERSALS`.

1. On each new sample with the hand present, compute `du = u′ − prevU`; update `prevU`. A change below `WAVE_DEAD_BAND` cannot establish an initial direction.
2. When `dir === 0`, establish it from a meaningful `du` and seed `extremeU`.
3. While moving in the current direction, update `extremeU` to the furthest observed x. Count a reversal only after the hand travels `WAVE_MIN_AMPLITUDE` away from that extreme in the opposite direction; append the timestamp into the fixed ring, flip `dir`, and seed the new extreme. Tiny sign changes around a peak do not count.
4. A wave completes when the ring holds `WAVE_REVERSALS` reversals and the oldest is within `WAVE_WINDOW_MS` of the newest.
5. Hand loss, pause, identity reassignment or over-age input resets the state. No per-sample object push/filter allocation is needed.

Either hand satisfying the rule completes the step. The UI shows a progress ring from the recent valid reversal count divided by `WAVE_REVERSALS`.

## 5. Body metrics (`tracking/body.ts`) → `BodyState`

Pose landmark indices used: 0 nose, 11 anatomical left shoulder, 12 anatomical right shoulder, 23 left hip, 24 right hip. Reflection changes coordinates, not landmark identity. Screen-side labels must never replace anatomical labels when the player turns or crosses limbs.

Per frame with `posePresent`:

| Field | Formula |
| --- | --- |
| `shoulderWidthNorm` | `hypot(u′₁₁ − u′₁₂, (v₁₁ − v₁₂) · 9/16)` — y scaled to width units so the metric is isotropic |
| `centerX` | `(u′₁₁ + u′₁₂) / 2` (filtered with the calm filter pair) |
| `leanX` | `clamp((centerX − calib.centerX) / calib.shoulderWidthNorm, −2, 2)`; `0` before calibration |
| `lean` | hysteresis: enter `'left'` when `leanX ≤ −LEAN_ON`, back to `'center'` when `leanX ≥ −LEAN_OFF`; mirror for `'right'`. Negative `leanX` = player moved to screen-left = player's left. |
| `tilt` | `atan2(v₁₂ − v₁₁, u′₁₂ − u′₁₁)` in degrees, sign chosen so positive = player's right shoulder lower |
| `torsoSpeed` | `|Δ(centerX, centerY)| · physicalScale / dt` in m/s, where `physicalScale = calib.physicalScale` and `centerY` uses the same 9/16 scaling; EMA `BODY_SPEED_EMA` |
| `duck` [STRETCH] | `v₀ − calib.headY ≥ DUCK_DROP` (nose dropped by that fraction of frame height), with hysteresis of `DUCK_HYSTERESIS` |
| `present` | `posePresent` |
| `tCapture` | from the frame |

Lean uses translation (`leanX`), not tilt; `tilt` is exposed for the renderer (skeleton lean) and as a secondary signal: if `|tilt| ≥ LEAN_TILT_ASSIST_DEG` and `|leanX| ≥ LEAN_OFF`, the lean is accepted even if `LEAN_ON` was not reached. This rewards an exaggerated lean without demanding a full side-step.

`BodyCalibration` capture ([04 §CALIBRATION](04-state-machine.md#calibration)): average `centerX`, `shoulderWidthNorm`, `v₀` over the final `CALIB_SAMPLE_MS` of calibration step 1; `physicalScale = CALIB_ASSUMED_SHOULDER_M / shoulderWidthNorm`.

## 6. Latency and diagnostics

The debug overlay (dev builds, `D` key) shows, updated at `DEBUG_TEXT_HZ`:

| Metric | Source |
| --- | --- |
| Camera fps | `rVFC` callbacks per second |
| Tracking Hz | results per second |
| Inference ms | `frame.inferenceMs` (median of `TRACK_STATS_WINDOW` samples) |
| Capture→game ms | `arrival − tCapture` (median) — the number that matters |
| Dropped / allocs | from `result` |
| Delegate | GPU/CPU |
| Hands | slot, handedness, score, gesture (from [06]) |
| Lean | `leanX`, `lean`, `tilt` |

Plus: raw landmarks drawn over a 25 %-opacity camera feed, the mask as a red overlay, and the One Euro output as a second colour so smoothing lag is visible.

Measure motion-to-photon with an external high-frame-rate recording that includes the moving hand or a flashing reference and its displayed response in the same shot. Record frame rate, sample count and uncertainty, then report median/p95. A photo comparing an unrelated phone stopwatch to a performance timestamp does not establish a shared clock or end-to-end latency. Store raw measurements with the benchmark evidence ([16](16-performance-budget.md)); use perceived rhythmic bias, not the entire tracking delay, to tune `INPUT_OFFSET_DEFAULT_MS` ([15](15-audio-playback-sync.md)).

## 7. Failure modes

| Failure | Detection | Response |
| --- | --- | --- |
| Camera permission denied | `NotAllowedError` | BOOT error card with retry |
| Camera in use by another app | `NotReadableError` | Card: "Close other apps using the camera" |
| Worker init fails (WASM/model 404) | `error.where === 'init'` | Card: run `npm run models` |
| GPU delegate unavailable | create throws | CPU retry + warning badge |
| Worker stalls | no result for `TRACK_STALL_MS` | `tracking:stalled` → pause; after `TRACK_RECOVERY_MS` terminate and recreate worker once |
| Two people in frame | `numPoses: 1` picks the most prominent; hands may belong to either | Calibration coaching text: "One player in frame"; hand identity tracker keeps continuity |
| Backlit player / dark room | mean mask confidence < 0.3 across the body region | Coaching text in CALIBRATION: "Face the light, avoid windows behind you" |
| Tab hidden | `visibilitychange` | `pause:request`; rVFC stops naturally |

## 8. Acceptance criteria

- [ ] With the dev server and a 720p webcam, the debug overlay shows Tracking Hz ≥ 24 and Capture→game median ≤ 110 ms on the demo laptop (GPU delegate).
- [ ] Main-thread cost of capture + `take()` + filtering ≤ 2.5 ms per frame (Performance panel, 10-second trace).
- [ ] Moving the real right hand to the player's right increases `u′` and reports `handedness: 'right'`; the mask shows the arm on the same side.
- [ ] Crossing hands and uncrossing them does not swap trail colours (identity tracker).
- [ ] Covering the camera for 2 s in `PLAYING` pauses the game; uncovering can resume with the countdown only for an automatic tracking-loss pause. A user pause remains paused.
- [ ] A one-second wave at normal speed completes calibration step 2; a slow single pass does not.
- [ ] Stepping 30 cm to the side yields `lean` change within 150 ms; standing still for 10 s produces no spurious lean.
- [ ] Unit tests: One Euro step response, mirroring of a fixture frame, identity tracker on a label-flip fixture, wave detector on a recorded wave and on a recorded non-wave; async capture overlap, error acknowledgement, detached-buffer reuse and stale-generation rejection.
- [ ] Thirty-minute live soak: no growing result queue, app buffer allocations or retained bitmaps after warm-up; camera indicator turns off on disposal. Record heap/GPU observations and their measurement limits.

## Constants required

All executable tracking thresholds, including identity distance, confidence, stall/recovery and wave dead-band, belong in the [02 constants registry](02-architecture.md#constants) and `core/constants.ts`. The defaults are centralized there; they are not module-local exceptions. P0 implements the exports, and every tuning change updates the registry and evidence together.
