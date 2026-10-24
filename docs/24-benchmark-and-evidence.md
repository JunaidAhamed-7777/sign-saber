# 24 — Benchmark & Evidence Protocol

**Status: proposed protocol; no benchmark results exist yet.** The app and test files are stubs. Targets here are build acceptance gates, not measured claims. [16 — Performance Budget](16-performance-budget.md) assigns subsystem budgets; this document defines reproducible evidence.

The objective is a game that feels immediate, makes music playable, and keeps its visual impact on ordinary hardware. Optimise all three together. A fast renderer with stale hands, a dense map nobody can reach, or a recording that cannot run live does not pass.

## 1. Build the measuring path before the spectacle

Implement switchable input, a monotonic session clock, bounded performance rings and evidence export during P0/P1 in [ROADMAP.md](../ROADMAP.md). Add stress scenes and comparisons when the corresponding features exist; publish the complete evaluation during P4/P5.

The benchmark harness, recorder, replay switches and exports described here are **planned**. `npm run check` exists today and checks the scaffold. `npm run beatmaps` currently fails with a TODO message; its future evaluation option must be implemented before reporting output. A green build containing zero tests does not prove gameplay correctness.

## 2. Keep three evidence lanes separate

1. **Logic replay:** recorded `TrackingFrame` landmarks and capture times drive filters, gestures, collision and scoring. This proves determinism and catches timing regressions. It bypasses the camera and MediaPipe; it cannot establish live latency, segmentation quality or inference throughput.
2. **Render stress:** a fixed map, prerecorded mask sequence or labelled procedural mask, seeded effects, camera path and declared object counts exercise rendering. This permits fair comparisons without identical human movements. It cannot establish live usability.
3. **Live end-to-end:** a real webcam, hands, pose/mask, audio output and person exercise the complete product. Record lighting, distance, actual camera settings, calibration and failures. This is required evidence for claims about playing.

Export the lane in each manifest. Show `REPLAY` or `STRESS` throughout non-live runs and recordings. Never put replay numbers under a live-camera heading.

## 3. Lock the experiment

Every manifest contains:

- Full Git SHA, dirty-tree flag, build mode, lockfile hash, generator version, protocol version and asset/model hashes. Release claims require a clean production build.
- Audio SHA-256, decoded PCM fixture hash where applicable, map hash, tracking/mask fixture hashes, seed, difficulty and exact song-time sample window.
- CPU, GPU, RAM, OS/browser builds, hardware acceleration, power mode, charger state, refresh rate and variable-refresh status.
- CSS viewport, canvas drawing-buffer dimensions, display DPR, effective render pixel ratio, tier, intensity/accessibility settings and forced flags. “1080p” alone is insufficient when DPR changes GPU work.
- Camera alias, actual capture width/height/FPS from track settings, inference dimensions, delegate, hand/pose/mask cadences, fallback mode and `timestampSource` (`capture` or `callback-receipt`). If sensor capture metadata is unavailable, label age as callback-receipt-to-game; do not treat it as camera/sensor latency.
- Cold/warm state, cache layers cleared/retained, warm-up duration, repeat index, actual date with timezone, instrumentation mode and tier transitions.

Public exports exclude participant names, raw webcam footage, uploaded audio and private filenames. Fixtures/recordings require consent and redistribution rights before committing. Hashes identify an input without publishing it.

## 4. Scenario matrix and repetitions

Run on the demo laptop and, before claiming broad laptop support, another integrated-GPU laptop. Report machines separately. Primary acceptance: 60 Hz display, 1920×1080 CSS viewport where available, declared drawing-buffer size, auto tier, production build, hardware acceleration and mains power. A smaller screen is valid evidence with its actual dimensions, not a 1080p result.

- **Cold start:** three fresh browser launches with application caches cleared, local assets retained, network disabled. Measure shell/catalog-to-interactive SELECT with the placeholder and no camera request. Measure explicit Set up camera → trustworthy preview → valid calibration separately; initial downloads, permission wait and user calibration time must not be hidden in or confused with shell startup.
- **Warm start:** five starts after caching; record boot time and probe choice.
- **Representative play:** three complete runs of each bundled track at Normal, including the 45-second demo cut. Report full active play and a predeclared busiest 20-second section separately.
- **Stress:** three 60-second runs at documented maximum note/fragment/half/particle counts with mask uploads. State if overload exceeds a valid generated map.
- **Thermal soak:** at least 15 continuous minutes of live play or repeated complete tracks with SELECT/RESULTS transitions. Compare first/final three minutes; retain transition data for leaks.
- **Recovery:** camera denial, permission loss, unplug/reconnect, tab hide, worker failure, corrupt audio, cache denial/quota exhaustion, context loss and silence. Recovery outcomes are not samples to remove from ordinary runs after the fact.

