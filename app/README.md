# Sign Saber web client

Vite, TypeScript, Three.js, React and Zustand. See the [root README](../README.md) for the current dataset-first workflow and [architecture](../docs/02-architecture.md) for contracts.

From this folder, run `npm ci` then `npm run dev`. The menu browses local music without a camera. Enable sound, choose a track and use **Try level with dataset**; it builds a real short arrangement and clearly labels its static annotated-pose source. No model inference or webcam accuracy is implied.

- `npm run check`: strict typecheck, ESLint, asserted Vitest suites and production build.
- `npm run format:check`: source formatting; generated assets/raw evidence are excluded to preserve hashes.
- `npm run build` / `npm run preview`: prepared loopback build at [127.0.0.1:4173](http://127.0.0.1:4173).
- `npm run models`: pinned/hashed optional MediaPipe preparation before a camera-capable offline build.
- `npm run beatmaps`: real shared-DSP bundled-map generator; requires ffmpeg.
- `npm run music` / `npm run fonts`: verify/reacquire documented pinned source assets.

All three full songs, nine maps, local fonts, six Blender-authored GLBs and attributed dataset annotations are packaged. Source photos and raw camera pixels are not distributed. Native camera setup and gameplay human/performance acceptance remain separate open gates. See [the roadmap](../ROADMAP.md) and [evidence protocol](../docs/24-benchmark-and-evidence.md).
