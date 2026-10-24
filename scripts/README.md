# Scripts

| Script | Purpose | When |
| --- | --- | --- |
| `download-models.mjs` | Copies MediaPipe WASM from `node_modules` and downloads the `.task` models into `app/public/models/`. Run via `npm run models` from `app/`. Flags: `--with-segmenter`, `--force`. | Before the event, and whenever `@mediapipe/tasks-vision` is upgraded |
| `generate-beatmaps.mjs` | (H3) Runs the beatmap generator in Node for each bundled track and writes `easy/normal/hard.json`. See docs/09-beatmap-format.md §Bundled tracks. | After adding or re-tuning bundled tracks |
| `record-fixture.md` | (H0.5) Notes on recording `TrackingFrame` fixtures from the dev overlay. See docs/17-testing-and-qa.md §Fixtures. | During setup |

Scripts are plain Node ES modules with no dependencies beyond what `app/` installs.
