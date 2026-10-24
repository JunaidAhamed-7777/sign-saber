# Sign Saber — Documentation Index

Sign Saber is a planned webcam-controlled rhythm game with a neon body silhouette, gesture-specific destruction and local music analysis. **The repository currently contains specification and scaffold only.** A MUST describes a build requirement; it does not assert that the requirement has shipped.

Begin with **[ROADMAP.md](../ROADMAP.md)**. It is the canonical implementation order and explains what to build, where to start, how to test it and what evidence unlocks the next phase. [19 — Build Plan](19-build-plan.md) is the working checklist; [24 — Benchmark & Evidence](24-benchmark-and-evidence.md) is the measurement protocol. No deadline, team size, folder ownership or judging rubric from an earlier event is binding.

[DESIGN.md](../DESIGN.md) preserves the figure-centred visual direction and maps the UI palette/font roles; docs14/25 own screen and input behavior. All three are specification, not evidence of rendered screens.

## Product and contracts

- [01 — Vision & Pillars](01-vision.md): the player promise, core release and deliberate limits.
- [02 — Architecture & Contracts](02-architecture.md): module boundaries, named types/events, coordinates, frame loop and shared constant registry.
- [03 — Decisions](03-decisions.md): why these technologies and tradeoffs; revisit on evidence.
- [04 — State Machine](04-state-machine.md): BOOT → SELECT → CALIBRATION → PLAYING ⇄ PAUSED → RESULTS, with recovery and cleanup.

## Input, gameplay and music

- [05 — Tracking Pipeline](05-tracking-pipeline.md): camera permission, inference worker, timestamps, buffering, filtering and failure paths.
- [06 — Gesture Recognition](06-gesture-recognition.md): Open/Fist/Point, blade activation, charge and identity handling.
- [07 — Hit Detection & Scoring](07-hit-detection-and-scoring.md): capture-time contact, deterministic judgement, misses, combo and accuracy.
- [08 — Beatmap Generation](08-beatmap-generation.md): DSP pipeline, confidence, silence and playable assignment.
- [09 — Beatmap Format](09-beatmap-format.md): `BeatmapV1`, validation, cache provenance and bundled tracks.
- [15 — Audio Playback & Sync](15-audio-playback-sync.md): audio output clock, pause/resume, latency calibration and SFX.
- [23 — YouTube Companion](23-youtube-companion-service.md): optional local service, explicitly outside the core path.

## The visible experience

- [10 — Silhouette](10-rendering-silhouette.md): mask shader, projection, edge treatment and fallback.
- [11 — Blocks & Destruction](11-rendering-blocks-and-destruction.md): readable blocks, plane-cut halves, shards and beam poof.
- [12 — Hands & Trails](12-rendering-hands-trails.md): orbit particles, blade ribbon and charge feedback.
- [13 — Environment, Camera & Post FX](13-rendering-environment-camera-postfx.md): reactive void, bounded effects, quality tiers and 2.5D highlight.
- [14 — UI / UX](14-ui-ux.md): screen flow, HUD, copy, accessibility and resilient controls.
- [25 — Menu, Hand Navigation & Camera Setup](25-menu-and-hand-navigation.md): central placeholder/live figure, camera-optional browsing, three-song starter library and core palm-to-point control.
- [18 — Asset Pipeline](18-blender-mcp-asset-pipeline.md): optional Blender-assisted production, procedural fallback and asset budgets.

## Proof and execution

- [16 — Performance Budget](16-performance-budget.md): resource budgets, instrumentation and quality adaptation.
- [17 — Testing & QA](17-testing-and-qa.md): unit/integration coverage, fixture replay, manual QA and release checks.
- [19 — Build Plan & Milestones](19-build-plan.md): phase checklists, commit cadence and release handoff.
- [20 — Demo & Judging](20-demo-and-judging.md): a rehearsable three-minute reveal with truthful evidence and failure drills.
- [21 — Risks & Fallbacks](21-risks-and-fallbacks.md): when to simplify and how to retain a working game.
- [22 — Glossary](22-glossary.md): shared vocabulary.
- [24 — Benchmark & Evidence](24-benchmark-and-evidence.md): fixed scenarios, targets, raw artifacts, ablations and claim rules.

## Reading rules

- **MUST / SHOULD / MAY** mean required / recommended / optional behavior. Each release requirement needs actual evidence before it is called done.
- **Scope:** `[CORE]` is the complete release requirement, delivered incrementally; P1 is deliberately smaller. `[POLISH]` begins after the P2 core gate. `[STRETCH]` waits until P4 targets and core checks are green. A feature in a numbered doc is not automatically `[CORE]`; use [01](01-vision.md) and the roadmap for scope.
- **Units:** world space in metres; time in milliseconds except Web Audio values and explicit `*Sec` fields; prose angles in degrees and code angles in radians; speeds in metres per second.
- **Coordinates:** image space, mirrored image space, play plane, world and screen have the meanings in [02](02-architecture.md#coordinate-frames). Mirroring occurs once. Capture-time inputs and predicted visual cursors serve different purposes.
- **Constants:** [02 §Constants](02-architecture.md#constants) is the shared registry; linked render/UI tables are explicit sub-registries. Export centrally during P0. Do not infer working exports from the current `export {}` stub.
- **Identifiers:** use documented names verbatim; update both sides of a changed contract together.
- **Evidence:** budgets and targets are not measurements. Replays prove reproducibility, live camera checks prove the camera path, and external measurements establish motion-to-photon latency.

## Current paths and maintenance

`docs/` contains the specification; `app/` the web scaffold; `server/` the optional service stub; `scripts/` the downloader and documentation checker; `assets-src/` the proposed source-asset area. This layout can evolve. Keep links and source headers accurate when it changes.

From the root run `node --test scripts/check-docs.test.mjs` and `node scripts/check-docs.mjs`. These check the checker itself and local Markdown paths/fragments, including this index. They do not prove runtime behavior, remote link availability or benchmark results.

Record meaningful changes in [CHANGELOG.md](../CHANGELOG.md) and AI contributions in [AI_USAGE.md](../AI_USAGE.md); keep the [project README](../README.md) honest about what exists.
