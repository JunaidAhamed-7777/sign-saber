# Scripts

| Script | Purpose | When |
| --- | --- | --- |
| [`download-models.mjs`](download-models.mjs) | Existing: copies MediaPipe WASM and downloads models into `app/public/models/`. Run `npm run models` from `app/`; optional `--with-segmenter`, `--force`. Uses upstream `latest` URLs and size-based reuse today. | P0 must add fixed versions, checksums and an asset manifest before claiming reproducibility. |
| [`check-docs.mjs`](check-docs.mjs) | Existing: `node scripts/check-docs.mjs` from the root checks local Markdown targets and heading fragments; broken links fail with exit code 1. No network requests. | Documentation changes and CI. |
| [`check-docs.test.mjs`](check-docs.test.mjs) | Existing: `node --test scripts/check-docs.test.mjs` verifies link/fragment handling and failure exit status. | When modifying the checker and in CI. |
| [`render-sfx.mjs`](render-sfx.mjs) | Existing: `node scripts/render-sfx.mjs` from the root renders every synthesized SFX (full and Calm) at 48 kHz through the exact `app/src/audio/sfxSynth.ts` recipes and prints peak, loudness and centroid. `--out <dir>` writes float WAVs for listening, `--ffmpeg` cross-checks loudness with ffmpeg's `ebur128`, `--receipt` rewrites `assets-src/audio/sfx-receipt.json`, `--check` fails if renders differ from the receipt. Needs the installed `app/` TypeScript. | After changing SFX recipes or loudness targets; the receipt is verified by `app/tests/sfxSynth.test.ts`. |
| `generate-beatmaps.mjs` | Planned P2 tool; file does not exist. Replace `npm run beatmaps` only after implementing generation, validation and attributed content. | [Beatmap format](../docs/09-beatmap-format.md). |
| Fixture recorder/replay | Planned P0/P1 implementation and instructions; no recorder tool exists yet. | [QA](../docs/17-testing-and-qa.md) and [evidence protocol](../docs/24-benchmark-and-evidence.md). |

Existing scripts are plain Node ES modules; the checker/tests need no installed packages. The model downloader needs the installed `app/` MediaPipe package and network for downloads. The checker supports ordinary inline/reference links and Markdown heading fragments, ignores fenced/inline code and skips dependency/build trees; it does not validate remote URLs or runtime claims. See [ROADMAP.md](../ROADMAP.md) for implementation order.
