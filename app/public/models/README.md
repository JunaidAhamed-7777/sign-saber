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

Loaded by `src/tracking/tracking.worker.ts` via `FilesetResolver.forVisionTasks('/models/wasm')`. Run the script before the event so BOOT succeeds with the network disconnected (ADR-013).
