# 19 — Build Plan & Milestones

This plan assumes a **15.5-hour overnight window, kick-off 18:30 → wrap-up 10:00**. The wall-clock times below are illustrative; the **H offsets** (hours since kick-off) are what matter, so shift them to the actual event schedule and compress or stretch proportionally if the window differs. It assumes a team of 2–4 with one person owning each track below. Solo builders follow the same order and drop every `[POLISH]` item that is not on the critical path.

Commit cadence (from `AGENTS.md`): a meaningful commit at every checkpoint and at least every 30 minutes while building. `CHANGELOG.md` and `AI_USAGE.md` are updated in the same commit.

## Tracks (parallel owners)

| Track | Owner | Folders | Depends on |
| --- | --- | --- | --- |
| **T** Tracking & Input | — | `tracking/`, `gestures/` | nothing |
| **R** Rendering | — | `render/`, shaders, Blender assets | contracts from [02](02-architecture.md) |
| **A** Audio & Beatmap | — | `audio/`, `beatmap/`, `server/` | nothing |
| **G** Game & UI | — | `core/`, `game/`, `ui/`, `state/` | contracts; integrates T/R/A |

Every track starts from the contracts in [02](02-architecture.md). Until a real producer exists, consumers run on **fixtures**: recorded `TrackingFrame` sequences (`tests/fixtures/`), a hand-written `BeatmapV1`, and a synthetic `BandEnergies` sine.

## Timeline

Wall-clock times assume an 18:30 kick-off. "H" = hours since kick-off.

### H0 — 18:30 · Kick-off (30 min)

- [ ] Re-read [01](01-vision.md) and [02](02-architecture.md) as a team; assign tracks.
- [ ] `npm install` in `app/`; `npm run models` to fetch MediaPipe assets; confirm `npm run dev` serves the stub page.
- [ ] Record two 20-second landmark fixture sequences (one slashing, one pointing/fist) with a throwaway script as soon as T has the worker running — these unblock G.
- **Checkpoint H0.5:** `docs:` and `chore:` commits; everyone can run the dev server.

### H1 — 19:00 · Foundations (2 h → 21:00)

| Track | Deliverable |
| --- | --- |
| T | Camera capture at `CAM_REQ_*`; worker loads both models with GPU delegate; `TrackingFrame` posted at ≥ 24 Hz; debug canvas draws landmarks + mask. One Euro filter applied. |
| R | Three.js scene with `CAM_POS`/`CAM_FOV_DEG`, infinite grid shader, fog, bloom composer at `BLOOM_RESOLUTION_SCALE`. Attract scene renders at 60 FPS. |
| A | `decode.ts` + `SongClock` + `player.ts` play a bundled MP3 with sample-accurate start; `analyser.ts` publishes `BandEnergies`. Beatmap worker skeleton with STFT + spectral flux producing onsets on a test clip. |
| G | State machine with all states and legal transitions; event bus; constants file; Zustand store; React router over states with placeholder screens; BOOT progress aggregation. |

- **Checkpoint H3 (21:30):** `feat:` commits per track. Integration smoke test: silhouette plane shows the live mask on the attract scene (T→R), audio plays (A), state machine drives screens (G).

### H3 — 21:30 · Core loop (2 h → 23:30)

| Track | Deliverable |
| --- | --- |
| T | Gesture classifier with hysteresis; `HandCursor` with play-plane mapping, velocity, blade/charge flags; `BodyState` with lean hysteresis. Unit tests on fixtures pass. |
| R | Block instancing with glass material + glyph atlas; notes travel along the lane from spawn to despawn; hand cursor particles (idle orbit). Silhouette shader v1 (threshold + edge glow, static colour). |
| A | Tempo estimation + DP beat tracking + snapping; `assign.ts` produces a validated `BeatmapV1` for the two demo tracks; `npm run beatmaps` writes them to `public/assets/tracks/`. |
| G | Spawner + live object sim; hit detection (sphere + blade segment vs OBB); judgement; scoring + combo ladder; HUD with score/combo/multiplier. |

