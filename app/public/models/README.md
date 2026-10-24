# MediaPipe runtime assets

Run `npm run models` from `app/` to prepare the local tracking runtime. Model files and copied WASM remain git-ignored. A clean checkout needs this preparation once with network access; the menu does not request permission or initialize models at launch. Missing assets leave music browsing usable and camera setup reports a failure.

The downloader uses immutable revision **1** URLs and SHA-256 pins from [model-assets.mjs](../../../scripts/model-assets.mjs). It verifies every reused file; downloads are validated before atomic replacement. The installed lockfile supplies `@mediapipe/tasks-vision` **1.1.1** and its WASM, including the module runtime needed by the module worker. The generated `asset-manifest.json` records runtime/package version, source URLs, bytes, checksums and license references. The generated Apache license is copied from [the retained upstream license](../../../scripts/MEDIAPIPE-LICENSE.txt).

```text
public/models/
├── wasm/                         locked package runtime, including module WASM
├── hand_landmarker.task          float16 revision 1
├── pose_landmarker_lite.task      float16 revision 1, segmentation enabled
├── asset-manifest.json           measured bytes and SHA-256
├── LICENSE-APACHE-2.0.txt
└── selfie_segmenter.tflite       optional acquisition; --with-segmenter
```

Hand and pose model cards explicitly identify Apache 2.0 licensing: [Hand Tracking](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf), [BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf). Upstream project source: [MediaPipe](https://github.com/google-ai-edge/mediapipe).

The worker initializes separate hand and pose task canvases, tries GPU then CPU, mirrors normalized coordinates/mask once, and transfers owned buffers through a bounded two-slot transport. Live camera/GPU throughput, anatomical handedness and segmentation quality still require hardware validation; synthetic tests and successful asset preparation do not prove them. The default label adapter swaps the raw-image model label for the selfie convention and must be checked with a labelled right-hand fixture. Calibration records the camera/crop/mapping identity.

The retained pose is **head, arms/hands and torso through the hips**. The normative 33-landmark buffers keep their lengths; indices 25–32 are zeroed and never copied into app-owned pose state, fixtures or recordings. The segmentation mask fades out above the actual hip line, including tilt, and hides if usable hips are missing. Calibration requires head/hip visibility. The pretrained upstream pose model can still infer lower limbs internally; this output restriction does not claim retraining or reduced inference work.

The installed module loader clears its factory after creating each task. Each public `WasmFileset.wasmLoaderPath` therefore has a stable per-task/delegate query (`?task=hands-GPU`, `?task=pose-GPU`, and CPU equivalents), so the browser evaluates each loader while using the same pinned WASM binary. Vite serves `/models/` before transforming SDK dynamic-import requests. This avoids unsupported SDK-global patches.

The installed package says input images/video stay on device, but API utilization/performance telemetry may be sent to Google. The bundle includes `https://odml.pa.googleapis.com/v1/log`; there is no documented option to disable telemetry in its public TypeScript API. The [upstream privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice) and [maintainer discussion](https://github.com/google-ai-edge/mediapipe/issues/6306) explain this distinction.

Sign Saber's [prepared local server](../../../scripts/serve.mjs) and Vite dev/preview responses apply a Content Security Policy with `connect-src 'self'` to the application **and dedicated worker scripts**. This blocks outbound dependency telemetry attempts while permitting local model/WASM/audio requests. Development additionally allows the local Vite HMR socket. The application does not change unsupported MediaPipe internals. A browser may log a blocked-request CSP message; it is not a successful network transmission. Other hosts must preserve the same response policy, especially on worker responses. An HTML meta policy alone must not be assumed to protect a dedicated worker.

HTTP tests verify the prepared response policy, byte ranges, MIME types and path boundaries. Browser enforcement, prepared offline operation and real tracking remain separate release checks under [the roadmap](../../../ROADMAP.md) and [tracking specification](../../../docs/05-tracking-pipeline.md).
