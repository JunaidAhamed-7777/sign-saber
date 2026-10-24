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
2. Read the actual settings via `stream.getVideoTracks()[0].getSettings()`; log `width × height @ fps`. If the delivered frame rate is < 24, log a warning (the pipeline still works; `TRACK_TARGET_HZ` is a cap, not a floor).
3. If `getUserMedia` rejects with `NotAllowedError` → `boot:error` with the camera-denied card ([04 §BOOT](04-state-machine.md#boot)). `NotFoundError` → "No camera found". `OverconstrainedError` → retry once with no constraints at all.
4. The raw feed MUST never be attached to a visible element in production builds. The debug overlay (`D` key, dev only) MAY show it at 25 % opacity.

### 1.2 Frame callback and centre-crop

Frames are pulled with `video.requestVideoFrameCallback((now, meta) => …)`, not `requestAnimationFrame`, so capture runs at the camera rate regardless of render rate.

- `tCapture = meta.captureTime ?? meta.receiveTime ?? now` — these are in the `performance.now()` domain. `captureTime` is the best estimate of when the sensor exposed the frame; use it when present.
- Rate limit: if `now − lastSentAt < 1000 / TRACK_TARGET_HZ − 2` skip the frame.
- Back-pressure: if the worker has not acknowledged the previous frame (`inFlight === true`), skip. The newest frame always wins; nothing is queued (keep-latest policy).
- Centre-crop to 16:9: given delivered `vw × vh`, if `vw / vh > 16/9` crop width to `vh · 16/9`, else crop height to `vw · 9/16`, centred. The crop rectangle `(sx, sy, sw, sh)` is passed to `createImageBitmap(video, sx, sy, sw, sh, { resizeWidth: INFER_W, resizeHeight: INFER_H, resizeQuality: 'low' })`.
- The resulting `ImageBitmap` is posted to the worker with `[bitmap]` as the transfer list. The main thread never calls `bitmap.close()`; the worker does after inference.

Cost target on the main thread: ≤ 1.5 ms per captured frame (`createImageBitmap` is GPU-backed in Chrome; measure with `performance.mark`).

## 2. The tracking worker (`tracking/tracking.worker.ts`)

Created as a module worker so Vite bundles it:

```ts
new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
```

### 2.1 Initialisation

```ts
const fileset = await FilesetResolver.forVisionTasks('/models/wasm');   // same-origin, bundled (ADR-013)
const glCanvas = new OffscreenCanvas(1, 1);                              // shared by both tasks
hands = await HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  canvas: glCanvas,
});
pose = await PoseLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: true,
  canvas: glCanvas,
});
```

- If GPU creation throws, retry once with `delegate: 'CPU'` and report `delegate: 'CPU'` in the `ready` message so the UI can warn ("Tracking is running on CPU — expect lower frame rate").
- A second `OffscreenCanvas(POSE_W, POSE_H)` with a `2d` context (`{ alpha: false, willReadFrequently: false }`) is kept for the pose downscale.

### 2.2 Per-frame processing

```
on 'frame' { bitmap, seq, tCapture }:
  t0 = performance.now()
  ts = max(tCapture, lastTs + 1)            // detectForVideo REQUIRES strictly increasing timestamps
  lastTs = ts
  handRes = hands.detectForVideo(bitmap, ts)
  poseCtx.drawImage(bitmap, 0, 0, POSE_W, POSE_H)
  poseRes = pose.detectForVideo(poseCanvas, ts)
  bitmap.close()
  pack(handRes, poseRes) into ring[slot]     // see 2.4
  post 'result' with transfer list
  slot = 1 - slot
```

Rules:

1. `detectForVideo` timestamps MUST be strictly monotonic per task. The `max(…, lastTs + 1)` guard handles clock jitter; both tasks share `ts`.
2. Both tasks run on the same frame so hands, pose and mask are mutually consistent in time.
3. The segmentation `MPMask` is only valid until the next `detectForVideo` call on that task and its GPU texture belongs to MediaPipe's context. The worker MUST call `mask.getAsUint8Array()` immediately (one readback, ≈ 1–2 ms at `MASK_W × MASK_H`) and copy into our own buffer before anything else. Never post an `MPMask`.
4. `POSE_W × POSE_H` equals `MASK_W × MASK_H` by construction (the mask is returned at input resolution). If MediaPipe ever returns a different size, the worker resamples nearest-neighbour into `MASK_W × MASK_H`; the main thread never sees a variable size.
5. If a frame arrives while processing (should not happen thanks to main-thread back-pressure) it is closed and dropped; a `dropped` counter is included in the next result.

### 2.3 Mirroring, done exactly once

The player must see a mirror ([02 §Mirroring](02-architecture.md#mirroring)). In the worker, after inference:

- Every normalized landmark: `u′ = 1 − u`; `v`, `z`, `visibility` unchanged.
- World landmarks (`worldLandmarks`): `x′ = −x`; `y`, `z` unchanged. (These are only used for finger angles and skeleton depth; flipping x keeps chirality consistent with the mirrored image.)
- Handedness: MediaPipe reports handedness **as seen in the image**, i.e. the label of the hand assuming the image is unmirrored. After our flip the player's right hand appears on the right of the screen; MediaPipe's `'Left'` label on a selfie camera corresponds to the player's **right** hand. Therefore: `handedness = mp.categoryName === 'Left' ? 'right' : 'left'`. Store `score = category.score`.
- Mask flip: write row `r` of the source into row `r` of the destination with columns reversed: `dst[r·W + (W−1−c)] = src[r·W + c]`. Done during the copy out of `getAsUint8Array()` (the source is `Float32Array` 0..1 for the pose mask → scale by 255 and round).

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

Buffers are transferred to the main thread with the result (zero-copy, so the worker loses them), and the main thread transfers them **back** with the next `frame` message once it has consumed them (`recycle` field). With two slots the worker is never blocked waiting for a buffer: while slot A is on the main thread, slot B is being written. If a recycled buffer has not come back when needed (main thread stalled), the worker allocates a fresh one (counts `allocs` for the debug overlay).

### 2.5 Message protocol

```ts
// main → worker
type ToWorker =
  | { type: 'init'; wasmBase: string; handModel: string; poseModel: string }
  | { type: 'frame'; seq: number; tCapture: number; bitmap: ImageBitmap; recycle?: RecycledBuffers }
  | { type: 'setOptions'; trackHz?: number }      // reserved for quality tiers
  | { type: 'dispose' };

// worker → main
type FromWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; initMs: number }
  | { type: 'result'; frame: TrackingFrame; dropped: number; allocs: number }
  | { type: 'error'; where: 'init' | 'frame'; message: string; fatal: boolean };

interface RecycledBuffers { handLm: Float32Array[]; handWorld: Float32Array[]; poseLm?: Float32Array; poseWorld?: Float32Array; mask?: Uint8Array }
```

Transfer lists: `frame` → `[bitmap, ...recycled.buffers]`; `result` → every typed array's `.buffer` inside `frame`.

`TrackingFrame.tInferDone = performance.now()` is stamped in the worker immediately before posting. Worker and main share the same `performance.now()` origin for a dedicated worker in Chrome (`timeOrigin` differs, but `performance.now()` in a dedicated worker is relative to the *worker's* `timeOrigin`). To be safe, the main thread computes `clockSkew = tInferDone_received_at_main − frame.tInferDone` on the `ready` handshake (worker echoes a main-provided `performance.now()`), and corrects `tInferDone` on arrival. `tCapture` is never touched: it originated on the main thread.

### 2.6 Worker client (`tracking/workerClient.ts`)

```ts
class TrackingClient {
  readonly latest: TrackingFrame | null;      // newest result; replaced wholesale
  readonly stats: { hz: number; inferenceMs: number; mainToMainMs: number; dropped: number; delegate: string };
  start(video: HTMLVideoElement): void;        // begins rVFC loop
  stop(): void;
  take(): TrackingFrame | null;                // returns latest and marks it consumed (recycle on next send)
}
```

- `take()` is called once per render frame in loop step 2 ([02 §Frame loop](02-architecture.md#frame-loop)). If no new frame has arrived it returns `null`.
- `hz` is an EMA over the last 30 results; `mainToMainMs = arrivalTime − tCapture` (true tracking latency as experienced by the game).
- On `error.fatal` the client stops and emits `tracking:fatal` so BOOT/PLAYING can show the error card.

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
- Filter sets: `handLm[hand]` (21 × 3 → 63 filters each), `poseLm` (33 × 2 — only x,y; `z`/visibility are passed through), and the shoulder-midpoint used by body metrics has its own pair with a lower `beta` (0.02) because lean should be calm.
- Units: filters run in mirrored image space (0..1). `ONE_EURO_BETA` was tuned for that unit; do not filter in play-plane metres.
- Reset: when a hand/pose was absent for ≥ 2 frames, its filters are re-seeded with the new raw value (no smoothing across a gap).
- `worldLandmarks` are not filtered (used only for angles, which are then hysteresis-gated in [06]).

### 3.2 Hand identity

MediaPipe returns up to two hands with independent handedness labels that can flip frame to frame (especially when hands cross or one is edge-on). The identity tracker keeps two logical slots `left`/`right` and assigns detected hands to slots as follows:

1. If two hands are detected and labels differ → assign by label.
2. If two hands have the same label → assign by nearest previous position (Hungarian on 2×2 = just compare the two assignments' total distance); the hand that got the "wrong" label is relabelled.
3. If one hand is detected → if its label matches a slot that was present within the last 300 ms and lies within 0.15 (image units) of that slot's last position, use that slot; else if the *other* slot is closer than 0.08 and the labelled slot is far, override the label; else trust the label.
4. A slot missing for ≥ 2 frames is marked `present: false` (its `HandCursor.present` follows).

Rationale: wrong slot assignment makes a trail jump across the screen; position continuity is more reliable than the classifier at close range.

## 4. Presence and tracking-lost

- `handPresent[h]`: slot assigned this frame with `score ≥ 0.5`.
- `posePresent`: `poseRes.landmarks.length > 0` and mean visibility of landmarks 11, 12 (shoulders) ≥ 0.5.
- `anyPresent = posePresent || handPresent[0] || handPresent[1]`.
- `lostSince` is set when `anyPresent` becomes false and cleared when true. In `PLAYING`, `now − lostSince > TRACKING_LOST_PAUSE_MS` emits `track:lost`. In `PAUSED`, `posePresent` continuous for ≥ 500 ms emits `track:regained` ([04 §Transitions](04-state-machine.md#transitions)).
- `TrackingFrame` arrival itself stalling (no results for 1000 ms while the worker is `ready`) is a separate fault: emit `tracking:stalled`, which PLAYING treats like `track:lost`.

## Wave detector

Used only in `CALIBRATION` step 2 ([04](04-state-machine.md#calibration)). Runs per hand on the filtered wrist landmark (index 0) `u′`.

State per hand: `dir ∈ {−1, 0, +1}`, `extremeU`, `reversals: { t, amplitude }[]`.

1. On each frame with the hand present: `du = u′ − prevU`. Ignore `|du| < 0.002` (dead-band).
2. If `sign(du) !== dir` and `dir !== 0`: a reversal candidate. `amplitude = |u′ − extremeU|`. If `amplitude ≥ WAVE_MIN_AMPLITUDE` push `{ t: tCapture, amplitude }`, set `extremeU = u′`. Set `dir = sign(du)`.
3. If `dir === 0` set `dir = sign(du)`, `extremeU = u′`.
4. Drop reversals older than `tCapture − WAVE_WINDOW_MS`.
5. `waved = reversals.length ≥ WAVE_REVERSALS`.
6. On hand loss, reset the state (a wave must be continuous).

Either hand satisfying `waved` completes the step. The UI shows a progress ring filling by `reversals.length / WAVE_REVERSALS`.

## 5. Body metrics (`tracking/body.ts`) → `BodyState`

Pose landmark indices used: 0 nose, 11 left shoulder, 12 right shoulder, 23 left hip, 24 right hip (MediaPipe labels; after mirroring "left" landmarks are on the screen-left side, which is the player's left).

Per frame with `posePresent`:

| Field | Formula |
| --- | --- |
| `shoulderWidthNorm` | `hypot(u′₁₁ − u′₁₂, (v₁₁ − v₁₂) · 9/16)` — y scaled to width units so the metric is isotropic |
| `centerX` | `(u′₁₁ + u′₁₂) / 2` (filtered with the calm filter pair) |
| `leanX` | `clamp((centerX − calib.centerX) / calib.shoulderWidthNorm, −2, 2)`; `0` before calibration |
| `lean` | hysteresis: enter `'left'` when `leanX ≤ −LEAN_ON`, back to `'center'` when `leanX ≥ −LEAN_OFF`; mirror for `'right'`. Negative `leanX` = player moved to screen-left = player's left. |
| `tilt` | `atan2(v₁₂ − v₁₁, u′₁₂ − u′₁₁)` in degrees, sign chosen so positive = player's right shoulder lower |
| `torsoSpeed` | `|Δ(centerX, centerY)| · physicalScale / dt` in m/s, where `physicalScale = calib.physicalScale` and `centerY` uses the same 9/16 scaling; EMA 0.5 |
| `duck` [STRETCH] | `v₀ − calib.headY ≥ DUCK_DROP` (nose dropped by that fraction of frame height), with hysteresis of 0.03 |
| `present` | `posePresent` |
| `tCapture` | from the frame |

Lean uses translation (`leanX`), not tilt; `tilt` is exposed for the renderer (skeleton lean) and as a secondary signal: if `|tilt| ≥ 15°` and `|leanX| ≥ LEAN_OFF`, the lean is accepted even if `LEAN_ON` was not reached. This rewards an exaggerated lean without demanding a full side-step.

`BodyCalibration` capture ([04 §CALIBRATION](04-state-machine.md#calibration)): average `centerX`, `shoulderWidthNorm`, `v₀` over the final 500 ms of calibration step 1; `physicalScale = 0.40 / shoulderWidthNorm`.

## 6. Latency and diagnostics

The debug overlay (dev builds, `D` key) shows, updated at 4 Hz:

| Metric | Source |
| --- | --- |
| Camera fps | `rVFC` callbacks per second |
| Tracking Hz | results per second |
| Inference ms | `frame.inferenceMs` (median of last 30) |
| Capture→game ms | `arrival − tCapture` (median) — the number that matters |
| Dropped / allocs | from `result` |
| Delegate | GPU/CPU |
| Hands | slot, handedness, score, gesture (from [06]) |
| Lean | `leanX`, `lean`, `tilt` |

Plus: raw landmarks drawn over a 25 %-opacity camera feed, the mask as a red overlay, and the One Euro output as a second colour so smoothing lag is visible.

Measuring absolute motion-to-photon: point the webcam at a phone stopwatch next to the screen showing the debug overlay and photograph both; the difference between the stopwatch time captured in-frame and the overlay's rendered time is the end-to-end latency. Do this once on the demo laptop and record the value in `CHANGELOG.md`; it informs `INPUT_OFFSET_DEFAULT_MS` ([15](15-audio-playback-sync.md)).

## 7. Failure modes

| Failure | Detection | Response |
| --- | --- | --- |
| Camera permission denied | `NotAllowedError` | BOOT error card with retry |
| Camera in use by another app | `NotReadableError` | Card: "Close other apps using the camera" |
| Worker init fails (WASM/model 404) | `error.where === 'init'` | Card: run `npm run models` |
| GPU delegate unavailable | create throws | CPU retry + warning badge |
| Worker stalls | no result 1000 ms | `tracking:stalled` → pause; after 5 s terminate and recreate worker once |
| Two people in frame | `numPoses: 1` picks the most prominent; hands may belong to either | Calibration coaching text: "One player in frame"; hand identity tracker keeps continuity |
| Backlit player / dark room | mean mask confidence < 0.3 across the body region | Coaching text in CALIBRATION: "Face the light, avoid windows behind you" |
| Tab hidden | `visibilitychange` | `pause:request`; rVFC stops naturally |

## 8. Acceptance criteria

- [ ] With the dev server and a 720p webcam, the debug overlay shows Tracking Hz ≥ 24 and Capture→game median ≤ 110 ms on the demo laptop (GPU delegate).
- [ ] Main-thread cost of capture + `take()` + filtering ≤ 2.5 ms per frame (Performance panel, 10-second trace).
- [ ] Moving the real right hand to the player's right increases `u′` and reports `handedness: 'right'`; the mask shows the arm on the same side.
- [ ] Crossing hands and uncrossing them does not swap trail colours (identity tracker).
- [ ] Covering the camera for 2 s in `PLAYING` pauses the game; uncovering resumes with the countdown.
- [ ] A one-second wave at normal speed completes calibration step 2; a slow single pass does not.
- [ ] Stepping 30 cm to the side yields `lean` change within 150 ms; standing still for 10 s produces no spurious lean.
- [ ] Unit tests: One Euro step response, mirroring of a fixture frame, identity tracker on a label-flip fixture, wave detector on a recorded wave and on a recorded non-wave.

## Constants required

None beyond the [02 constants table](02-architecture.md#constants). Tuning values that are local to this doc and not expected to be shared (dead-band 0.002, identity distance 0.15 / 0.08, shoulder visibility 0.5, stall 1000 ms, tilt assist 15°) MAY live as module-level constants in `tracking/`.
