# Scripts

The game ships with tools for reproducible assets, chart/audio inspection and real production-browser QA. Run the commands below from the repository root unless a row says `app/`. Use Node 22+ and install `app/` dependencies first for tools that import the application's TypeScript or MediaPipe package.

## Prepare and inspect content

| Command | What it does |
| --- | --- |
| `npm run music` in `app/` | [Acquires the eight credited songs](acquire-starter-music.mjs) and records source/license/hash information. Network is required for downloads. |
| `npm run beatmaps` in `app/` | [Generates all bundled difficulty charts](generate-beatmaps.mjs) using canonical ffmpeg/ffprobe decoding and the app's DSP, assignment and validation modules. Regenerates map hashes and receipts; review generated changes together. |
| `npm run fonts` in `app/` | [Acquires the pinned local fonts](acquire-fonts.mjs) and their license files. Network is required for acquisition. |
| `npm run models` in `app/` | [Prepares local tracking models/WASM](download-models.mjs). Models use pinned revisions, size plus SHA-256 verification, format checks and atomic replacement; the script writes `asset-manifest.json`. Optional `--with-segmenter` and `--force` flags apply to the script. |
| `node scripts/chart-report.mjs` | [Reports every installed chart](chart-report.mjs): gesture mix, walls, note density, maximum on-screen load and synthetic-performer reachability. Reads assets without changing them. |
| `node scripts/check-model-assets.mjs` | [Validates authored GLBs](check-model-assets.mjs), including actual buffers, axes, pivots and manifest hashes. |
| `node scripts/render-sfx.mjs --check` | [Renders the exact SFX recipes](render-sfx.mjs) at 48 kHz and checks them against the retained receipt. `--out <dir>` exports float WAVs, `--ffmpeg` cross-checks loudness and `--receipt` deliberately rewrites the receipt. |

Chart reachability, waveform measurements and asset integrity each prove their named boundary; none is a live-camera or human musical-quality result.

## Verify the app and documentation

- `npm run check` in `app/` runs typecheck, lint, asserted tests, production build and [JavaScript bundle limits](check-bundle.mjs). `npm run preview` serves the prepared build through [serve.mjs](serve.mjs).
- `node --test scripts/check-docs.test.mjs` tests the documentation checker; `node scripts/check-docs.mjs` validates local Markdown targets and heading fragments. No network requests are made. Remote URLs, screenshots and runtime claims require separate inspection.
- `node scripts/check-audio-resampling.mjs` runs numeric browser audio checks; add `--arrangement` for edited-audio checks. Requires Chrome and ffmpeg. It does not measure audible synchronization or physical latency.
- `node scripts/check-tracking-init.mjs` probes worker/model startup after tracking models and a production build are prepared. `--cpu` requests the CPU delegate. It submits synthetic blank images rather than webcam frames.

## Exercise the production browser

[`lifecycle-qa.mjs`](lifecycle-qa.mjs) builds the production app and drives eight independent failure/lifecycle scenarios with real native UI actions. It checks original synthesized audio, actual results and native retained-resource counts across 20 cycles. Dated JSON/Markdown reports preserve source and environment; incomplete evidence fails the run. Chrome and installed `app/` dependencies are required.

```powershell
node scripts/lifecycle-qa.mjs
```

Use `--scenario <names>` for a selected subset; a partial run is not the complete gate. [`lifecycle-helpers.test.mjs`](lifecycle-helpers.test.mjs) tests WAV provenance, resource-growth gates, incomplete-report rejection and cache-failure helpers.

[`release-drill.mjs`](release-drill.mjs) checks clean-commit installation and a real camera-free offline production journey. It creates isolated temporary state and records what it actually tested:

```powershell
node scripts/release-drill.mjs
```

[`capture-readme.mjs`](capture-readme.mjs) captures actual auto-play media from a running production preview using trusted CDP clicks. The [media guide](../docs/media/README.md) documents capture and extraction commands, source attribution and limits. It never fabricates scores or game state.

Prepared-photo inference uses the separate [dataset-camera preparation](prepare-dataset-camera.mjs) and [trial](dataset-camera-trial.mjs) tools. Those require attributed COCO source data, ffmpeg/ffprobe, Chrome and local tracking models. Still photos are distinct from the annotation menu trial and from a live person. A consented webcam-fixture recorder remains planned; no recorder command is advertised.

See [Testing & QA](../docs/17-testing-and-qa.md), [Benchmark & Evidence](../docs/24-benchmark-and-evidence.md) and [ROADMAP.md](../ROADMAP.md) for acceptance and remaining gates. Keep actual results, failed outcomes and target budgets separate.
