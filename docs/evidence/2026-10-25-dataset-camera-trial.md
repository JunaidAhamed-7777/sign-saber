# Dataset camera trial — 2026-10-25

**Scope.** Attributed COCO 2017 CC-BY still photos fed through the **unchanged live camera path** (video element, rVFC, ImageBitmap crop, tracking worker, MediaPipe hands + pose + mask, upper-body masking, filters, calibration, gestures, capture-time judgement). Two input routes: the app's labelled canvas `MediaStream` ("Dataset camera — not a webcam", lane `dataset-camera`) and Chrome's fake capture device fed a Y4M of the same photos, which the page's own `getUserMedia` receives as a webcam (harness lane `chrome-fake-webcam-dataset`; the page reports `live-camera-unverified`). **None of this is webcam, human, motion, latency or release evidence.** Still photos contain no swings, so no gameplay hits are expected or claimed.

## Commands

```powershell
node scripts/prepare-dataset-camera.mjs --coco <training/data/coco2017>
node scripts/dataset-camera-trial.mjs --lanes sweep,in-app --tag apriori
node scripts/prepare-dataset-camera.mjs --coco <training/data/coco2017> --calibration-from docs/evidence/2026-10-25-dataset-camera-apriori-sweep-app-evidence.json
node scripts/dataset-camera-trial.mjs
```

Raw records: [a-priori run](2026-10-25-dataset-camera-apriori-trial.json) with its [sweep app evidence](2026-10-25-dataset-camera-apriori-sweep-app-evidence.json); [final run](2026-10-25-dataset-camera-trial.json) with app evidence for the [sweep](2026-10-25-dataset-camera-sweep-app-evidence.json), [in-app](2026-10-25-dataset-camera-in-app-app-evidence.json) and [fake-webcam](2026-10-25-dataset-camera-fake-webcam-app-evidence.json) lanes. Screenshots: [in-app setup preview](2026-10-25-dataset-camera-in-app-setup-preview.jpg), [fake-webcam setup preview](2026-10-25-dataset-camera-fake-webcam-setup-preview.jpg).

## Environment and an important confound

Windows 11 (10.0.26300), AMD Ryzen 9 5900HX (16 logical CPUs), 16 GB RAM, AMD Radeon RX 6600M + integrated Radeon, headful Chrome 155.0.8059.86 at 1440×960, production build served on loopback, Node 26.8.1. Final-run tree: `e2221c3` plus uncommitted harness edits (recorded `dirtyTree: true`).

**The machine was saturated by unrelated work** (a 9-epoch COCO+MPII training run, two Blender instances and other agents' Chrome instances). Whole-machine CPU was 52–100% busy *before* each lane launched and 98–100% during lanes. Every timing below is contaminated by that load and must not be read as this game's performance.

## Reel

24 photos chosen by declared rules from 21,040 indexed CC-BY people (131 candidates): nose and shoulders visible; elbows, wrists and hips labelled; upright, camera-facing, frontal; one prominent person (official annotations checked for overlapping people/crowds); 16:9 head-to-hips crop inside the image with shoulder width 0.15–0.26 of frame width; ≥ 240 px source crop height; seeded order (seed 20261025). Crops are 1280×720 JPEGs in the ignored `app/public/dataset-camera/`, each with its Flickr URL, licence, crop and keypoints in the manifest. The Y4M fake webcam was 640×360 at 30 fps (1.71 GB temporary file, 160 s loop: calibration photo 45 s, then 5 s per photo).

## Results

| Check | Outcome |
| --- | --- |
| Canvas `MediaStream` → live pipeline | **Works.** GPU delegate in every lane; rVFC, bitmap, worker and results flowed from the canvas stream. 30 fps 1280×720 track settings. |
| Chrome fake webcam → unmodified `getUserMedia` | **Works** to preview: permission auto-granted by the harness flag, GPU preview, framing ready after 18 s. |
| Pose detection, 24 photos (sweep) | 24/24 photos detected in ≥ 50% of attributed frames. |
| Joint error vs annotation (sweep, per-photo means, shoulder widths) | Median of photos' mean labelled-joint error **0.118**. Per-joint medians: nose 0.055, shoulders 0.079–0.083, elbows 0.094–0.101, wrists 0.103–0.115, hips 0.172–0.193. PCK@0.5: 1.0 for head/shoulders/left limbs, 0.958 right elbow, 0.833 right wrist, 0.917 hips. Earlier sweeps gave 0.119/0.123. |
| Hand detection (sweep) | ≥ 1 hand on 16/24 photos, two hands on 9/24 (≥ 50% of frames). |
| Handedness (`HAND_LABEL_MAPPING`) | Old `raw-selfie-swap-v1`: 48/596 and 27/352 matched hands agreed with the annotated anatomical wrist. **Fixed** to `raw-model-label-v2`: 442/484 and 369/393 agree (91–94%). Two photos remain mixed. Still photos of other people, not a live labelled-hand check. |
| Gesture classifications (sweep, processed pipeline) | Mostly `none`; `fist` 8 frames (one photo), `open` 3 frames in an earlier sweep, `point` never. No gesture labels exist for these photos, so this is not accuracy. |
| Calibration with the declared-rule photo | **Failed as expected:** that photo yields one detected hand in every frame, so framing (both hand slots seen) never became ready in 30 s. |
| Calibration with the measured photo | The photo with the best measured two-hand rate (`coco-444854`, 100% two hands) became framing-ready, but **Confirm was not accepted** in 6 clicks (in-app) and 3 setup rounds (fake webcam). |
| Hidden tab during setup | Visibility went `hidden` → `visible`; reel and capture paused and resumed; no camera error. |
| Play to Results, pause/resume, retry, camera off | **Not reached** in the final run because calibration was never accepted under this load. Setup Cancel ran after each refused calibration and left SELECT usable. |

## Why calibration was refused (real finding, load-dependent)

Under the load above, worker inference was 177–429 ms per frame (p50 177 ms sweep, 211 ms in-app, 194 ms fake webcam) and tracking ran at 2.6–5.5 Hz. The pipeline rejects samples older than `INPUT_MAX_AGE_MS` (250 ms), and `fresh()` additionally needs the newest accepted sample to be younger than 250 ms at the instant of Confirm/Start. With results every 200–400 ms that are already ~200 ms old on arrival, freshness held only briefly, so the visible Confirm button (updated at `UI_TEXT_HZ`) was often stale when clicked; the in-app lane processed only 67 of 171 returned results. The runtime previously ignored such a click silently; it now shows the existing "Keep your shoulders and both hands in the guide…" status. The gating semantics were not changed.

Two further load-dependent failures were observed: the cold first GPU result exceeded the 15 s `TRACK_FIRST_RESULT_TIMEOUT_MS` on the first setup in a fresh profile (an exploratory headful run and the retained a-priori sweep; the immediate retry succeeded), and one sweep ended with the 1 s steady-state stall watchdog. On this machine earlier the same day under lighter load, an exploratory, unretained headless sweep ran at ~8 Hz with 128 ms inference. None of these numbers support a performance claim either way; the trial must be repeated on an otherwise idle machine before judging the live path's speed.

## What remains

- Repeat the full lane (calibrate → Start → count-in → play → pause/resume → Results → Retry → Songs → camera off/cancel) on an idle machine; the harness implements every step and retries guarded clicks like a persistent user.
- A consenting live labelled-hand check for `raw-model-label-v2`.
- Still photos never produce swings; a rendered performer reel (`DatasetReel` driven by song time) is the planned way to exercise hits through the camera path.
