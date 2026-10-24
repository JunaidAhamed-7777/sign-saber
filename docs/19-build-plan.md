# 19 — Build Plan & Milestones

**[ROADMAP.md](../ROADMAP.md) is the canonical build order.** This document is the operating checklist for executing it. The previous overnight timetable and permanent folder tracks are retired. Set an actual release date only after the current event's rules are known; scale scope by evidence, not an assumed hour count.

## Working rhythm

1. Choose the next unmet roadmap gate and one small deliverable that advances it.
2. Read its contracts and state the input, output, acceptance check and temporary edit owner. With parallel contributors, agree file boundaries and integration points in chat; directories are not permanently reserved.
3. Build against deterministic fixtures while producers are being implemented. Label fixtures as synthetic or consented recordings. They must never masquerade as live tracking.
4. Complete the smallest end-to-end behavior, run relevant checks and inspect actual output. Update docs when behavior changes.
5. Update `CHANGELOG.md` and `AI_USAGE.md`, stage only completed work, and commit. Aim for a coherent commit every 20–30 minutes and at every gate. Push according to the current authorization; never force-push shared `main`.

## P0 — Foundations

- [ ] Confirm actual event rules, if applicable; record unknowns rather than inventing them.
- [ ] Establish clean-clone setup, dependency lockfile, capability checks and truthful BOOT errors.
- [ ] Build camera-free SELECT with the central placeholder and **Set up camera**; define independent setup/menu-pointer contracts and shared native/hand target dispatch from [25](25-menu-and-hand-navigation.md).
- [ ] Implement shared contracts, central constant exports, typed events, state machine and audio/performance clock mapping.
- [ ] Pin model/asset versions and checksums; record licenses and asset sizes.
- [ ] Add deterministic fixture input and named instrumentation boundaries before expensive visual work.
- [ ] Replace assertion-free test stubs with initial contract/state/clock tests; then remove the no-tests success escape hatch.
- **Gate:** assertions execute; invalid transitions fail usefully; capture and audio time conversions pass synthetic offset/pause cases; bounded camera-worker feasibility is demonstrated on the reference machine.

## P1 — First playable

- [ ] Expose/play the first attributed starter song or credited excerpt against a tiny validated fixed map, without upload.
- [ ] Implement camera → tracking worker → captured landmarks → open-hand cursor → slash contact → score → HUD.
- [ ] Connect a minimal Three.js lane and readable slash targets; procedural visuals are sufficient.
- [ ] Calibrate mirror/reach and preserve exact capture-time scoring. Test late arrivals, duplicate samples and misses.
- [ ] Complete one session and restart it without duplicate events, lingering sound or stale state.
- [ ] Complete setup without selecting music first; select/start the prototype with mouse/keyboard and Open → Point control. Cancel stale/lost/held-point input safely.
- **Gate:** a replay produces identical event logs under varied render cadence; a consenting player can actually hit slash notes with the live webcam and reach results. Record the two checks separately.

## P2 — Complete core

- [ ] Add Fist/Smash, Point/Beam, lean/walls, one terminal outcome per object, combo, rank and unmultiplied accuracy.
- [ ] Complete BOOT/SELECT/CALIBRATION/PLAYING/PAUSED/RESULTS error and recovery paths.
- [ ] Implement decode, DSP stages, deterministic assignment, schema validation, versioned cache and cancel/retry.
- [ ] Replace the `beatmaps` placeholder with a working generator; package three full attributed starter songs, manifest/credits/previews and validated Easy/Normal/Hard maps.
- [ ] Complete side-rail menus, placeholder/setup/live states, native/hand equivalence, one-click rearming and offline starter-library checks; these are CORE.
- [ ] Enforce comfortable reach, density, gesture transition and wall/note constraints; evaluate silence and low-confidence music.
- [ ] Prove a new local song can be analyzed, played and completed; include unsupported/corrupt input checks.
- **Gate:** every core mechanic works with a real player; full-session replay, generator quality checks and targeted integration assertions pass. Only then admit `[POLISH]` work.

## P3 — Signature spectacle

