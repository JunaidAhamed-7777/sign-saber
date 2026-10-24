# Sign Saber

**Your upper body is the controller. The music builds the arena.**

Sign Saber is an experimental browser rhythm game with a camera-free music menu, head-to-hips figure, local song analysis and a Three.js arena. **The current priority is a clearly labelled dataset trial.** Camera-free playback, an actual 80-second arrangement and genuine trial results have been exercised in the browser. Live calibrated gesture play, held-out music quality and P4/P5 release evidence remain open.

The current checkpoint and remaining work are in [HANDOFF.md](HANDOFF.md). Start with [ROADMAP.md](ROADMAP.md), [the subsystem index](docs/README.md), [DESIGN.md](DESIGN.md) and [AGENTS.md](AGENTS.md). The user's current scope excludes legs everywhere: placeholder, tracked input, live/setup view, pause and saved results.

New here? Read the [Player guide](docs/player-guide.md) for setup, moves and no-camera trials, [Troubleshooting](docs/troubleshooting.md) for exact error messages and recovery, or the [Contributor guide](docs/contributor-guide.md) for code flow, checks and evidence rules.

## Run

Use a current Node 22 release (CI baseline) or the locally exercised Node 26.8.1/npm 12.2.1. From the repository root:

```powershell
cd app
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). The initial menu requests no camera or models. The three songs, charts, fonts, dataset annotations and Blender assets are local repository files.

1. Choose Pamgaea, Electro Cabello or Cipher.
2. Choose **Enable sound** with mouse/keyboard.
3. **Try level with dataset** automatically builds the short cut; **Make 80-second cut** (the next right-rail page, Music options) also lets you prepare it separately. The engine renders 10 seconds fading in, a 60-second energy/onset-supported highlight and 10 seconds fading out, then generates a fresh chart from the edited WAV. Short admitted files disclose proportionally shorter sections. This is a musical heuristic, not verified chorus detection.
4. Choose **Try level with dataset**. A visible banner identifies independent, attributed COCO still annotations. They contain no recorded movement, hand gestures, metric depth or masks; missing gesture input produces real misses. The browser trial reached actual results with 131 Miss and zero invented hits.
5. Esc/Space pauses. Resume, Retry and Songs use the same guarded lifecycle. Difficulty and preview sit on the first ready page; further side-rail pages expose the cut, volume, appearance, menu hand, credits and optional live-camera controls. Windows at or below 1099 px wide or 699 px tall reflow the rails above and below the figure instead of covering it.

All three full original songs remain available. The arrangement uses one continuous source window with raised-cosine amplitude fades, avoiding hard joins. It retains exact source/sample/fade bounds and original/new hashes; the old chart is never reused under edited audio. User audio upload is local, bounded and cancellable.

## Prepared local build

```powershell
cd app
npm run build
npm run preview
```

Open [127.0.0.1:4173](http://127.0.0.1:4173). The loopback-only server applies response CSP to documents and workers and serves local audio ranges/WASM. Dataset play needs no model download, account, upload, companion service or external network. A prepared offline venue exercise and all P5 failure drills have not been completed.

## Optional camera path

Prepare pinned MediaPipe assets before building a camera-capable offline bundle:

```powershell
cd app
npm run models
npm run build
```

Camera setup lives in Settings, independently of song choice. It requires a deliberate native permission action and labelled positioning preview; matching calibration is required for live Start. Head/shoulders/hands/hips must be visible. Only head, arms/hands and torso through hips are retained/displayed. The upstream pretrained pose network may internally infer legs, but application outputs, masks and recordings exclude them. Raw camera pixels stay local; the dependency's disclosed metrics attempts are blocked by the prepared server's same-origin response policy.

Bounded buffers, capture-time scoring, palm-to-point menu navigation, gesture hysteresis, charge, torso walls and recovery are implemented. Native camera setup reached GPU preview and Cancel retained browsing. **No consenting person has yet completed matching calibration or a verified live scored hit.** Dataset/synthetic evidence cannot establish webcam accuracy, handedness or latency.

## Assets and content

- [Starter music registry](app/public/assets/tracks/README.md): full Pamgaea, Electro Cabello and Cipher by Kevin MacLeod, unchanged CC-BY 4.0 MP3s, exact credits/acquisition receipts, measured metadata, nine maps and hashes. All three currently disclose low-tempo-confidence/onset-only timing.
- [Blender pack](app/public/assets/models/README.md): six original MIT GLBs authored through the official Blender MCP local bridge, plus [saved source and build notes](assets-src/blender/README.md). Actual pack: 3,320 triangles / 194,488 GLB bytes, independent geometry checks and zero-error/warning Khronos reports. Cell Fracture is unavailable, so eight complete shards are explicit. The arena leaves the central upper-body stage clear.
- [Local fonts](app/public/assets/fonts/README.md): pinned Orbitron and Rajdhani with OFL notices.
- [Dataset attribution](app/public/assets/fixtures/ATTRIBUTION.txt): eight actual independent COCO upper-body annotations; source photo pixels are not bundled.

Rendering includes pooled authored/fallback geometry, exact capped swing-plane halves, smash fragments, beam reticles/lines, visible wall cues, owned saved/frozen upper bodies and actual audio-reactive emission. Calm preserves the gameplay rules. Human comfort, contrast/flashing, full layout/zoom and GPU/resource-soak acceptance remain pending where not specifically recorded.

## Checks and reproducibility

From `app/`:

```powershell
npm run check
npm run beatmaps
```

`check` runs typecheck, lint, asserted Vitest suites and production build; it no longer permits empty test suites. The integrated worktree passed 250 assertions. `beatmaps` is a real shared-DSP generation/validation command and requires ffmpeg for canonical PCM. Bundled MP3 iTunSMPB trim is honoured before analysis; browser source-zero/resampling checks caught and corrected real errors.

From the root:

```powershell
node --test scripts/check-docs.test.mjs
node scripts/check-docs.mjs
node --test scripts/serve.test.mjs
node --test scripts/check-model-assets.test.mjs
node scripts/check-model-assets.mjs
node scripts/check-audio-resampling.mjs
node scripts/check-audio-resampling.mjs --arrangement
```

The browser numeric harness requires Chrome (or `BROWSER_BINARY`) and ffmpeg; its retained JSON separates numeric audio correctness from audible sync/webcam evidence. The static server's symlink test is skipped on this host because symlink creation is unavailable. No 60 FPS, tracking-rate, generator-speed, musical-F1 or motion-to-photon target is claimed as measured success. [24](docs/24-benchmark-and-evidence.md) defines release proof.

`npm run music` / `npm run fonts` verify/reacquire the pinned local source assets when explicitly needed. Generated map JSON must not be reformatted without updating hashes. The optional `server/` companion remains outside the core implementation; no working companion command is advertised.

## Model research

[Training notes](training/README.md) distinguish downloaded/licensed data, a real RGB training preflight and full training. New weights are not promoted into the game. The brief CPU preflight's validation loss worsened; exporting a numerically matching ONNX file is not proof of accurate tracking. Raw datasets, environments and research checkpoints remain local/ignored.

## Sources and licenses

Code and original authored geometry are [MIT](LICENSE). Music retains CC-BY terms and fonts retain OFL terms; their notices are packaged separately. The locked runtime uses [Three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE), [React](https://github.com/facebook/react/blob/main/LICENSE), [Zustand](https://github.com/pmndrs/zustand/blob/main/LICENSE), [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) and [postprocessing](https://github.com/pmndrs/postprocessing/blob/main/LICENSE.md). MediaPipe's project is [Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE); model pins/terms are recorded with the model preparation sources. The game uses Web Audio's output clock; procedural fallback SFX are original generated buffers.

## Submission

This is a work in progress, not a declared P5 release. Actual event/team/submission details, a public deployment, human trials, complete performance evidence and demo recording are not supplied or complete. No release SHA/tag is asserted. [CHANGELOG.md](CHANGELOG.md) records tested checkpoints and actual limitations; [AI_USAGE.md](AI_USAGE.md) records AI contributions. The [demo protocol](docs/20-demo-and-judging.md) and [release checklist](docs/19-build-plan.md#release-checklist) remain the acceptance standard.
