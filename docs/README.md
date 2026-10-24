# Sign Saber — Documentation Index

Sign Saber is a controller-free, full-body 3D rhythm combat game that runs in a browser. A standard webcam tracks the player's hands and body; the player is rendered as a glowing neon silhouette inside a reactive void, and slices, smashes, lasers, and dodges their way through a beatmap generated automatically from any song.

These documents are the **single source of truth** for what gets built, how, and to what standard. They were written before implementation so that every subsystem has an agreed contract, every constant has one home, and every hour of the hackathon has a job. If the code and the docs disagree, fix one of them in the same commit.

## How to read these docs

| If you want to… | Read |
| --- | --- |
| Understand what we are building and why it will win | [01 — Vision & Pillars](01-vision.md) |
| See how the pieces fit, every module contract, every constant | [02 — Architecture & Contracts](02-architecture.md) |
| Know why a technology or approach was chosen over alternatives | [03 — Decisions (ADRs)](03-decisions.md) |
| Implement the game flow (BOOT → SELECT → CALIBRATION → PLAYING → RESULTS) | [04 — State Machine](04-state-machine.md) |
| Build webcam capture + MediaPipe worker + smoothing | [05 — Tracking Pipeline](05-tracking-pipeline.md) |
| Build the Open Palm / Fist / Point classifier and the blade/charge logic | [06 — Gesture Recognition](06-gesture-recognition.md) |
| Map hands to the world, detect hits, judge timing, score | [07 — Hit Detection & Scoring](07-hit-detection-and-scoring.md) |
| Turn an audio file into a beatmap (onsets, tempo, beats, note assignment) | [08 — Beatmap Generation](08-beatmap-generation.md) |
| Read/write the beatmap JSON | [09 — Beatmap Format](09-beatmap-format.md) |
| Write the silhouette shader | [10 — Rendering: Silhouette](10-rendering-silhouette.md) |
| Build blocks, slicing, shattering, laser poof | [11 — Rendering: Blocks & Destruction](11-rendering-blocks-and-destruction.md) |
| Build hand particles and the katana blade ribbon | [12 — Rendering: Hands & Trails](12-rendering-hands-trails.md) |
| Build the grid void, camera kinetics, bloom | [13 — Rendering: Environment, Camera & Post FX](13-rendering-environment-camera-postfx.md) |
| Build every screen and the HUD | [14 — UI / UX](14-ui-ux.md) |
| Keep audio, game clock and tracking in sync; design SFX | [15 — Audio Playback & Sync](15-audio-playback-sync.md) |
| Hit 60 FPS (40 floor) on a laptop | [16 — Performance Budget](16-performance-budget.md) |
| Know what to test and how | [17 — Testing & QA](17-testing-and-qa.md) |
| Produce 3D assets with Blender MCP | [18 — Blender MCP Asset Pipeline](18-blender-mcp-asset-pipeline.md) |
| Know what to do in which hour of the hackathon | [19 — Build Plan & Milestones](19-build-plan.md) |
| Rehearse the demo and the pitch | [20 — Demo Script & Judging](20-demo-and-judging.md) |
| Know what can go wrong and the pre-decided fallback | [21 — Risks & Fallbacks](21-risks-and-fallbacks.md) |
| Look up a term | [22 — Glossary](22-glossary.md) |
| Run the optional YouTube audio companion service | [23 — YouTube Companion Service](23-youtube-companion-service.md) |

## Conventions used in every document

- **MUST / SHOULD / MAY** are used in the RFC 2119 sense. MUST items are the definition of done.
- **Constants** are named in `UPPER_SNAKE_CASE` and defined once, in the constants table of [02 — Architecture](02-architecture.md#constants). Other docs reference them by name and never redefine them.
- **Units**: world space is in metres, time is in milliseconds unless stated, angles in degrees in prose and radians in code, speeds in metres per second.
- **Coordinate frames** are named exactly as in [02 — Architecture §Coordinate frames](02-architecture.md#coordinate-frames): *image space*, *mirrored image space*, *play plane*, *world*, *screen*.
- **Scope tags**: `[CORE]` must ship for the demo; `[POLISH]` ships if the core is done by the feature freeze; `[STRETCH]` is only attempted when everything else is green. See [19 — Build Plan](19-build-plan.md) for the freeze time.
- Code identifiers in docs are the identifiers the code MUST use (`TrackingFrame`, `HandCursor`, `BeatmapV1`…), so searching the repo for a doc term finds the implementation.

## Repository map

```
sign-saber/
├── README.md                 project overview, run instructions
├── AGENTS.md                 working conventions for humans and AI agents
├── SUBMISSION.md             submission form (fill at the end)
├── CHANGELOG.md              dated record of meaningful changes
├── AI_USAGE.md               AI usage record (intentionally blank until the build starts)
├── docs/                     this folder — the specification
├── app/                      the web client (Vite + TypeScript + Three.js + React)
├── server/                   optional local YouTube→audio companion service
├── assets-src/               Blender sources, texture sources, raw audio
└── scripts/                  model/font download and asset build scripts
```

The per-folder layout of `app/` is documented in [02 — Architecture §Source layout](02-architecture.md#source-layout).
