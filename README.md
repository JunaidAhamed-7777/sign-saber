# Sign Saber

**A controller-free, full-body 3D rhythm combat game that runs in your browser.** A standard webcam tracks your hands and body; you appear as a glowing neon silhouette inside a reactive void, and you slice, smash, laser and dodge your way through a beatmap generated automatically from any song.

A hackathon project. Working conventions for contributors and AI agents: [AGENTS.md](AGENTS.md).

> **Status: documentation and scaffolding phase.** Implementation starts at kick-off. Every subsystem is fully specified in [`docs/`](docs/README.md); every source file under `app/src/` holds its contract and a pointer to its spec.

## Project overview

- **Project name:** Sign Saber
- **Short description:** Beat Saber-style rhythm combat with no controllers and no headset. Open palm to slash, fist to smash armoured blocks, point-and-hold to fire a laser at distant targets, lean to dodge walls. Any MP3 becomes a level in under four seconds through on-device beat analysis. Players are rendered as a music-reactive Tron-style silhouette, never as raw webcam footage.
- **Team:** TODO — participant names and GitHub handles; maximum 4 members.
- **Working demo:** TODO — local demo instructions below once implemented.
- **Technology stack:** TypeScript · Vite · Three.js · pmndrs `postprocessing` · React 19 + Zustand (DOM overlay) · MediaPipe Tasks Vision (`HandLandmarker`, `PoseLandmarker` with segmentation) in a Web Worker · Web Audio API · own DSP beatmap generator (spectral flux, autocorrelation tempo, dynamic-programming beat tracking) · optional Node + `yt-dlp` companion for YouTube links · Blender MCP for 3D assets.

## The pitch in one screen

| You do | The game does |
| --- | --- |
| Stand in front of the laptop and wave | Confirms tracking, calibrates your body, counts you in on the beat |
| Swing an open hand | Particles snap into a glowing katana; the block splits along the exact plane of your swing |
| Punch with a fist | Armoured block shatters into physics-driven shards |
| Point and hold for half a second | A laser charges and pops a distant target with a power-down *poof* |
| Lean left or right | You dodge walls rushing down the lane |
| Drop any song | Notes land on real beats and drums; silence produces nothing |
| Finish | Accuracy, rank, kinetic energy in kJ/kcal, and a 3D highlight of your best moment |

Full product definition: [docs/01 — Vision & Pillars](docs/01-vision.md).

## Documentation

The specification is the deliverable of this phase and the contract for the build. Start at the **[docs index](docs/README.md)**. Highlights:

| Doc | Content |
| --- | --- |
| [02 — Architecture & Contracts](docs/02-architecture.md) | Module map, threading, `TrackingFrame` / `HandCursor` / `BodyState` / event contracts, coordinate frames, frame loop, **every constant** |
| [03 — Decisions](docs/03-decisions.md) | 14 ADRs: why MediaPipe hand+pose in a worker, why our own DSP, why plane-cut slicing, why no physics engine, … |
| [04 — State Machine](docs/04-state-machine.md) | BOOT → SELECT → CALIBRATION → PLAYING ⇄ PAUSED → RESULTS |
| [05](docs/05-tracking-pipeline.md) [06](docs/06-gesture-recognition.md) [07](docs/07-hit-detection-and-scoring.md) | Tracking, gestures, hit detection and scoring |
| [08](docs/08-beatmap-generation.md) [09](docs/09-beatmap-format.md) | Beatmap generation algorithms and the `BeatmapV1` format |
| [10](docs/10-rendering-silhouette.md) [11](docs/11-rendering-blocks-and-destruction.md) [12](docs/12-rendering-hands-trails.md) [13](docs/13-rendering-environment-camera-postfx.md) | Rendering: silhouette shader, blocks and destruction, hand trails, environment/camera/post FX |
| [14](docs/14-ui-ux.md) [15](docs/15-audio-playback-sync.md) [16](docs/16-performance-budget.md) [17](docs/17-testing-and-qa.md) | UI/UX, audio sync, performance budget, testing |
| [18](docs/18-blender-mcp-asset-pipeline.md) [19](docs/19-build-plan.md) [20](docs/20-demo-and-judging.md) [21](docs/21-risks-and-fallbacks.md) | Blender MCP assets, hour-by-hour build plan, demo script, risk register |

## Run the project

Prerequisites: **Node 22** (20.19+ works), **Chrome or Edge 120+**, a webcam. The optional YouTube companion also needs `yt-dlp` and `ffmpeg` on `PATH`.

```bash
cd app && npm install
```

```bash
cd app && npm run models
```

```bash
cd app && npm run dev
```

Open <http://localhost:5173>. Checks:

```bash
cd app && npm run check
```

Optional companion service (separate terminal):

```bash
cd server && npm run server
```

No environment variables are required. There is no `.env`.

## Repository layout

```
docs/        the specification (start at docs/README.md)
app/         web client — Vite + TypeScript + Three.js + React; src/ holds documented module stubs
server/      optional local YouTube → audio companion (Node, zero dependencies, wraps yt-dlp)
scripts/     model download, beatmap generation
assets-src/  Blender sources and raw assets
```

## Current status

- **Working features:** none yet — implementation begins at kick-off.
- **Known limitations:** see [docs/21 — Risks & Fallbacks](docs/21-risks-and-fallbacks.md).
- **Libraries, APIs, and public datasets used:** [Three.js](https://threejs.org) (MIT), [postprocessing](https://github.com/pmndrs/postprocessing) (Zlib), [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision) (Apache-2.0; models under Google's model terms), [React](https://react.dev) (MIT), [Zustand](https://github.com/pmndrs/zustand) (MIT), [Vite](https://vite.dev) (MIT), [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense, optional). Demo music: CC0/CC-BY tracks listed with attribution in `app/public/assets/tracks/README.md`.

See [AI_USAGE.md](AI_USAGE.md) for AI assistance and [CHANGELOG.md](CHANGELOG.md) for the development record. Submission details: [SUBMISSION.md](SUBMISSION.md).

## License

MIT — see [LICENSE](LICENSE).
