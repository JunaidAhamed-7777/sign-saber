# MediaPipe runtime assets

Populated by `npm run models` (see `scripts/download-models.mjs`). Contents are git-ignored because they are large binaries that are reproducible from the script.

Expected layout after the script runs:

```
public/models/
├── wasm/                          copied from node_modules/@mediapipe/tasks-vision/wasm
│   ├── vision_wasm_internal.js
│   ├── vision_wasm_internal.wasm
│   ├── vision_wasm_nosimd_internal.js
│   └── vision_wasm_nosimd_internal.wasm
├── hand_landmarker.task           float16, 2 hands
├── pose_landmarker_lite.task      float16, segmentation-capable
└── selfie_segmenter.tflite        optional fallback (ADR-003), downloaded with --with-segmenter
```

The planned worker will load these via `FilesetResolver.forVisionTasks('/models/wasm')`; the worker is currently a stub. The downloader uses upstream `latest` URLs and checks existing files by size. During P0, pin model versions/checksums and record their terms plus the WASM package version in an asset manifest. During P5, verify a locally served production build with external network disabled; prepared files alone do not establish offline gameplay. See [ROADMAP.md](../../../ROADMAP.md) and [05](../../../docs/05-tracking-pipeline.md).
