# 03 — Architecture Decision Records

Each record states a planned decision, its alternatives and the consequence we accept. These choices are not performance results. Revisit a decision when a capability spike, held-out evaluation or reproducible profile contradicts its premise; record the evidence and update affected contracts together. The [roadmap](../ROADMAP.md) replaces the inherited event timetable. [21](21-risks-and-fallbacks.md) defines fallbacks.

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

**Why.** An imperative loop makes the per-frame order ([02 §Frame loop](02-architecture.md#frame-loop)) explicit and easy to instrument. This project chooses direct control of pooling and updates; it does not claim that react-three-fiber is inherently slow. DOM text supports accessible, crisp menu/HUD content without building a second text-input system in WebGL.

**Consequences.** Two render trees (DOM + WebGL) need a shared store (Zustand) for display values; we throttle text updates to ≤ 20 Hz.

---

## ADR-003 — MediaPipe Tasks Vision: `HandLandmarker` + `PoseLandmarker` (with segmentation masks)

**Decision.** Use `HandLandmarker` for two hands and `PoseLandmarker` lite with `outputSegmentationMasks: true` for body/lean and the silhouette mask. Start with the capture/inference dimensions in [05](05-tracking-pipeline.md); quality tiers may decimate pose/mask work, with actual cadences recorded. The worker GPU delegate must pass the P0 capability spike; it is not assumed to work on every device.

**Alternatives.**
- `HolisticLandmarker` (one model, pose + hands + face): heavier, face landmarks wasted, hand quality lower than the dedicated model, no mask.
- Separate `ImageSegmenter` (selfie model): another model, inference call and mask pipeline. Any quality/cost improvement must be measured on our inputs.
- `GestureRecognizer`: canned `Open_Palm` / `Closed_Fist` / `Pointing_Up` do not directly define our screen-targeting interaction. A custom recognizer is possible, but introduces another training/evaluation choice; no speed ranking is asserted without measurement.
- TensorFlow.js hand-pose + BodyPix: older, slower, two runtimes.

**Why.** Dedicated hand landmarks support an inspectable geometric classifier; pose supplies lean, 2.5D depth cues and optional segmentation in one task. Segmentation still has compute/copy cost and explicit `MPMask` lifetime requirements. Check the installed locked typings and [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) during P0; API shape alone is not evidence that our worker integration runs.

**Consequences.** Low-resolution edges need the measured threshold/edge treatment in [10](10-rendering-silhouette.md). A labelled skeleton keeps input usable when masks fail. Evaluate a separate segmenter only after proving its quality and budget; never silently add inference cost to the release workload.

---

## ADR-004 — Inference runs in a Web Worker; frames are transferred as `ImageBitmap`

**Decision.** All MediaPipe work runs in a dedicated worker that owns an `OffscreenCanvas` for the GPU delegate. The main thread captures frames with `video.requestVideoFrameCallback`, creates a resized `ImageBitmap`, and transfers it. Results are posted back as transferable typed arrays ([02 §TrackingFrame](02-architecture.md#tracking-worker--main-trackingframe)).

**Alternatives.** Inference on the main thread (simplest); `MediaStreamTrackProcessor` to read `VideoFrame`s directly in the worker (Chrome-only, zero main-thread copy); rendering Three.js in the worker instead.

**Why.** [`detectForVideo` is synchronous](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js); inference on the render thread can consume its budget. A worker makes the two workloads independently schedulable, but does not eliminate GPU contention or transfer cost. Measure capability, frame creation, task duration and result freshness separately. Consider `MediaStreamTrackProcessor` only if profiling justifies the additional compatibility path.

**Consequences.** Permit one frame in flight and skip capture opportunities while busy; no growing frame queue. Normalize worker time origins into the main performance domain, release transferred resources and measure end-to-end tracking age. No fixed extra-frame latency is promised. See [02 §Latency model](02-architecture.md#latency-model).

---

## ADR-005 — Geometric gesture classifier on landmarks, with hysteresis

**Decision.** Classify Open / Fist / Point from finger PIP angles and tip-to-wrist distances normalised by palm size ([06](06-gesture-recognition.md)), confirmed over `GESTURE_CONFIRM_FRAMES`.

**Alternatives.** MediaPipe `GestureRecognizer`; a small trained MLP on landmarks; template matching.

**Why.** Three deliberately distinct classes are a practical starting point for deterministic, inspectable rules and fixture tests. Pointing toward the camera and occluded/edge-on hands remain difficult; `worldLandmarks` do not remove that ambiguity. Held-out and live per-class error rates determine whether the rules are good enough.

**Consequences.** Edge cases (hand edge-on to camera) are handled by holding the last confident gesture up to `GESTURE_DROP_FRAMES`, not by a smarter model.

---

## ADR-006 — Contact-based hits with timing judgement derived from note depth

**Decision.** Score a unique captured contact using `heardSong(tCapture) + inputOffsetMs - note.t`, bucketed into Perfect/Great/Good. Contact is tested against the note's capture-time geometry with bounded swept input, then one terminal outcome is emitted. Late samples/miss finalization, deterministic arbitration and beam-specific timing are defined in [07](07-hit-detection-and-scoring.md). Render-predicted positions never create score.

**Alternatives.** Pure timing (press-like: any hand movement in the cell at the right time); pure geometry (block must physically overlap the hand at z = 0, which is a 25 ms window at 24 m/s).

**Why.** Contact gives a clear spatial action while capture-time judgement avoids penalizing worker delivery delay twice. The geometric hit zone and timing window must agree; a forgiving window cannot rescue a contact test that already removed the note. No claim about another game's exact implementation is needed.

---

## ADR-007 — Own DSP beatmap generator (spectral flux + DP beat tracking) in a worker

**Decision.** Implement onset detection (band-wise spectral flux, adaptive peak picking), tempo estimation (autocorrelation with log-Gaussian prior), beat tracking (Ellis 2007 dynamic programming), grid snapping, section/energy analysis and note assignment in TypeScript ([08](08-beatmap-generation.md)). Runs in a worker; results cached in IndexedDB.

**Alternatives.** Essentia.js (WASM port of Essentia: `RhythmExtractor2013`, `OnsetDetection`) — robust and battle-tested, but a multi-megabyte WASM, an awkward vector API, and no control over the "only valid beats" filtering. Meyda — features only, no beat tracking. Server-side Python (librosa/madmom) — needs a backend and Python at the venue.

**Why.** Explicit stages in [08](08-beatmap-generation.md) expose onset, beat confidence, silence and ergonomic decisions for tests and profiling. A custom implementation is a control/learning tradeoff, not a guarantee of speed or musical quality. Evaluate independently annotated holdout clips rather than asserting a line count or checking only our own grid.

**Consequences.** Tempo-free/rubato material may use a disclosed onset-only mode or be rejected as unsuitable. At the P2 generated-song gate, failure of the [24](24-benchmark-and-evidence.md) quality criteria triggers a recorded fallback decision. Evaluate alternative DSP on the same holdout corpus, including package/algorithm licenses and browser/worker costs, before adding it; an unintegrated library is not a ready fallback.

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

**Decision.** The audio output clock is authoritative. Map main performance time to heard song time through `getOutputTimestamp()` when available; use one explicitly labelled latency estimate as the fallback. Keep transport position, output time, capture time and resume/countdown epochs distinct as specified in [15](15-audio-playback-sync.md). The render loop never integrates song time from frame deltas.

**Alternatives.** `performance.now()` with drift correction.

**Why.** Notes must follow the audio, including pauses and output delay. [`getOutputTimestamp()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp) supplies paired context/performance times; adding output latency again would double compensate. Software clock agreement is not a physical latency measurement.

---

## ADR-011 — Zustand for UI state, typed event bus for game events

**Decision.** Game core emits typed events; the renderer subscribes directly; the React layer reads a Zustand store that a thin adapter updates from those events (throttled).

**Alternatives.** Redux; React context; passing props from a game "provider".

**Why.** Minimal boilerplate, selectors avoid re-rendering the whole HUD on every score change, and the game core stays framework-free and testable.

---

## ADR-012 — YouTube via a local companion service; MP3 upload is the primary path

**Decision.** An optional local Node service may wrap `yt-dlp` for rights-cleared content ([23](23-youtube-companion-service.md)). It is `[POLISH]`, currently an empty entry point, and must not block boot or play. Supported local-file upload is the primary new-song path; two attributed bundled tracks with validated maps are the demo path.

**Alternatives.** Direct browser extraction depends on unsupported/CORS-restricted service internals; third-party conversion services introduce availability, rights and data-handling dependencies. Neither belongs on the core path.

**Why.** Honest about what the browser can do; keeps the demo independent of network and of YouTube's whims.

**Consequences.** YouTube is demoed only if the venue network allows it; the pitch leads with upload.

---

## ADR-013 — Everything the demo needs is bundled and works offline

**Decision.** Ship model/WASM, fonts, geometry, SFX and demo tracks through local asset paths with no runtime CDN dependency. P0 adds fixed versions, checksums and a license manifest; the current downloader's `latest` URLs are not a reproducible model lock. P5 proves the prepared locally served production build with external network disabled.

**Why.** Venue Wi-Fi is the most common hackathon demo killer. BOOT must succeed with the network cable unplugged.

---

## ADR-014 — Quality tiers chosen at boot, not a settings menu

**Decision.** Choose `high` / `medium` / `low` using capability checks and a representative tracking/render workload, then downgrade with hysteresis as in [16 §Quality tiers](16-performance-budget.md#quality-tiers). Record all changes. Comparative benchmarks fix the tier; automatic selection is evaluated separately. Comfortable scene intensity/reduced motion remains an accessible user choice in [14](14-ui-ux.md).

**Why.** The default should work without technical tuning. Refresh-limited rAF intervals from an empty scene cannot distinguish GPU headroom; quality selection must reflect the integrated workload. The user must still be able to reduce uncomfortable motion/effects.

---

## ADR-015 — Reproducible evidence is part of the product

**Decision.** Build bounded telemetry and replay seams early; keep logic replay, render stress and live-camera evidence separate. Use fixed inputs/seeds, full provenance, percentiles, repetitions and raw artifacts from [24](24-benchmark-and-evidence.md). Publish failures and label every unmeasured target.

**Alternatives.** A single FPS counter, a best-case recording, ad hoc manual performance impressions.

**Why.** Responsiveness includes input freshness and musical/playability quality, not only drawing speed. Repeatable experiments make regressions actionable and judge-facing claims defensible.

**Consequences.** Instrumentation has a measured budget; private inputs/recordings stay private. No benchmark harness or result is claimed before it exists. GPU screenshot hashes are not cross-driver determinism tests.

---

## ADR-016 — Gate the build by capability instead of an inherited timetable

**Decision.** Follow P0–P5 in [ROADMAP.md](../ROADMAP.md): executable foundations, first playable, complete core, signature spectacle, measured optimization and release proof. Keep the current paths as useful starting points without permanent folder ownership.

**Alternatives.** The previous fixed overnight schedule, parallel feature work before a playable spine, cosmetic repo restructuring.

**Why.** The actual event constraints are unknown. A live slash and correct clocks reduce more risk than optional assets or a network companion. Each gate produces reviewable behavior and evidence.

**Consequences.** Commit small coherent milestones frequently. `[POLISH]` follows P2; `[STRETCH]` follows P4. If the actual release scope changes, update the vision, roadmap, README and demo together.