- [ ] Finish silhouette projection, shader, reusable mask ownership and a labelled skeleton fallback.
- [ ] Deliver the matched swing-plane cut, bounded smash shards and readable beam sequence.
- [ ] Add hand trails, coherent music-reactive arena, restrained bloom and drop response.
- [ ] Finish responsive HUD, useful progress/errors, keyboard/focus behavior, scene-wide reduced motion and redundant gesture cues.
- [ ] Save an owned 2.5D highlight and honest results copy; qualify the energy estimate.
- [ ] Prepare the rights-cleared 45-second demo excerpt/map before P4 representative benchmarks.
- [ ] Perform the first-time-player exercise in [01](01-vision.md#target-environment-and-human-check).
- **Gate:** the full showcase is readable during its heaviest section, comfortable in reduced motion and leak-free across repeated sessions. The signature visual can be shown live rather than described.

## P4 — Measured optimization

- [ ] Implement the harness and artifact export described in [24](24-benchmark-and-evidence.md); proposed tools become real only when documented and executable.
- [ ] Freeze the reference environment, input hashes, seeds, capture conditions and fixed-quality scenarios.
- [ ] Establish baseline raw data before changing performance-sensitive code.
- [ ] Profile → change one cause → rerun paired scenarios → keep only supported improvements. Preserve correctness/event hashes.
- [ ] Exercise cold/warm readiness, dense effects, live tracking, generation contention, thermal soak and recovery.
- [ ] Confirm quality selection on the integrated workload; benchmark fixed tiers separately from automatic tier changes.
- **Gate:** required percentile, freshness, quality and stability targets in [24](24-benchmark-and-evidence.md) pass with reproducible artifacts. Failures trigger a documented fallback, not a hidden easier benchmark. `[STRETCH]` may begin only while these gates remain green.

## P5 — Release proof

- [ ] Stop feature additions; accept release-blocking fixes and measured tuning only.
- [ ] Run [17 — QA](17-testing-and-qa.md), a clean clone, disconnected-network production exercise and first-player checks on the release candidate.
- [ ] Rehearse [20 — Demo](20-demo-and-judging.md) three times with a timer and run every failure drill.
- [ ] Record actual results, limitations and fallback paths; create a labelled recording of the real game.
- [ ] Assemble the release checklist below, commit and push the tested candidate, then identify it by SHA/tag in the handoff.
- **Gate:** another person can reproduce setup, see the live demo, inspect the evidence and distinguish implemented behavior from remaining plans.

## Critical path and scope cuts

```text
contracts + clocks + deterministic fixtures
                 ↓
camera → worker → capture-time cursor → contact → judgement → score → HUD
                                       ↑
audio clock → validated map → spawner → live notes
                 ↓
complete gestures + generated songs + recovery
                 ↓
signature effects → measured optimization → release evidence
```

If the playable spine is failing, stop optional asset, companion and presentation-feature work and repair that spine. Parallel work is useful only when its contracts and temporary edit boundaries are clear. A solo builder follows the same sequence with fewer optional effects.

Cut order when evidence or time requires it: YouTube companion → optional turntable/chromatic accents → decorative props and particle density → `[STRETCH]` mechanics. Do not quietly remove accurate scoring, calibration, input cleanup, a useful pause path, privacy, silence rejection or measurement provenance. A reduced release must update [01](01-vision.md), the README and the demo script to match.

## Definition of checkpoint reached

A checkpoint is reached when its deliverable is implemented, relevant assertions and `npm run check` pass, docs match, evidence is recorded and the work is committed. Run live-camera checks for changes to live input; fixture-only changes do not require invented human evidence. A checkpoint can be recorded as blocked/failed with its remaining issue; do not tick its gate.

## Release checklist

- [ ] Actual event/submission rules and team details recorded when applicable.
- [ ] `npm ci`, asset preparation and production run repeated on a clean clone; commands and runtime asset provenance accurate.
- [ ] Executed tests contain assertions; local documentation checker passes; CI result tied to the candidate SHA.
- [ ] Core manual QA, consented live input, comfort checks, offline exercise and recovery drills recorded with actual outcomes.
- [ ] Benchmark manifest, raw samples, summaries, generator-quality results and any known failures saved as in [24](24-benchmark-and-evidence.md).
- [ ] Music, models, fonts and asset licenses/attributions complete.
- [ ] Demo recording, script timing and fallback recording verified; recordings labelled as recordings.
- [ ] README status/limitations and submission details accurate; changelog and AI usage current.
- [ ] Tested release commit/tag pushed without rewriting history; README names that release SHA rather than claiming to contain its own final hash.
