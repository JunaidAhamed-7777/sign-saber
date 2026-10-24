# 03 — Architecture Decision Records

Each record states the decision, the alternatives that were seriously considered, and the consequence we accept. Decisions are final for the hackathon unless the risk register ([21](21-risks-and-fallbacks.md)) triggers the named fallback. Re-litigating a decision at 3 AM is how hackathons are lost.

---

## ADR-001 — Web platform, single-page app, no backend for gameplay

**Decision.** Ship as a static web app (Vite build) running entirely in the browser. The only server component is the optional YouTube companion ([ADR-012](#adr-012--youtube-via-a-local-companion-service-mp3-upload-is-the-primary-path)).

**Alternatives.** Unity/Unreal with a native webcam plugin; Electron wrapper.

**Why.** Zero install for judges, instant iteration, MediaPipe's best-supported runtime is the browser, WebGL2 + Web Workers + Web Audio cover every need. Native engines would give better physics but cost hours of toolchain setup and break the "walk up and play" pitch.

**Consequences.** Performance budget is tight ([16](16-performance-budget.md)); we accept simplified physics (no inter-fragment collisions).

---

## ADR-002 — Three.js (imperative) for rendering; React only for DOM UI

**Decision.** The 3D scene is plain Three.js driven by our own `requestAnimationFrame` loop. React (19) renders menus, HUD and results as a DOM overlay and never touches the scene graph.

**Alternatives.** react-three-fiber for everything; Babylon.js; PlayCanvas; raw WebGL.

**Why.** An imperative loop makes the per-frame order ([02 §Frame loop](02-architecture.md#frame-loop)) explicit and profilable. R3F's reconciliation adds per-frame overhead and hides allocation. Three.js has the largest body of shader/post-processing examples to borrow from under time pressure. DOM text is sharper and cheaper than in-scene text for the HUD.

**Consequences.** Two render trees (DOM + WebGL) need a shared store (Zustand) for display values; we throttle text updates to ≤ 20 Hz.

---

## ADR-003 — MediaPipe Tasks Vision: `HandLandmarker` + `PoseLandmarker` (with segmentation masks)

**Decision.** Two models per frame: `HandLandmarker` (2 hands, GPU delegate) on a 640×360 frame, and `PoseLandmarker` *lite* with `outputSegmentationMasks: true` on a 320×180 downscale. The pose model supplies both body landmarks (lean) and the person mask (silhouette).

**Alternatives.**
- `HolisticLandmarker` (one model, pose + hands + face): heavier, face landmarks wasted, hand quality lower than the dedicated model, no mask.
- Separate `ImageSegmenter` (selfie model) for the mask: better mask quality, but a third inference call (~5–8 ms) and a third model to load.
- `GestureRecognizer` instead of `HandLandmarker`: gives canned `Open_Palm` / `Closed_Fist` / `Pointing_Up`, but `Pointing_Up` only fires for upward pointing and the classifier is a black box we cannot tune; it also costs more than `HandLandmarker`.
- TensorFlow.js hand-pose + BodyPix: older, slower, two runtimes.

**Why.** Minimum inference for maximum signal: 21-point hands for a fully controllable gesture classifier, 33-point pose for lean and a 2.5D skeleton, and a mask for free. Verified against `@mediapipe/tasks-vision@1.1.1` typings: `PoseLandmarkerOptions.outputSegmentationMasks`, `PoseLandmarkerResult.segmentationMasks: MPMask[]`, `MPMask.getAsUint8Array()`.

**Consequences.** Mask edge quality is good-not-great at 320×180; the silhouette shader compensates with a blur + threshold + edge glow ([10](10-rendering-silhouette.md)). Fallback if the mask looks poor on the demo laptop: enable `ImageSegmenter` (selfie, landscape model) behind a flag.

---

## ADR-004 — Inference runs in a Web Worker; frames are transferred as `ImageBitmap`

**Decision.** All MediaPipe work runs in a dedicated worker that owns an `OffscreenCanvas` for the GPU delegate. The main thread captures frames with `video.requestVideoFrameCallback`, creates a resized `ImageBitmap`, and transfers it. Results are posted back as transferable typed arrays ([02 §TrackingFrame](02-architecture.md#tracking-worker--main-trackingframe)).

**Alternatives.** Inference on the main thread (simplest); `MediaStreamTrackProcessor` to read `VideoFrame`s directly in the worker (Chrome-only, zero main-thread copy); rendering Three.js in the worker instead.

**Why.** A 15–35 ms synchronous `detectForVideo` on the main thread cannot coexist with a 16.6 ms frame budget; the worker makes tracking rate and render rate independent. `ImageBitmap` transfer is supported in every target browser; `MediaStreamTrackProcessor` is kept as an optimisation if profiling shows the `createImageBitmap` cost matters.

**Consequences.** One frame of additional latency is accepted and modelled ([02 §Latency model](02-architecture.md#latency-model)). The worker must drop frames when busy (keep-latest policy).

---

## ADR-005 — Geometric gesture classifier on landmarks, with hysteresis

**Decision.** Classify Open / Fist / Point from finger PIP angles and tip-to-wrist distances normalised by palm size ([06](06-gesture-recognition.md)), confirmed over `GESTURE_CONFIRM_FRAMES`.

**Alternatives.** MediaPipe `GestureRecognizer`; a small trained MLP on landmarks; template matching.

**Why.** Three gestures with large geometric differences do not need learning. A rule-based classifier is deterministic, unit-testable from recorded fixtures, tunable live in the debug overlay, and handles pointing in any direction (toward the camera included, via `worldLandmarks`).

**Consequences.** Edge cases (hand edge-on to camera) are handled by holding the last confident gesture up to `GESTURE_DROP_FRAMES`, not by a smarter model.

---

## ADR-006 — Contact-based hits with timing judgement derived from note depth

**Decision.** A hit is a geometric contact (hand sphere or blade segment vs block OBB in the play plane) while the note is within the timing window; the judgement is `timingError = −z / speed` (equivalently `tCapture − note.t + inputOffset`) bucketed into Perfect/Great/Good ([07](07-hit-detection-and-scoring.md)).

**Alternatives.** Pure timing (press-like: any hand movement in the cell at the right time); pure geometry (block must physically overlap the hand at z = 0, which is a 25 ms window at 24 m/s).

**Why.** Contact keeps the "I physically hit it" feeling; the depth-derived timing window makes it achievable with ~100 ms tracking latency (P3). This is exactly how Beat Saber behaves: the saber contacts a block that is still in front of the player.

---

## ADR-007 — Own DSP beatmap generator (spectral flux + DP beat tracking) in a worker

**Decision.** Implement onset detection (band-wise spectral flux, adaptive peak picking), tempo estimation (autocorrelation with log-Gaussian prior), beat tracking (Ellis 2007 dynamic programming), grid snapping, section/energy analysis and note assignment in TypeScript ([08](08-beatmap-generation.md)). Runs in a worker; results cached in IndexedDB.

**Alternatives.** Essentia.js (WASM port of Essentia: `RhythmExtractor2013`, `OnsetDetection`) — robust and battle-tested, but a multi-megabyte WASM, an awkward vector API, and no control over the "only valid beats" filtering. Meyda — features only, no beat tracking. Server-side Python (librosa/madmom) — needs a backend and Python at the venue.

**Why.** The algorithms are small (< 600 lines total), fully specified in [08](08-beatmap-generation.md), deterministic, testable against clips with known BPM, and tunable. "No random noise" is a product requirement that needs our own thresholds, not a library default.

**Consequences.** Tempo estimation may fail on tempo-free material (ambient, rubato); the generator then falls back to onset-only mapping with a warning badge in Song Select. Essentia.js is the named fallback if our tempo estimate is unreliable on ≥ 2 of the test clips by the H5 checkpoint.

---

## ADR-008 — Real plane-cut slicing for a convex cube; pre-fractured GLB for smashing; no physics engine

**Decision.** Slash: compute the two convex halves of the cube by clipping its 6 faces against the swing plane (Sutherland–Hodgman) and capping the cut ([11](11-rendering-blocks-and-destruction.md)). Smash: swap the cube for a pre-fractured 14-shard mesh made in Blender via Blender MCP ([18](18-blender-mcp-asset-pipeline.md)). All fragments move on closed-form ballistic trajectories with angular velocity; no inter-fragment collision.

**Alternatives.** three-bvh-csg for arbitrary mesh booleans (overkill, slow); Rapier/Cannon for physics (realistic tumbling, but another WASM and a per-frame step; collisions between shards are invisible at 1.4 s lifetime anyway).

**Why.** The cut plane following the exact swing is the signature moment of the game and is cheap for a convex solid. Ballistic motion is a pure function of time → pause-safe and trivially pooled.

---

## ADR-009 — pmndrs `postprocessing` for bloom; selective bloom via emissive-only intensity

**Decision.** Use the `postprocessing` library's `EffectComposer` with `BloomEffect` (mipmap blur, luminance threshold) at `BLOOM_RESOLUTION_SCALE` 0.5, plus `ChromaticAberrationEffect` and `VignetteEffect` driven by music events ([13](13-rendering-environment-camera-postfx.md)).

**Alternatives.** Three.js `UnrealBloomPass` (slower, more passes); hand-rolled Kawase bloom.

**Why.** `postprocessing` merges effects into one shader pass, has a fast mipmap bloom, and is maintained for current Three.js. Selective bloom is achieved by keeping non-glowing surfaces below the luminance threshold rather than a second render pass.

---

## ADR-010 — Audio clock is the master clock

**Decision.** Song time derives from `AudioContext.currentTime` minus the scheduled start; the render loop never accumulates its own song time. Pausing suspends the context.

**Alternatives.** `performance.now()` with drift correction.

**Why.** Web Audio's clock is sample-accurate and monotonic; notes must land on the audio, not on the frame counter.

---

## ADR-011 — Zustand for UI state, typed event bus for game events

**Decision.** Game core emits typed events; the renderer subscribes directly; the React layer reads a Zustand store that a thin adapter updates from those events (throttled).

**Alternatives.** Redux; React context; passing props from a game "provider".

**Why.** Minimal boilerplate, selectors avoid re-rendering the whole HUD on every score change, and the game core stays framework-free and testable.

---

## ADR-012 — YouTube via a local companion service; MP3 upload is the primary path

**Decision.** A tiny Node service (`server/`) wraps `yt-dlp` to resolve a YouTube URL to an audio file served to the client ([23](23-youtube-companion-service.md)). The UI treats it as optional and detects its absence. Audio-file upload is the primary, always-working path; two bundled CC0 tracks with pre-generated maps are the demo path.

**Alternatives.** Client-side YouTube audio extraction (impossible: CORS + DRM-free but obfuscated streams); third-party "yt to mp3" APIs (unreliable, ToS-risky, needs network).

**Why.** Honest about what the browser can do; keeps the demo independent of network and of YouTube's whims.

**Consequences.** YouTube is demoed only if the venue network allows it; the pitch leads with upload.

---

## ADR-013 — Everything the demo needs is bundled and works offline

**Decision.** MediaPipe WASM + `.task` models, fonts, GLBs, SFX and demo tracks live in `app/public/` (models fetched once by `scripts/download-models`). No CDN at runtime.

**Why.** Venue Wi-Fi is the most common hackathon demo killer. BOOT must succeed with the network cable unplugged.

---

## ADR-014 — Quality tiers chosen at boot, not a settings menu

**Decision.** BOOT measures median frame time of the attract scene and picks `high` / `medium` / `low` ([16 §Quality tiers](16-performance-budget.md#quality-tiers)); a debug key cycles tiers. No user-facing graphics menu.

**Why.** Judges never open settings. The frame rate pillar (P5) must hold by default.
