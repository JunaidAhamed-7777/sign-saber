# Sign Saber — Build Roadmap

**Build one interaction that feels exceptional, then prove the entire game can sustain it.** This is the exact implementation sequence from the current documented scaffold to a judge-ready release. It replaces the previous event's timetable and folder ownership rules.

**Starting point:** source modules and ten test files are stubs; no game or benchmark measurements exist. Typecheck, lint and production build pass on the scaffold; Vitest executes zero assertions. None of the gates below has been achieved. A checked box must link to real evidence, not a prediction.

## How to execute this plan

Follow P0 → P1 → P2 → P3 → P4 → P5. Tasks within a phase are listed in dependency order. Pair parallel work only after contracts are fixed; the temporary owner of a file coordinates changes before another contributor edits it. Existing paths below are concrete starting points, not a ban on improving the structure.

Each numbered task is a reviewable commit or a short sequence of commits. Run targeted assertions and `npm run check` in `app/`; run `node scripts/check-docs.mjs` from the root for changed docs. Update the changelog and AI usage record in each meaningful commit. Commit after small completed milestones, roughly every 20–30 minutes during sustained work, and at every phase gate. Keep uncommitted experiments out of someone else's milestone.

There is no assumed event duration, team size, submission method or rubric. If an actual deadline is set, preserve the critical path and cut optional scope using [19](docs/19-build-plan.md#critical-path-and-scope-cuts). Do not compress away correctness or evidence.

## P0 — Foundations: make the contracts executable

**Outcome:** developers can boot a truthful shell, replay inputs and observe timing before implementing the game.

1. **P0.1 — Reproduce the environment.** Run `npm ci` and `npm run check` in `app/`. Record Node/npm, OS, browser, GPU/driver, display refresh, camera modes and the initial commit SHA. Confirm actual event rules before assuming prebuilt-code or asset permissions. Keep the lockfile; do not upgrade packages as part of an unrelated task.
2. **P0.2 — Implement shared data first.** Fill `app/src/core/constants.ts`, `events.ts`, `flags.ts`, `clock.ts`, `utils/emitter.ts` and `beatmap/types.ts` from [02](docs/02-architecture.md). Export all shared/render/UI tunables centrally. Add meaningful assertions for payloads, unit conversions and emitter subscription/disposal. Preserve framework-free game data.
3. **P0.3 — Build clocks and lifecycle before effects.** Implement `audio/songClock.ts` and `core/stateMachine.ts` from [04](docs/04-state-machine.md)/[15](docs/15-audio-playback-sync.md). Normalize worker timestamps into the main performance origin, map capture time into heard song time and handle pause/countdown epochs. Assert synthetic nonzero clock offsets, audio latency sign, stale messages after restart and illegal state transitions.
4. **P0.4 — Prove the risky browser path.** Implement the smallest `tracking/camera.ts` → `tracking.worker.ts` → `workerClient.ts` spike using the installed MediaPipe API. Test worker GPU initialization on the reference laptop with one frame in flight, transferable ownership and explicit disposal. Return an actionable BOOT error if unsupported; do not silently move synchronous inference onto the render thread. Record the actual delegate/capabilities and live outcome.
5. **P0.5 — Make assets reproducible.** Extend `scripts/download-models.mjs` to use specific model versions plus checksums and an asset manifest. Validate downloaded content and atomic replacement; size alone is not integrity. Copy WASM from the locked package; record model terms. Add a tiny licensed reference clip and synthetic fixtures without redistributing unlicensed material.
6. **P0.6 — Install replay and measurement seams.** Implement a dev-only fixture input that feeds the same processing path as live `TrackingFrame` data. Include seed, schema/version, timestamps and source label. Add bounded instrumentation for frame work, rAF intervals, inference, input age, queue drops, generator stages and pool occupancy as specified in [24](docs/24-benchmark-and-evidence.md). Replay is visibly labelled and never used to claim webcam performance.
7. **P0.7 — Render the honest shell.** Wire `main.tsx`, `App.tsx`, store and BOOT/SELECT with true capability/asset progress and useful errors. A successful model download is distinct from a running tracker. Replace initial test stubs with assertions; once tests exist, remove `--passWithNoTests` so missing tests cannot make a gate green.

**P0 gate:** clean setup works; contracts/state/clock assertions execute; worker capability spike works or a scoped supported fallback is documented; replay inputs are deterministic; asset versions are identified; the shell exposes failures truthfully. Record baseline instrumentation without claiming a frame-rate win from an empty scene.

## P1 — First playable: camera to one satisfying slash

**Outcome:** one real person can complete a tiny level, score hits and restart it.

1. **P1.1 — Bring audio and notes together.** Implement `audio/decode.ts`, `player.ts`, `beatmap/validate.ts`, `bundled.ts` and one tiny fixed `BeatmapV1` against an attributed excerpt. Schedule audio once from the master clock; reject a corrupt map. Keep map timing on decoded sample zero, with no second offset application.
2. **P1.2 — Render the lane.** Implement `render/renderer.ts`, `scene.ts`, `cameraRig.ts`, a plain environment and a small reusable block pool. Move notes from `note.t - approachMs` using song time; use a readable slash glyph. Skip bloom and authored GLBs here.
3. **P1.3 — Stabilize real inputs.** Complete tracking masks/landmarks, `filters.ts`, `gestures/cursor.ts`, `classifier.ts` and `blade.ts` for Open. Mirror once; calibrate handedness and reach; compute velocities from unique capture samples. Release masks/bitmaps and bound pending frames. Record missing/occluded-hand behavior.
4. **P1.4 — Implement contact to terminal judgement.** Fill `game/spawner.ts`, `liveObjects.ts`, `hit.ts`, `judge.ts`, `score.ts` and `session.ts` for slash-only play. Judge captured samples in capture order; reserve predicted cursors for rendering. Cover fast segment crossing, window boundaries, late results, duplicate messages, one judgement per note and deterministic tie-breaking. Close misses using the bounded input watermark/deadline in [07](docs/07-hit-detection-and-scoring.md).
5. **P1.5 — Close the session.** Connect hit/miss events to immediate light/SFX/score feedback and a minimal HUD. Add calibration, finish, results, restart and quit paths. Stop old audio sources and workers, clear pools and reject old session messages.
6. **P1.6 — Prove both paths.** Replay the same input at 30/60/120 Hz render schedules and with a deliberate stall: ordered judgements and totals must match. Separately have a consenting person calibrate and complete the excerpt through the actual webcam. Save failures and false hits as well as success.

**P1 gate:** a live webcam swing hits a real target in time with audio, the score is correct, the session finishes and restart is clean. Deterministic replay passes without supplying fabricated live-camera evidence. If this fails, stop optional feature work and repair the spine.

## P2 — Complete core: all gestures and a new song

**Outcome:** the full game works with both bundled and newly generated maps; every failure path is usable.

1. **P2.1 — Extend input and judgement deliberately.** Add Fist/Smash, Point/Beam charge/target/whiff logic and calibrated torso lean/walls from [06](docs/06-gesture-recognition.md)/[07](docs/07-hit-detection-and-scoring.md). Preserve gesture hysteresis, capture-time scoring and exactly one terminal outcome. Test charge reset, tracking loss, invalid coordinates, wall boundaries and note/wall conflicts.
2. **P2.2 — Finish score and results.** Implement combo/multiplier, Bad Cut, per-judgement counts, rank and unmultiplied accuracy. Assert a Perfect run reaches 100% with early walls; misses/Bad Cuts contribute zero, no-note charts are handled, score caps remain consistent and results do not mutate after completion. Label motion energy as an approximate game metric.
3. **P2.3 — Build DSP stage by stage.** In `beatmap/dsp/`, implement resample → windowed FFT/STFT → band spectral flux → adaptive peaks → tempo candidates/confidence → beat tracking → section energy. Use synthetic clicks with known sample times, silence, noise, short files and ambiguous half/double tempo. Check numerical output and time bases before listening tests. Follow [08](docs/08-beatmap-generation.md); do not equate a strong autocorrelation peak with musical certainty.
4. **P2.4 — Turn musical events into playable actions.** Implement `beatmap/assign.ts` with seeded choices, difficulty density, per-hand reach/speed, gesture-change breathing room, beam lead time and safe wall scheduling. Validate generated maps through the same schema as bundled maps. Reject impossible arrangements; low-confidence material uses a disclosed fallback or a clear refusal.
5. **P2.5 — Add bounded upload and caching.** Implement `generator.worker.ts`, `generatorClient.ts` and `cache.ts`. Validate size/duration/decode, transfer ownership safely, expose real stage progress, terminate/restart for responsive cancellation and ignore stale jobs. Cache keys include file hash, generator version, difficulty and relevant configuration. Distinguish cache hit, cold DSP and total file-to-ready duration.
6. **P2.6 — Replace fake commands and add real content.** Implement `scripts/generate-beatmaps.mjs` (or a documented equivalent) before replacing the failing `beatmaps` placeholder. Add two attributed bundled tracks, manifests, cover rights and validated difficulty maps. Inspect the first playable excerpt for reachable gesture order; generated notes stay faithful to the audio.
7. **P2.7 — Finish recovery and evaluation.** Complete every legal state transition, camera denied/unplugged, hidden tab, tracking loss, cancel/retry, wrong format, unavailable audio output and restart/quit. Run the held-out music-quality cases in [24](docs/24-benchmark-and-evidence.md), plus consented live checks for every mechanic. Play a supported file outside the bundled library to real results.

**P2 gate:** the complete core in [01](docs/01-vision.md) works at functional quality; every gesture, obstacle, upload and recovery path is exercised; generator validation and deterministic full-session assertions pass. Core presentation may still be simple. `[POLISH]` work is now eligible, but cannot displace unresolved core defects.

## P3 — Signature spectacle: make the proof unforgettable

**Outcome:** the working game gains its own visual identity without sacrificing legibility or comfort.

1. **P3.1 — Make the player the reveal.** Implement `render/silhouette.ts` and its shader from [10](docs/10-rendering-silhouette.md). Fit mask and play-plane projection correctly, upload owned reusable mask data and test aspect changes. Add music-reactive edge colour and restrained fill. Label the skeleton fallback; do not display raw camera pixels in the shipped scene.
2. **P3.2 — Deliver the hero cut.** Implement `render/slicer.ts` with convex face clipping, cap triangulation, bounded buffer capacity and graceful degenerate-plane handling. Use a physically consistent swing plane and ensure the two halves reconstruct the original cube within tolerance. Match visible split and score response; geometric elegance must not add input delay.
3. **P3.3 — Give every gesture a silhouette of its own.** Finish `shatter.ts`, `poof.ts`, `blade.ts` and `trails.ts`. Pool fragments and particles; seed visual randomness from stable event identifiers; animate on the session visual clock. Procedural geometry remains the asset-loading fallback. Optional Blender production follows [18](docs/18-blender-mcp-asset-pipeline.md), with explicit export/cleanup budgets.
4. **P3.4 — Choreograph the arena.** Implement `environment.ts`, `postfx.ts` and camera response from [13](docs/13-rendering-environment-camera-postfx.md). Bass/mid/treble, kicks, builds and drops have distinct restrained roles. Keep target glyphs and safe lanes readable at the busiest instant. Reduced motion disables scene shake/FOV movement as well as DOM motion; bloom/flashes obey accessibility limits.
5. **P3.5 — Finish the human interface.** Implement [14](docs/14-ui-ux.md): clear stage progress, actionable errors, visible focus, keyboard access, redundant glyph/shape cues, stable HUD layout and respectful calibration copy. Make the first successful action obvious from a normal standing distance.
6. **P3.6 — Save a real ending.** Copy the selected mask/pose into owned highlight storage; do not retain recycled transferred buffers. Show a restrained 2.5D results composition with actual session statistics. Never describe it as a body scan or show unrelated prerecorded results as the current run.
7. **P3.7 — Prepare and test the reveal.** Produce the rights-cleared 45-second demo excerpt/map for P4's representative runs and P5's showcase. Run the first-time-player exercise in [01](docs/01-vision.md#target-environment-and-human-check). Observe instructions understood, time to first hit, discomfort, gesture errors and tracking loss. Fix the highest-impact confusion, then repeat the affected checks.

**P3 gate:** a five-second movement reveal, a matched swing-plane cut, three distinct gesture payoffs and a music drop are all demonstrable live; reduced motion and low quality preserve required cues; repeated sessions do not retain effects or snapshot buffers. The spectacle is implemented, not merely rendered in a mockup.

## P4 — Measured optimization: earn every performance claim

**Outcome:** the actual integrated game has reproducible evidence on the reference machine and a disclosed degradation strategy.

1. **P4.1 — Turn instrumentation into a harness.** Implement the artifact export and scenarios in [24](docs/24-benchmark-and-evidence.md). Add real documented commands only when they exist. Export run manifest, raw samples, summaries, correctness/event hashes and failures. No generated sample benchmark numbers are allowed in release evidence.
2. **P4.2 — Freeze comparisons.** Use identical audio/map/input hashes, seeds, model/config versions, effective framebuffer size, DPR, fixed tier, browser, power and thermal conditions. Keep replay/render-only, video/inference and live-camera measurements separate. Preserve the warm-up and cache rules; do not discard the worst run.
3. **P4.3 — Establish the full baseline.** Run first-use/model-ready boot, cold/warm song readiness, normal play, maximum effects, generator contention, tracking-loss recovery and thermal/session soak. Use all required repetitions. Report frame and input-age distributions, queue drops, tracking throughput, stage timings and memory/resource trends.
4. **P4.4 — Optimize one supported cause at a time.** Profile CPU and GPU separately where supported. Candidate changes: typed-array reuse, effect pooling, instancing, mask upload cadence, render scale, bloom resolution, UI event throttling and DSP scratch memory. Keep a change only when paired raw runs improve the intended metric without changing scoring, map quality or required visual cues.
5. **P4.5 — Verify adaptation honestly.** Fix tier for comparative runs; evaluate automatic tier selection separately on the full tracking/effect workload. Record every resolution/tier change. If a machine cannot meet a gate, use the documented fallback and report the resulting configuration. A smooth empty attract scene cannot establish gameplay performance.
6. **P4.6 — Assemble the evidence story.** Write one compact measured claim per standout capability, with its environment, range/percentile, sample count and artifact link. Include slow inputs, failed cases and unsupported capabilities. External motion-to-photon tests require actual synchronized physical/video measurement; worker elapsed time alone cannot support that claim.

**P4 gate:** the canonical [24 targets and protocol](docs/24-benchmark-and-evidence.md) pass on disclosed hardware with raw evidence; generator quality and score replay remain correct; sustained performance and resource cleanup survive the soak. `[STRETCH]` features can be considered only while the gate remains green.

## P5 — Release proof: ship what you can show

**Outcome:** a new person can run it, a judge can try it and the evidence survives questions.

1. **P5.1 — Freeze the candidate.** Stop feature additions. Run `npm run check`, the documentation checker, manual QA and clean-clone installation. Validate actual model downloads/checksums, music credits and production asset paths.
2. **P5.2 — Prove the venue path.** Serve the production build locally, disable external network and complete boot → calibration → bundled play → results. Check camera-denied, unplug, hidden-tab, no audio, upload-cancel and low-quality recovery. Offline means a prepared local build, not an unimplemented service worker.
3. **P5.3 — Rehearse one coherent live session.** Use [20 — Demo & Judging](docs/20-demo-and-judging.md). Choose an attributed short excerpt whose generated map naturally supports the gesture sequence; finish it for genuine results. Rehearse with a timer three times and run each failure drill. Keep the strongest interaction in the opening seconds.
4. **P5.4 — Package proof and fallback.** Record the real game, clearly label recording/replay, retain the actual benchmark artifacts and QA results, and prepare a 30-second fallback video. Check playback with network disabled. Do not invent track titles, timestamps, metrics or participant details.
5. **P5.5 — Publish an honest handoff.** Fill the README submission section with the actual release URL/recording, tested SHA/tag, team/event details when known, measured claims, attribution and known limits. Update changelog and AI usage, commit, push and verify the remote SHA. If a later documentation commit records the tested code SHA, identify it as such instead of creating a circular final-hash claim.

**P5 gate:** all [release checklist](docs/19-build-plan.md#release-checklist) items have actual outcomes; the code and docs match; the demo works for another person; release identity and evidence are discoverable. Until then, describe the project as a work in progress.

## What to do next, from this commit

Start **P0.1**, then **P0.2**. Do not begin with Blender, an optional YouTube helper or an elaborate menu. The first implementation milestone is a truthful boot shell with executable contracts, followed by the P1 live slash. Use the numbered subsystem docs for algorithms and API details; this roadmap determines their integration order.

The continuing checklist is [docs/19-build-plan.md](docs/19-build-plan.md). The performance/quality proof standard is [docs/24-benchmark-and-evidence.md](docs/24-benchmark-and-evidence.md). Current command/status truth lives in [README.md](README.md).
