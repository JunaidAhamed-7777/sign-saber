# Sign Saber

**Your body is the controller. The music builds the arena.**

Sign Saber is a planned browser rhythm game: a webcam turns your movement into a neon silhouette; open hands cut, fists shatter, pointing charges a beam, and leaning dodges incoming walls. Local audio becomes a playable level through on-device beat analysis. No headset or handheld controller.

**Current status: specification and scaffold, not a playable game.** The source and ten unit-test files are documented stubs. The toolchain builds, but there is no tracking, gameplay, DSP, companion server or benchmark harness yet. This documentation pass makes those systems precise enough to build and verify; it does not claim they are implemented.

Start with the **[build roadmap](ROADMAP.md)** for exact implementation order, dependencies, commit-sized tasks and acceptance gates. The **[docs index](docs/README.md)** links every subsystem contract. Contributors: [AGENTS.md](AGENTS.md).

## What should make it memorable

- A live neon reflection appears before play; the player immediately understands that the webcam sees their movement.
- A slash splits a block along the swing plane; a punch releases shards; a held point fires a charged beam. Each gesture has its own readable payoff.
- Beats, drops and quiet passages shape the map and the arena. The generator must pass onset, silence and playability checks before an uploaded song is called ready.
- The demo ends with real results and a **2.5D** silhouette highlight. The movement-energy number is a playful estimate, never measured exertion or calories burned.
- The technical story is backed by repeatable evidence: fixed-seed replay, live-camera checks, frame-time percentiles, tracking freshness and musical-quality evaluation. Targets are not results. See [24 — Benchmark & Evidence](docs/24-benchmark-and-evidence.md).

## Run the scaffold

Use Node **22.12+** on the Node 22 line used by CI; `app/package.json` declares a broader `>=20.19` range. A desktop Chrome/Edge build, WebGL2 and a webcam will be needed for gameplay. Compatibility is established by the P0 capability checks, not by an untested minimum browser version.

From the repository root:

```powershell
cd app
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). **The current page is an empty scaffold**, not the proposed BOOT or Song Select screen.

Checks, from `app/`:

```powershell
npm run check
```

This runs typecheck, lint, Vitest and the production build. Vitest currently discovers ten placeholder files and executes **zero tests**. A successful command verifies the scaffold toolchain only.

From the repository root, check documentation paths and heading fragments:

```powershell
node --test scripts/check-docs.test.mjs
node scripts/check-docs.mjs
```

## Asset preparation and future commands

The existing model downloader can prepare the runtime files after dependencies are installed:

```powershell
cd app
npm run models
```

It copies the installed MediaPipe WASM and downloads model files once; network access is required for the download. The script currently uses upstream `latest` model URLs and size-based reuse. P0 must add pinned model checksums and an asset manifest before calling an offline build reproducible. Do not claim that running this script makes the stub game work.

- `npm run build` / `npm run preview` in `app/`: create/serve the scaffold production bundle; preview uses [localhost:4173](http://localhost:4173).
- `npm run beatmaps` in `app/`: **placeholder; deliberately exits with an error**. The real generation command is a P2 task.
- `npm run server` in `server/`: invokes the current empty companion entry point and exits. The optional service is a future `[POLISH]` feature, specified in [23](docs/23-youtube-companion-service.md).
- No environment variables or API keys are needed. Browser upload and the eventual bundled tracks are the primary audio paths.

## Build and verification

The [roadmap](ROADMAP.md) has six capability gates: foundations → first playable → complete core → signature spectacle → measured optimization → release proof. There is no inherited event timetable, fixed team size or permanent folder ownership.

The proposed stack is TypeScript, Vite, imperative Three.js, `postprocessing`, React/Zustand for the DOM overlay, MediaPipe Hands/Pose in a worker, Web Audio and a deterministic DSP worker. [02 — Architecture](docs/02-architecture.md) defines identifiers and contracts; [03 — Decisions](docs/03-decisions.md) explains tradeoffs. The present `app/`, `server/`, `scripts/` and `assets-src/` paths are implementation starting points and may evolve with the docs.

Targets such as 60 FPS, fresh ≥24 Hz tracking and sub-four-second analysis of a defined three-minute input are **unmeasured goals**. Only the controlled protocol in [24](docs/24-benchmark-and-evidence.md) can support performance claims. Webcam, human usability, music-quality and offline validation remain pending.

## Sources and licenses

- [Three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE) — MIT; [postprocessing](https://github.com/pmndrs/postprocessing/blob/main/LICENSE.md) — Zlib.
- [React](https://github.com/facebook/react/blob/main/LICENSE), [Zustand](https://github.com/pmndrs/zustand/blob/main/LICENSE), [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) — MIT.
- [MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) — Apache-2.0 for the project; record the separate model terms, model versions and hashes in the P0 asset manifest. [Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) documents the synchronous inference API used by the proposed worker.
- [Web Audio](https://www.w3.org/TR/webaudio/) supplies the master clock; [getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp) maps audio output to performance time. See [15](docs/15-audio-playback-sync.md) for the project's clock contract.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#license) is an optional future companion dependency; its source is Unlicense, with distribution-specific third-party notices. It is not required for core gameplay.
- No demo songs, reference corpus, generated GLBs or fonts have been committed. Add exact source URLs, licenses and credits before bundling them; [track attribution](app/public/assets/tracks/README.md) is the registry. Do not assume a public download implies permission to redistribute it.

Project code is MIT: [LICENSE](LICENSE). Development history: [CHANGELOG.md](CHANGELOG.md). AI contributions: [AI_USAGE.md](AI_USAGE.md).

## Submission

There is no playable release or submitted demo yet. Actual event rules, deadline, submission channel and participant roster have not been supplied. Add them when confirmed.

P5 produces a tested release commit/tag, clean-clone run record, actual demo URL/recording, benchmark evidence, manual QA record, music credits and known limitations. Record the tested release SHA here then; do not substitute a scaffold SHA or a planned feature list for release evidence. The [demo script](docs/20-demo-and-judging.md) and [release checklist](docs/19-build-plan.md#release-checklist) define that handoff.