- **Checkpoint H5 (23:30): FIRST PLAYABLE.** A bundled track plays, blocks arrive on the beat, open-hand swipes destroy slash blocks with a score pop. ADR-007 fallback decision on tempo quality is made now.

### H5 — 23:30 · Full mechanics (2 h → 01:30)

| Track | Deliverable |
| --- | --- |
| T | Wave detector; `BodyCalibration` capture; tracking-lost detection; latency stats in debug overlay. |
| R | Slice (plane-cut halves + fall), shatter (fractured GLB from Blender MCP or procedural fallback), poof. Blade ribbon from cursor history. Camera rig: kick shake, drop FOV punch. |
| A | Music events (`kick`, `drop`, `build`, `calm`); SFX bus with the 9 sounds; upload flow with IndexedDB cache and progress. |
| G | Smash + beam mechanics, bad cut, obstacles + lean dodge, kinetic energy accumulator; Calibration screen; Paused (auto on tracking loss); Results v1. |

- **Checkpoint H7 (01:30): FEATURE COMPLETE [CORE].** Every MUST in [01 §What done looks like](01-vision.md#what-done-looks-like-definition-of-the-shipped-product) is implemented, possibly ugly.

### H7 — 01:30 · Wow pass (3 h → 04:30)

- R: silhouette edge colour from `BandEnergies`, scanline fill, 2.5D skeleton; environment pulses on beats; drop palette shift; chromatic aberration + vignette on drops; results highlight capture with turntable.
- G: HUD polish, judgement text pops, combo milestones, Results animations, calibration coaching text.
- T: tuning session with three different people in front of the camera (thresholds in the constants file only).
- A: generator tuning against 5 test tracks of different genres; obstacle placement rules; difficulty curves.
- **Checkpoint H10 (04:30):** record a 30-second capture of gameplay for the pitch deck / fallback video.

### H10 — 04:30 · Reach & robustness (2 h → 06:30)

- `[POLISH]` YouTube companion service + UI integration (only if network at venue permits testing).
- Quality tiers + boot probe; performance pass against [16](16-performance-budget.md) on the demo laptop; fix the top three hot spots.
- Error cards for camera denied / no WebGL2 / models missing.
- **FEATURE FREEZE at H12 (06:30).** After this, only bug fixes, tuning, and docs.

### H12 — 06:30 · QA & demo (3 h → 09:30)

- Run the full manual QA checklist in [17](17-testing-and-qa.md) twice, with two different players.
- Rehearse the demo script in [20](20-demo-and-judging.md) three times, including the failure drills.
- Complete `README.md` run instructions, `SUBMISSION.md`, final `CHANGELOG.md` entry, `AI_USAGE.md`.
- **Checkpoint H15 (09:30):** final commit pushed; SHA recorded in `SUBMISSION.md`. 30-minute buffer to wrap-up.

## Critical path

```
camera → worker → TrackingFrame → cursors/gestures → hit detection → score → HUD
                                      ▲
beatmap (bundled JSON) → spawner → live notes ─┘
```

Everything else (silhouette beauty, destruction effects, obstacles, beam, results, upload, YouTube) hangs off this spine. If the spine is not green by H5, all four owners swarm it.

## Scope tags recap

| Tag | Items |
| --- | --- |
| `[CORE]` | Everything in [01 §What done looks like](01-vision.md#what-done-looks-like-definition-of-the-shipped-product) |
| `[POLISH]` | YouTube companion, 2.5D skeleton, chromatic aberration, results turntable, combo milestone effects, calibration coaching |
| `[STRETCH]` | Duck obstacles (`bar`), directional slashes, mines, Essentia.js tempo fallback, `MediaStreamTrackProcessor` capture path |

## Definition of "checkpoint reached"

A checkpoint is reached only when: the code is committed and pushed; `npm run typecheck && npm run lint && npm run test` pass; the feature was exercised live with the webcam (not only with fixtures); and the `CHANGELOG.md` entry describes what was verified.