Compare fixed low/medium/high tiers separately from adaptation. Export every downgrade and timestamp; a run that switched to low is not a high-tier result.

## 5. Metric definitions

### Frame delivery and CPU/GPU work

- `frameIntervalMs`: consecutive `requestAnimationFrame` callback timestamp difference during visible PLAYING. Report p50/p95/p99/max, count, duration and intervals above 25/33 ms. This is callback pacing, not physical presentation. At 60 Hz, normal rAF spacing is about 16.7 ms; sub-10 ms tier thresholds from these deltas are invalid. See [rAF documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- `ss:frame`: main-thread CPU time from input drain through render submission, with `ss:input`, `ss:game`, `ss:scene`, `ss:render`, `ss:ui` separately. Store-write time does not include asynchronous React commits; profile those separately.
- GPU duration: only available non-blocking `EXT_disjoint_timer_query_webgl2` results. Poll later, discard disjoint samples, disclose valid/invalid counts. Otherwise report **unavailable**; CPU submit time is not GPU execution. See [timer-query documentation](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query).
- Average callback FPS: `(N - 1) * 1000 / (lastTimestamp - firstTimestamp)`. Define “1% low” as `1000 / mean(slowest ceil(0.01*N) intervals)`; publish this definition and keep it secondary to interval percentiles.

### Tracking freshness and responsiveness

- `captureToInferDoneMs = tInferDone - tCapture`; normalise worker values to the main thread's performance-time domain using the explicit `performance.timeOrigin` mapping in [05](05-tracking-pipeline.md). Worker-local `performance.now()` cannot be subtracted directly from main-local capture time. `trackingAgeMs = tConsume - tCapture`; report p50/p95/p99/max and distinct consumed frames.
- Distinguish capture opportunities, skipped-busy opportunities, bitmaps created, frames submitted, results returned, stale results discarded and fresh results consumed. `skipRate = skippedCaptureOpportunities / captureOpportunities` is not an inference failure rate. Report hand/pose/mask rates separately.
- `inferenceMs` measures actual task execution, excluding result wait. A 30 Hz capture request does not prove 30 Hz tracking.
- Gesture evaluation uses held-out labels plus live trials: per-class precision/recall, confusion matrix, false activations per idle minute, transition latency, re-acquisition and occlusion failures. Do not average away the weakest class/player.
- Menu evaluation records intended selections, first-attempt success, unintended/duplicate activations, Open→Point confirmation latency, retries, native takeover and standing reach for each person/control class. Keep the intentional menu confirmation interval visible in latency definitions. A static placeholder contributes zero tracking/gesture samples; test both camera-free onboarding and the calibrated live menu. Core mouse/key/hand outcomes must agree under [25](25-menu-and-hand-navigation.md).
- `captureToInferDoneMs + frameIntervalMs` is only a **pipeline estimate**. Physical motion-to-photon requires an external high-frame-rate recording of hand and screen, a declared onset rule, camera frame rate and resolution of measurement. Use at least 20 trials; report median/p95. Audio-device latency needs a separate audible/visual or loopback experiment; clock-offset checks are not audio-latency measurements.

### Memory and resource lifetime

Report JS heap only when exposed by the tool/API. GPU bytes are estimates from dimensions unless a profiler provides them; `renderer.info.memory` gives counts, not bytes. Record geometry/texture counts, active/pool counts, open transferred resources and restart cycles. Compare post-GC snapshots at the same lifecycle point. A retained-resource trend is a failure to investigate; a sawtooth heap alone is not proof of a leak.

### Generation and gameplay quality

Measure read/hash, decode, resample, analysis, assignment, validation, cache write and end-to-end wall time from file selection/drop to validated ready-to-start state. That total includes read/hash, any required cache lookup/write and UI readiness. Record codec, bytes, duration, PCM rate, cache state, peak working set, cancellation latency and map validity. Cached retrieval is not generation.

Beat F1 uses one-to-one matching within ±70 ms of independent annotations: `P = matches/predicted`, `R = matches/reference`, `F1 = 2PR/(P+R)`. A beat matches at most once. Half/double-tempo errors count as failures; do not shift predictions to maximise test scores. Note-on-reference-grid ratio uses annotated beats, never the generator's own grid. Report onset precision, silent-region false notes, density/ergonomic violations, completion and comfort. See [08 — Evaluation](08-beatmap-generation.md#15-tuning-methodology).

## 6. Initial acceptance targets

These are **unmeasured targets**. A failed target requires a failure report or narrowed support claim; changes to targets require a changelog explanation.

- Primary 60 Hz configuration: `frameIntervalMs` p95 ≤ 18 ms, p99 ≤ 25 ms; at most two intervals > 33 ms per active minute; `ss:frame` p95 ≤ 14 ms. Prewarm before timed play and report cold shader compilation separately. `FLOOR_FPS` is a sustained-play floor, not a promise that no individual frame can exceed 25 ms.
- Fresh hand results ≥ 24 Hz; `inferenceMs` p95 ≤ 40 ms; consumed `trackingAgeMs` p95 ≤ 100 ms. Disclose decimated pose/mask rates. Optional physical motion-to-photon target: p95 ≤ 150 ms, only if externally measured.
- Supported three-minute audio: end-to-end generation p95 < 4 s; analysis/assignment excluding decode < 1.5 s; difficulty reassignment < 100 ms. Use at least five cold-generation runs per file and identify small sample sizes.
- On each held-out rhythmic clip: beat F1 ≥ 0.85, BPM error ≤ 2, note-on-reference-grid ratio ≥ 0.90 and zero validator/ergonomic violations. Beatless audio may give an honest sparse/free-rhythm result or reject as unsuitable.
- At least three first-time players calibrate and complete the demo cut; record setup time, retries, intended gestures missed, comprehension and discomfort. Proposed drill target: ≥80% of valid intended gestures judged correctly, reported per person/class.
- No unbounded retained-resource growth over soak and ten retry/song-change cycles; no double judgement, stuck audio, invisible pause or unrecoverable state.

## 7. Sampling and statistics

Nearest-rank percentile: sort ascending, index `max(0, ceil(p*N)-1)` for `p = 0.50/0.95/0.99`. Report each run, then median/range of per-run results. Millions of frames in one run are not independent repeat experiments. Five-run generation p95 is the slowest run; say so.

Declare sample windows before collection. Exclude only recorded pre-play warm-up and intentional PAUSED/hidden intervals from active pacing; list durations/reasons. Include GC, tracking-loss stalls, mid-song compilation and tier transitions during visible PLAYING. Retain anomalous runs; rerun and explain rather than delete.

Collect release timing with DevTools/video capture closed; diagnostic tracing and external-latency recordings are separate because they change performance. Measure logging overhead on/off. Clear consumed User Timing entries; use preallocated rings or streamed batches so telemetry does not leak.

## 8. Optimisation loop and ablations

1. Establish a full-scene reproducible baseline.
2. Identify the limiting stage and change one mechanism.
3. Alternate baseline/candidate order with the same inputs, tier and seed. Retain SHAs, raw samples, worst runs and visual captures.
4. Recheck correctness, freshness, musicality and comfort. Fewer pixels/particles change workload and must be disclosed.
5. Keep gains that exceed observed variation or fix a documented correctness issue.

Useful labelled ablations: mask uploads on/off; hand-only versus hand+pose; CPU/GPU delegates; full/decimated pose; bloom at fixed resolution; onset-only versus beat-snapped assignment. Diagnostic variants are not release settings.

## 9. Evidence bundle

Once measurements exist, store a compact summary at `docs/evidence/<run-id>/report.md`. Raw traces/private fixtures may live in a gitignored local folder or access-controlled artifact; link checksums and retention location. Do not create empty reports that imply measurement.

Include manifest, raw frame/job CSV or JSON, per-run summaries, failures, judgement-trace checksum, stage times, tier transitions, selected profiler trace and permitted labelled recordings. State test date, scope, pass/fail, unsupported metrics, regressions, licences and exact reproduction steps.

For judges, show a concise evidence card backed by this bundle: hardware/resolution, frame-interval p95, tracking-age p95, generation time and held-out beat F1. Missing metrics say **unmeasured**. One reproducible result is stronger than unsupported superlatives.

## Acceptance criteria

- [ ] Every result identifies SHA, hashes, device/browser, dimensions, tier, lane and sample window.
- [ ] Logic replay gives identical ordered judgements/score at 30/60/120 Hz render scheduling; cosmetic randomness has an independent fixed seed. Canonical PCM/landmark hashes are identical; any cross-engine floating-point tolerance is declared before testing and cannot excuse a changed judgement.
- [ ] Live tracking/player trials are separate from replay/stress evidence.
- [ ] Cold, warm, stress, full-song, thermal and recovery runs retain raw samples and failures.
- [ ] A second person can reproduce the procedure and inspect the demo card's supporting evidence.
