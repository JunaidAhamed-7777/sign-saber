# Change log

Record each meaningful project change, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## Development log

Implementation and historical specification work are recorded below. Automated, dataset, browser-audio and live-camera evidence are identified separately.

## 2026-10-25T04:10:13+05:30 — Recheck issue #1 after the new renderer integration

- Changed: Normally merged main `cfdcc40` into the issue branch, retained both new controlled build/browser receipts, and updated docs16 with the current chunk table and actual first-load waterfall. No additional application code was needed; the existing groups still satisfy the budget with the new effects.
- Why: New renderer/postprocessing work landed before the PR. The final combined application needed fresh proof rather than relying on the earlier source.
- Validation: Full `npm run check` passed (typecheck/lint, 367 assertions/48 suites, build without the size warning, three budget regressions). The unsplit baseline still warns; current split bytes and gzip are below. Actual `npm run preview -- --port 4181` completed both source-labelled trials/results/Songs with empty runtime console/CSP logs. Root docs and source whitespace checks are rerun before this evidence commit.
- Limits: Tested application source `74325fa783b0fadac7a96d704f87a0abfe39b7ac`; evidence-only follow-up commit is separate. Browser evidence uses the same Chrome155/Windows/headless SwiftShader/Node26.8.1/cache-disabled/1440×900 loopback method as the earlier entry. Single busy-host runs establish topology and functionality, not performance gains or webcam success.

| Build | File | Raw bytes | Gzip bytes |
| --- | --- | ---: | ---: |
| Before | `generator.worker-B6OPcKR7.js` | 22449 | 9056 |
| Before | `index-ClNtYw27.js` | 1283738 | 383171 |
| Before | `tracking.worker-DeV5KsxN.js` | 160846 | 47741 |
| After | `generator.worker-B6OPcKR7.js` | 22449 | 9056 |
| After | `index-CqGRHEWt.js` | 441271 | 160410 |
| After | `react-CTym4sTV.js` | 218790 | 67563 |
| After | `rolldown-runtime-WkwZ5CU-.js` | 599 | 368 |
| After | `three-C_uIrsIZ.js` | 352336 | 84187 |
| After | `three-CqvON9a6.js` | 223814 | 59453 |
| After | `three-CvPEqDHz.js` | 48975 | 14256 |
| After | `tracking.worker-DeV5KsxN.js` | 160846 | 47741 |

| Build | Script | Request start → finish (ms) |
| --- | --- | ---: |
| Before | `index-ClNtYw27.js` | 4566.72 → 5096.78 |
| After | `index-CqGRHEWt.js` | 22.90 → 156.89 |
| After | `rolldown-runtime-WkwZ5CU-.js` | 23.41 → 33.26 |
| After | `react-CTym4sTV.js` | 23.49 → 165.22 |
| After | `three-CqvON9a6.js` | 23.55 → 177.13 |
| After | `three-C_uIrsIZ.js` | 23.65 → 212.36 |
| After | `three-CvPEqDHz.js` | 23.71 → 159.68 |

## 2026-10-25T03:57:05+05:30 — Split production JavaScript and enforce its budget (#1)

- Changed: `app/vite.config.ts` groups React and size-bounded Three.js modules through `build.rolldownOptions.output.codeSplitting`; the runtime remains unchanged. New dependency-free `scripts/check-bundle.mjs` reads emitted JS/worker bytes and gzip sizes, fails above the registered 500000-byte per-file limit, and rejects absent builds. `app/package.json` runs its parser/boundary/CLI tests and budget after build in `npm run check`. README documents the real command; [docs16](docs/16-performance-budget.md#bundle-size-budget) registers build-only limits and retained measurements.
- Why: Issue #1's original 1096061-byte main chunk exceeded Vite's warning. The menu arena still loads alongside the shell; splitting permits parallel static requests without changing lifecycle, asset fallback or CSP policy.
- Validation: The unchanged build warned and the budget command failed as expected. The controlled split build had no >500 kB warning, passed typecheck/lint/363 application assertions/build plus 3 budget tests, and completed actual `npm run preview -- --port 4181` runs: menu arena, arranged dataset results (131 Miss/0 hits), synthetic results (131 Perfect/0 misses), Songs after each, no runtime console errors/CSP log entries. After normally integrating latest main `1fa1827`, full `npm run check` passed again (363 application assertions, 3 budget tests, no build warning); the final main chunk is `index-D9QxVp5f.js` (254784 raw/79408 gzip bytes), with the other seven JS sizes unchanged. Root docs tests passed 2/2; 47 Markdown files/529 local links passed. Changed source formatting and `git diff --check` passed.
- Limits: Both controlled runs used source `ad41466990b7e62321b835c7261df4559dc53921` with dirty worktrees, Node 26.8.1, Windows, Chrome 155.0.8059.86/headless SwiftShader, fresh profiles, disabled browser cache, 1440×900/DPR1 and unthrottled loopback. Gzip is Node `gzipSync` default. Raw [before](docs/evidence/2026-10-25-bundle-before.json)/[after](docs/evidence/2026-10-25-bundle-after.json) requests and two corrected probe mistakes ([audio unlock](docs/evidence/2026-10-25-bundle-probe-failure.json), [HUD selector](docs/evidence/2026-10-25-bundle-probe-selector-failure.json)) are retained. No FPS, load-time, webcam or release-gate improvement is claimed. Initial dependency installation failed from a corrupt shared npm cache; bundled npm 11.19.0 with an isolated cache succeeded without changing the lockfile.

Measured emitted JavaScript table (bytes; source held constant for this comparison):

| Build | File | Raw | Gzip |
| --- | --- | ---: | ---: |
| Before | `index-tWIDsd3B.js` | 1096061 | 301973 |
| Before | `generator.worker-B6OPcKR7.js` | 22449 | 9056 |
| Before | `tracking.worker-DeV5KsxN.js` | 160846 | 47741 |
| After | `index-LlutNhgn.js` | 254379 | 79339 |
| After | `react-CTym4sTV.js` | 218790 | 67563 |
| After | `rolldown-runtime-WkwZ5CU-.js` | 599 | 368 |
| After | `three-B_2LwjzK.js` | 222990 | 59159 |
| After | `three-bq-AKiay.js` | 352349 | 84153 |
| After | `three-sRmNNit9.js` | 48975 | 14216 |
| After | `generator.worker-B6OPcKR7.js` | 22449 | 9056 |
| After | `tracking.worker-DeV5KsxN.js` | 160846 | 47741 |

Measured first-load script waterfall (CDP request start → finish, ms from document request):

| Build | Script | Start → finish |
| --- | --- | ---: |
| Before | `index-tWIDsd3B.js` | 23.50 → 43.26 |
| After | `index-LlutNhgn.js` | 17.73 → 65.61 |
| After | `rolldown-runtime-WkwZ5CU-.js` | 18.23 → 48.65 |
| After | `react-CTym4sTV.js` | 18.31 → 85.10 |
| After | `three-B_2LwjzK.js` | 18.50 → 67.75 |
| After | `three-bq-AKiay.js` | 18.58 → 95.75 |
| After | `three-sRmNNit9.js` | 18.65 → 104.17 |
## 2026-10-25T04:02:00+05:30 — wip: a-priori dataset-camera trial and measured calibration photo

- Changed: retained `docs/evidence/2026-10-25-dataset-camera-apriori-trial.json` and its sweep app evidence. The harness now retries camera setup once after an error (as a person would), shares one Chrome profile across lanes (first lane cold GPU program cache), records whole-machine CPU busy fractions and GPU adapters, exports app evidence when calibration framing fails, times the sweep from the accepted setup and saves JPEG screenshots. `prepare-dataset-camera.mjs --calibration-from <sweep evidence>` moves the photo with the best measured two-hand detection to the calibration slot and records the evidence hash plus the declared rule's own choice.
- Why: the a-priori calibration photo (declared annotation rule) yielded one detected hand in every frame, so the unchanged calibration (both hand slots seen) never became ready in 30 s — the same outcome as a player showing one hand. Cold first GPU inference exceeded the 15 s first-result deadline on the first attempt of each fresh profile; the retry succeeded.
- Validation: sweep under the new handedness mapping: 442/484 matched hands agree with annotated wrists; pose detected on 21/21 swept photos; median labelled-joint error 0.119 shoulder widths. Background CPU was 66% busy before launch and 99.9% during the lane (other workloads on the machine).
- Limits: timings are contaminated by unrelated machine load; still photos only; not webcam evidence.

## 2026-10-25T03:52:00+05:30 — Handedness adapter follows measured COCO wrist evidence

- Changed: `playerHandFromModel` now uses the pinned HandLandmarker label as the anatomical hand for raw, unmirrored input (`HAND_LABEL_MAPPING = 'raw-model-label-v2'`, also part of the calibration identity), replacing the unverified `raw-selfie-swap-v1` swap. Updated `tests/tracking.test.ts` and docs05 §2.3.
- Why: two dataset-camera sweeps (24 camera-facing COCO photos through the unchanged live path, headless and headful Chrome 155) matched detected hands to annotated anatomical wrists within 0.5 shoulder widths; the old swap disagreed for 548/596 and 325/352 matched hands. A wrong mapping assigns the player's right hand to the left cursor slot.
- Validation: tracking, camera and runtime suites 33/33 passed. The re-measured agreement under the new mapping is recorded with the trial evidence.
- Limits: still photos of other people, not a consenting live player; a labelled live-hand fixture is still required. Merged main at 2e35e2f (normal merge); under the current ~97% whole-machine CPU load two main-owned audio tests (`audioArrange`, `gapless`) intermittently hit vitest's 5 s timeout and pass when rerun alone.

## 2026-10-25T03:46:57+05:30 — Initial focus, camera-setup UI test and interface docs

- Changed: Calibration Confirm, Pause Resume (or Songs when resume is blocked) and Results Retry (or Songs) receive initial keyboard focus through a `Button` `autoFocus` option. Added a camera-setup rendering test (checklist from real presence flags, disabled Confirm, Cancel, no `<video>`, desktop and compact). README, docs14 and docs25 now describe the implemented ready page, cut page, HUD details, compact reflow bounds and new UI modules.
- Why: docs14 asks transitions to move focus to the primary available action; the setup subflow had no rendered-structure test; docs needed to match the shipped interface.
- Validation: Typecheck, lint and build passed; 335 of 336 assertions passed. The failing assertion is main's `tests/unit/gapless.test.mjs` “never trims a buffer…” timing out at ~5.3–7.8 s against the 5 s limit while the machine CPU was at 100% (parallel training); it also failed in isolation under that load and is unrelated to UI files. Correction: the previous entry (“Ready page with performer action…”) claimed a passing check, but that run had the same two to three audio timeouts. Root docs tests passed 2/2; checker reported 47 files, 517 local links, 0 errors.
- Limits: Autofocus behaviour was not exercised with a screen reader or real keyboard-only session.

## 2026-10-25T03:46:00+05:30 — Watchable synthetic performer trial

- Changed: Added `performer/trial.ts` and a **Watch synthetic performer** action. The runtime drives the selected (arranged) chart with planned performer frames through the same tracking consumer, renderer, scoring and results as other sources, calibrates the performer's lean reference once it stands still, shows hand HUD state and exports evidence lane `synthetic-performer-logic-replay`. A source-aware `ui/trialCopy.ts` labels banner, status, setup, figure and results honestly for annotations versus performer.
- Why: The user wants to see whether the game works without a camera; the performer makes the full loop visible and exercises the runtime, renderer and results path with genuine hits.
- Validation: In the desktop app's embedded Chromium, Pamgaea → Enable sound → Watch synthetic performer built the 80-second cut and played with PERFECT judgements (screenshot during play: score 4,000, combo 18, accuracy 100%). Full `npm run check` passed.
- Limits: Planned synthetic landmarks only; no pixels, MediaPipe, webcam or human. The skeleton is still the line figure until the avatar branch lands.

## 2026-10-25T03:45:00+05:30 — Blender asset pack v2, glass block materials, HDR post FX and reactive arena

- Changed: `assets-src/blender/generate_assets.py` now authors a seeded 14-cell Voronoi fracture (bmesh bisect + hole fill, closed convex shards, centroid pivots, volume 1.0 m³), a new `block_shell.glb` (bevelled glass shell whose bevels carry a `Col` trim mask, plus a faceted inner core), chamfered relief glyphs (palm, fist and point with thumb relief, new directional `glyph_arrow`), a beam ring with inward aim chevrons and ticks, a pylon with plinth and lit crown, and a layered arena: octagonal player dais below y=0, lit rail channels and bass cross-channels, two light towers per side with lamp heads and speaker cabinets, speaker stacks between them, two overhead truss arcs, an unfogged distant skyline with window bands and a horizon halo. The manifest generator keeps foreign entries (for example a separately authored avatar) and recomputes totals over all entries. Added `render_asset_sheet.py` and a gameplay-camera `render_preview.py`. Runtime: `render/blocks.ts` adds instanced glass-shell, core, chamfer-shaded glyph and hot-cross-section shard shaders; `render/environment.ts` adds an antialiased shader floor grid with lane guides (replacing GridHelper), horizon glow, tier-sized dust and slew-limited band response (bass → floor/stage, mids → pylons/towers/truss, highs → skyline/dust); `render/postfx.ts` adds a half-float EffectComposer with mipmap bloom (tier intensity/levels/resolution), vignette, ACES tone mapping and SMAA/FXAA by tier, built only when half-float targets are renderable. Shatter shards flash white for `SHARD_FLASH_MS` (not in Calm) and glow on fracture faces. A development-only `render/devFx.ts` preview harness is excluded from production builds. New constants are appended to `core/constants.ts`.
- Why: The user asked for upgraded Blender models, a richer arena and premium but readable rendering.
- Validation: Two Blender MCP regenerations on a dedicated instance (port 9878); `node --test scripts/check-model-assets.test.mjs` and `node scripts/check-model-assets.mjs` pass (7 GLBs, 5,844 triangles, 341,428 bytes; Khronos validator not rerun). `npm run typecheck`, `lint`, `build` and `prettier --check` pass; vitest 316/317 pass — the one failure is main's `gapless` test timing out at 5 s under authoring load, unrelated to rendering. Docs checks pass. Native Chrome screenshots at 1440×900 of the menu and dataset trial were inspected.
- Limits: Blade ribbons, hand particles, hit sparks, camera response and slice-cap heat are not implemented yet. No GPU timing or flashing review was measured. The fracture is not Cell Fracture output.

## 2026-10-25T03:40:00+05:30 — wip: Blender-authored rigged upper-body avatar source

- Changed: Added `assets-src/blender/generate_avatar.py` (signed-distance primitives polygonised by surface nets, projected/relaxed, decimated; standard-named armature; bone-heat suit/hand weights, procedural head weights; vertex-colour face details; landmark anchors in armature extras), `render_avatar_preview.py`, the dedicated `signsaber_avatar.blend`, and the exported skinned `avatar.glb` with `avatar-manifest.json` (15,134 triangles, 507,252 bytes). Head, neck, torso to a closed hip finish, arms and five-digit hands only; no legs.
- Why: The user asked to replace the flat illustrative outline and thin skeleton lines with a real person model driven by tracked skeletons.
- Validation: Generated through the dedicated Blender 5.2.2 MCP bridge (port 9877); Workbench previews inspected for front/side/head/hand shape. Exported once; zero unweighted fallback vertices reported.
- Limits: Work in progress. Not yet consumed by the runtime; deformation poses, structural/Khronos validation and browser rendering are not yet checked.

## 2026-10-25T03:39:48+05:30 — Ready page with performer action and separate cut page

- Changed: After merging main's synthetic performer trial, the ready page pairs Enable sound/Preview with “Watch synthetic performer” (captioned, busy while a cut is prepared) above the primary dataset action; “Make 80-second cut” moved to its own Music options page with the arrangement explanation and status chip, and to a separate compact page. Side-rail pagers show position and dots only (the page heading names the page; the label remains for assistive technology). Narrow rails tighten the action pair so the ready page fits 1100×700 without scrolling.
- Why: Adding the performer button overflowed the ready page at 1280×720; the trial already prepares its own cut.
- Validation: `npm run check` passed (typecheck, lint, all assertions, build); compact ids in `uiPaging.test.tsx` updated. Measured rail pages without overflow at 1280×720 and 1100×700 in headless Chrome and inspected 1440×900/800×600 screenshots.
- Limits: Presentation-only; performer behaviour itself is main's work and was not re-verified here.

## 2026-10-25T03:34:38+05:30 — Opaque boot splash and arrangement source card

- Changed: BOOT is now an opaque void splash (hidden header, unwrapped wordmark, indeterminate bar); `index.html` shows a static pre-boot mark until React mounts and its description no longer claims full-body play. After an 80-second cut is prepared (which clears the bundled selection), the source song card is marked “Arrangement ready” and the ready header keeps the source cover/artist.
- Why: Screenshots showed a blank page before mount, a translucent boot overlay over the arena and no visible selection after a dataset trial returned to Songs.
- Validation: `npm run check` passed on rerun (two arrangement/gapless tests timed out once under parallel-agent CPU load, then all 324 passed); headless Chrome boot (held manifest), compact settings/calibration/HUD (1024×640, 800×600) and 1920×1080 HUD/return-to-songs screenshots were inspected.
- Limits: Presentation-only; no live camera or hand-navigation verification.

## 2026-10-25T03:34:00+05:30 — wip: dataset camera source, photo reel and judgement trace

- Changed: `tracking/camera.ts` now takes an injectable `CameraStreamSource` (`tracking/cameraSource.ts`): the default `WebcamSource` keeps the previous `getUserMedia` behaviour; `DatasetCameraSource` (`tracking/datasetCamera.ts`) streams a real `canvas.captureStream(CAM_REQ_FPS)` whose frames come from a pluggable `DatasetReel`. From the stream onward nothing changes (same video element, rVFC, ImageBitmap crop, worker, MediaPipe, calibration, judgement). `PhotoReel` (`tracking/datasetCameraReel.ts`) draws locally prepared, hash-pinned COCO CC-BY crops (bounded to current + one prefetched bitmap, closed on replacement) either synchronized to heard song time (`song`) or cycling by stream time (`?reel=sweep`). `DatasetCameraEvaluator` attributes captures to the drawn photo via a bounded draw timeline and reports per-photo pose/hand detection, MediaPipe-vs-annotation joint error normalized by shoulder width, wrist-handedness agreement and processed gestures. Enabled by `?camera=dataset` or the new SELECT Settings action **Use dataset camera**; labelled "Dataset camera — not a webcam" in statuses, header, banner and figure caption; evidence lane `dataset-camera`. New `core/judgementTrace.ts` `JudgementTraceRecorder` (typed bounded columns, emission order, explicit overflow/repeat counts, idempotent attach/detach, async SHA-256 excluding delivery timestamps) is attached by the runtime and exported with diagnostics (schema 2, now also calibration/results). `?stats=1` exposes a read-only `__signSaberDiagnostics` snapshot for automation. New `scripts/prepare-dataset-camera.mjs` (declared selection rules, ZIP-member reader, ffmpeg crop, manifest/attribution into ignored `app/public/dataset-camera/`), `scripts/cdp-client.mjs` and `scripts/dataset-camera-trial.mjs` (CDP-driven in-app, sweep and Chrome fake-webcam Y4M lanes). Registered the new constants in docs02.
- Why: the existing dataset trial bypasses the camera and MediaPipe; this lets dataset input exercise the real live path, and supplies the docs24 judgement-trace checksum.
- Validation: `npm run check` (typecheck, lint, 342 tests in 44 files, build) and prettier passed; `node --test scripts/prepare-dataset-camera.test.mjs` 5/5. Exploratory headless/headful sweep runs reached GPU preview through the canvas stream on all 24 photos (results to be recorded with the trial evidence).
- Limits: still photos are not a webcam, a person, motion or swings; no gameplay hit is expected. Reel pixels are local only. Work in progress: trial evidence, docs and handedness findings follow.

## 2026-10-25T03:28:35+05:30 — Song card status line, upload heading and live-start label

- Changed: Loading/failed status now replaces the song card's meta line (no title truncation); the selected card shows a compact check badge. The upload page uses its own heading with a visually hidden input label, the live camera action reads “Start live play”, and the decorative keyboard glyph was removed from native-only notes.
- Why: Screenshot review showed the right-column status tag squeezing titles and duplicate upload headings.
- Validation: `npm run check` passed (324 assertions, build); headless Chrome screenshots of a blocked-audio failure, settings pages and credits at 1440×900 and 800×600 were inspected.
- Limits: Presentation-only; no live camera or hand-navigation verification.

## 2026-10-25T03:24:55+05:30 — Interface shell, generated covers and compact reflow

- Changed: Rebuilt the shared menu presentation in `app/src/ui/**` and `App.tsx`: token-derived panel rails, status pill, gesture legend with original SVG icons, distinct hover/focus/hand-armed/pressed/selected/disabled/busy button states, procedural per-track cover art (`ui/coverArt.ts`, no external images), difficulty on the first ready page, explicit native-only Enable sound, grouped Settings pages (sound/visuals, camera/live play, credits/diagnostics) and a three-card credits view. Song-load failures now show the actual error, a failed card state and a Retry track action instead of only “Choose a track to begin.” Compact viewports (≤1099 px wide or ≤699 px tall, registered as `MENU_COMPACT_MAX_WIDTH_PX`/`MENU_COMPACT_MAX_HEIGHT_PX`) reflow rails above/below the figure with grouped full-size pages instead of one control per page. Calibration shows a joint/hand checklist (live) or source-labelled pre-roll, move legend and large countdown; Pause shows reason/countdown; Results shows rank reveal, stats and per-judgement bars; HUD has edge score/combo/accuracy, multiplier ring, milestone callout, keyed judgement pop and a styled progress bar. Runtime adds only a `judgementSeq` display counter so repeated identical pops retrigger.
- Why: The user asked to polish the interface into a coherent premium product; compact layouts previously paged 19 single controls over a huge song card and load errors were invisible.
- Validation: `npm run check` passed (typecheck, lint, 324 assertions in 44 files, production build); prettier check passed. New `tests/interface.test.tsx` covers cover determinism, multiplier/milestone helpers, HUD and results rendering; `tests/unit/compactBreakpoint.test.mjs` keeps the CSS media queries synchronized with the registry; UI paging tests cover compact grouping, error retry and busy cards. Docs checks passed. Headless Chrome screenshots at 1440×900, 1280×720, 1100×700, 1100×620, 1024×640 and 800×600 plus a complete dataset trial (pre-roll, HUD, pause, resume, results) were inspected.
- Limits: Screenshots are headless SwiftShader renders; no standing-distance, contrast measurement, live-camera setup, real hand navigation or human usability check was performed. The Figure placeholder is untouched for the avatar work.

## 2026-10-25T03:24:00+05:30 — Synthetic performer and responsive landmark filtering

- Changed: Added `app/src/performer/` (choreography planner, body/hand geometry, TrackingFrame synthesizer) and `tests/performer.test.mjs`, which plays five bundled charts through the real InputPipeline and GameSession at 30 Hz. Raised `ONE_EURO_BETA` from 0.08 to 10 with swing-tracking and stationary-jitter regressions. Registered the performer constants, documented the performer in docs02/05/17 and allowed Node globals in `.mjs` suites.
- Why: The user asked for trials of whether the game works without opening a camera. Chart-synchronized motion is needed before any dataset-camera trial can show hits; still photos cannot swing. The replay exposed a real defect: the landmark filter lagged a 4.5 m/s swing by ≈0.42 m after 200 ms and reported it below `SLASH_MIN_SPEED`, so genuine slashes only registered by accident.
- Validation: Every planned note on Pamgaea Easy/Normal, Electro Cabello Normal and Cipher Normal/Hard was hit with zero bad cuts on planned notes, zero wall hits and ≥98% Perfect timing (measured means within ±13 ms per gesture type). Unplanned notes: Pamgaea Normal 2/269, Electro Cabello Normal 23/329, Cipher Hard 56/405. The new filter test fails at the old beta (lag 0.079 widths) and passes at 10. Full `npm run check` passed with 325 assertions.
- Limits: Logic replay of synthetic landmarks only — no pixels, MediaPipe, webcam, latency or human feel. Live jitter at the new beta still needs consented camera review. The rendered performer for the dataset camera is the next step.

## 2026-10-25T03:19:51+05:30 — Export parity spans both held-out datasets

- Changed: training/export.py selects evenly spaced held-out crops across the requested datasets (previously the first N rows, which were all COCO) and labels non-preflight checkpoints as research checkpoints whose accuracy is reported separately.
- Why: Parity for a COCO + MPII model should exercise MPII crops too; limitation text should match the checkpoint kind.
- Validation: Smoke export of the 60-step timing checkpoint over 16 crops passed ONNX checker and ONNX Runtime CPU parity (maximum heatmap difference 5.96e-6, zero decoded difference with the refined decoder).
- Limits: Parity remains numerical equivalence only; the timing checkpoint is not a result.

## 2026-10-25T03:18:35+05:30 — Report smoke-test options

- Changed: training/report.py gained `--limit` (evenly spaced held-out people per dataset, marked `partialSmokeTest` in the report), `--threads` and `--workers`, and ASCII section headings.
- Why: Check the report path cheaply while the long training run uses most of the CPU budget.
- Validation: A 48-person-per-dataset smoke report over the 60-step timing checkpoint, the earlier three-step COCO preflight and the seeded untrained head completed in 2.5 minutes with two threads and one worker; overlays drew ground-truth joints on the correct body parts. Smoke numbers are not recorded as results.
- Limits: Smoke reports use partial validation and are never evidence of accuracy.

## 2026-10-25T03:14:35+05:30 — Training throughput, schedule and augmentation for a full COCO + MPII run

- Changed: training/config.json now uses 6 CPU threads, 3 spawned DataLoader workers (prefetch 2), batch 32 and 9 epochs, with linear warmup (300 steps) then cosine decay to 2% of the head/backbone learning rates, and per-epoch validation. train.py materializes the identical seeded per-epoch order (so resume skips batches without decoding them), records per-step data-wait/learning-rate and per-epoch wall/loss/validation summaries, keeps summaries across resume, accepts checkpoints under a junctioned runs/ folder, and disables only deterministic mode's NaN fill of fresh allocations. upper_body.py adds training-only scale (±25%), rotation (±30°, probability 0.5) and translation (±10%) ROI jitter through one testable crop_input(), fixes the flip label mirror (size − x rather than size − 1 − x), adds standard quarter-cell heatmap decoding, and shares one PoseMetrics accumulator. New report.py writes per-dataset, per-joint held-out reports with untrained, zero-heatmap and mean-pose-in-ROI references, a deterministic perturbed-ROI pass and local overlays.
- Why: The two-thread batch-8 loop could not finish a multi-dataset run in a few hours. Oracle ROI crops leak framing, so geometric jitter and a perturbed-ROI evaluation make robustness to imperfect localization visible. Evaluation crops stay the exact oracle extent, so checkpoints remain comparable.
- Validation: Synthetic timing (not accuracy) measured about 30 ms/sample for full fine-tuning and 14 ms/sample with a frozen backbone at batch 32; profiling attributed about 13% of step time to deterministic NaN fill. A labelled 60-step COCO + MPII timing preflight (local run timing-coco-mpii-frozen-60) measured about 340 ms per frozen-backbone batch with 6 ms mean data wait. The refactored evaluate() reproduced that run's stored evaluation exactly. Unit tests pass 11/11, including pixel-follows-label checks across 24 augmentation seeds, exact oracle extent, the refined decoder, the warmup/cosine schedule and permutation equality with the earlier shuffled DataLoader.
- Limits: Decoding refinement and augmentation change the training/evaluation contract from the earlier preflight; prior preflight numbers must be re-evaluated with the same decoder for comparison. Throughput figures are for this shared, loaded laptop and are not browser or frame-rate measurements.

## 2026-10-25T03:03:45+05:30 — Extracted and decoded MPII research images

- Changed: Extracted the verified local MPII archive with `prepare.py --dataset mpii --extract-mpii-images` (about 4.3 minutes) and added `prepare.py --verify-mpii-images`, which compares extracted count/bytes with the streamed archive audit and fully decodes every indexed image in a bounded process pool. Recorded the result in training/DATASETS.json.
- Why: A combined COCO + MPII training run needs individually readable MPII images; failures should surface before a multi-hour run, not during it.
- Validation: 24,984 extracted JPEG files and 12,140,043,353 bytes match the archive audit; all 17,404 indexed unique images (15,727 train / 1,677 validation) exist and decoded with zero failures. Re-preparing MPII reproduced byte-identical indexes (train SHA-256 9e52535d…, validation 4201b8de…).
- Limits: The archive audit has no per-member hashes, so extracted files are checked by count and total bytes; 7,580 unindexed archive images were counted but not decoded. No MPII optimizer steps were run in this step.

## 2026-10-25T02:58:00+05:30 — Gapless MP3 normalization and full-band playback decode

- Changed: Added `audio/gapless.ts`, a browser port of the canonical iTunSMPB parser plus an MPEG layer III sample-rate probe. `decodeForPlayback` trims encoder delay/padding only when the decoded length proves the browser ignored the metadata (exact untrimmed count at the decode rate, within `GAPLESS_LENGTH_TOLERANCE_SAMPLES`), never twice. Playback buffers now decode through the live context or an offline `PLAYBACK_DECODE_SR` (44.1 kHz) decoder instead of the 22.05 kHz analysis rate, matching docs15. Registered both constants. Corrected the previous entry's mistyped timestamp (02:45, not 12:20).
- Why: In the desktop app's embedded Chromium every bundled song failed selection with a 57.5 ms duration mismatch (Pamgaea decoded 168,568.16 ms = untrimmed 528 + 7,431,319 + 2,009 samples), so the dataset trial could not start. Playback at the analysis rate also discarded everything above 11 kHz.
- Validation: Seven new assertions compare the parse against `scripts/music-pcm.mjs` for all three tracks, trim at 44.1 and 22.05 kHz, and refuse already-trimmed/unexplained lengths. Full `npm run check` passed. The embedded browser now selects Pamgaea and starts the dataset trial.
- Limits: Only iTunSMPB metadata is honoured (the bundled files use it); LAME-header-only gapless files decode as the browser returns them. No audible listening test or latency measurement was made.

## 2026-10-25T02:45:00+05:30 — Parallel authoring preparation

## 2026-10-25T02:33:00+05:30 — Fixed-tier consumers and requested implementation handoff

- Changed: Connected runtime tier/contrast flags to actual drawing-buffer scale, bounded effect caps/lifetimes, low-tier complete geometry/poof counts, pylon totals and owned upper-body joint markers. Unsupported bloom/AA/trail/probe features remain explicit. Updated UI/navigation/roadmap status to the actual dataset-first flow and added HANDOFF.md with evidence, local-only training status and remaining implementation/release gaps.
- Why: Finish the coherent in-progress increment and preserve all work for the next agent, as explicitly requested by the user.
- Validation: Targeted quality/render checks passed 57 assertions. Final full application check passed typecheck, lint, 307 assertions across 41 suites and production build; source formatting passed. Root documentation tests passed 2/2, with 47 Markdown files / 514 local links and zero errors. Git diff checks passed before commit.
- Limits: Latest tier presentation has no new native pixel/performance evidence; live camera, human comfort, musical quality, complete post-FX/trails/harness and P0–P5 acceptance remain open. No additional training or feature work was started after the handoff request.

## 2026-10-25T02:29:16+05:30 — Canonical cosmetic presets and retained workflow evidence

- Changed: Exported the complete frozen quality-tier registry and pure validated resolution API, with explicit implemented/unsupported features and HDR guards. Retained exact clean-clone Node22 evidence, the original failed checksum report, later actual browser dataset completion/recovery and compact-menu screenshots.
- Why: Fixed tier requests need an executable source of truth before renderer wiring; evidence must preserve failures and distinguish source checks, dataset playback and live/hardware claims.
- Validation: Twenty new quality assertions passed, typecheck/lint/format passed; full current check passed 299 assertions/build. Clean remote08d7555 passed npm ci/check262tests and29 HTTP asset/CSP checks. Documentation checks passed with zero local-link errors.
- Limits: This checkpoint supplies configuration only; renderer consumption follows separately. No boot probe, adaptation, HDR/bloom/AA, disconnected-network, GPU budget or live tracking success is claimed.

## 2026-10-25T02:28:34+05:30 — Hand HUD and authoritative failure feedback

- Changed: Added peripheral Left/Right availability, semantic gesture colours and beam charge indicators; stale/absent/dataset hands show no fabricated charge. Added terminal-note presentation with exact chart approach speed, glyph retention, once-only Bad Cut deflection/red/dim and renderer-only upward escaped beams. Root lifecycle tests cover freshness and dataset pause/resume/results/keyboard retry.
- Why: Make input and failure states legible while preserving the game's authoritative capture-time judgement and bounded rendering.
- Validation: Full current-worktree check passed typecheck/lint/299 assertions/build, including six HUD, nine terminal-visual and two new runtime lifecycle assertions; the separately committed quality module contributes 20 of these. Real prepared browser completed automatic arrangement and pause/resume, real131-miss Results, Enter retry and Quit; source identity/screenshots are recorded separately. Documentation/source format checks passed before commit.
- Limits: Late misses may already be beyond visual DESPAWN_Z when finalized; they do not reappear for a fake fade. HUD/geometry assertions do not prove live gesture accuracy or GPU/flashing safety.

## 2026-10-25T02:18:43+05:30 — Completed MPII archive acquisition and integrity audit

- Changed: Reconciled the exact local COCO photo/receipt inventory and completed MPII official archive acquisition. Recorded archive hash, full tar/gzip CRC/path/type audit and prepared image-name coverage in training/DATASETS.json and training/STATUS.md; updated training setup status.
- Why: Keep the large-dataset request grounded in acquired source data and verified rights while current implementation prioritizes levels/assets over more tracking work.
- Validation: Independently rehashed 12,088,943,206 compressed bytes; 24,984 unique JPEG archive members, zero duplicates and all prepared train/validation filenames present. Documentation checks passed.
- Limits: MPII remains unextracted; individual JPEG decoding and MPII optimizer steps have not run. Full multi-dataset training remains incomplete and no weights were promoted. The three-step COCO preflight's worsened held-out loss is unchanged.

## 2026-10-25T02:16:36+05:30 — Dataset pause and clean-checkout integrity fixes

- Changed: The dataset trial can resume without camera calibration, while live/fatal guards remain enforced. Pinned fixture text to canonical LF bytes and corrected the runtime SHA to the actual Git blob. Added byte-level tamper/line-ending/load assertions and the paused-UI regression. Registered terminal-feedback constants for the renderer follow-up.
- Why: Real browser pause exposed a disabled Resume control, and a fresh Node22 remote clone exposed a checksum that incorrectly described Windows working-copy CRLF bytes. The initial root-worktree trial did not reveal that clean-checkout failure.
- Validation: Targeted UI/dataset suites passed 48 assertions; four additional fixture integrity assertions passed. Prior complete check passed 257 assertions; this small fix passed its full application/docs checks before commit.
- Limits: Paused dataset input is annotated still data, without human gestures or camera readiness. Browser recovery and the repaired remote clean clone are verified in the following evidence checkpoint.

## 2026-10-25T02:13:55+05:30 — Distinct bounded beam power-down

- Changed: Added a six-slot whole-target beam power-down/collapse effect with seeded sparks, soft flash and ring; no beam hit emits slash halves, shatter pieces or generic cube debris. Whole effects reserve their sparks in the shared fragment cap and recycle deterministically. Registered effect/arena emission values and updated subsystem docs. Normalized the app README formatting.
- Why: Preserve the documented contrast between slash, smash and beam while keeping effects bounded and exact across pause/replay.
- Validation: Full check passed typecheck/lint/257 assertions/build. Seven new effect assertions cover lifetime, deterministic motion, pause/Calm, reuse, disposal and shared capacity; source formatting check passed after README normalization. Documentation checks passed before commit.
- Limits: Automated render data/geometry tests do not establish GPU frame budgets, flashing safety or human visual quality.

## 2026-10-25T02:00:32+05:30 — Integrated dataset-first game, shared rails and authored renderer

- Changed: Wired the camera-free menu, native/hand semantic target registry, side-rail/compact paging, sound/preview/upload, automatic 80 s dataset trial, calibration/pause/results recovery and owned head-to-hips figures. Integrated Blender assets/fallbacks, bounded shards, exact capped swing-plane cuts, beam reticles/lines, wall cues and actual music emission with Calm behavior. Updated real npm commands, source formatting protection, runtime/geometry/UI assertions and current docs/status.
- Why: Deliver a runnable music→edit→level→results spine under the user's dataset-first direction, keeping webcam work optional and preserving all three full source songs.
- Validation: Full check passed typecheck/lint/250 assertions/build; source format check passed. Browser completed a real edited 80 s Pamgaea dataset trial with genuine 131 Miss/zero fabricated hits; initial screenshot and limitations are retained in docs/evidence. Geometry tests include 200 seeded capped cuts. Docs checks passed before commit.
- Limits: Static poses lack hand gestures, so this trial proves playback/spawn/miss/results rather than human gesture accuracy. Full human/zoom/flashing/offline/soak/performance gates remain open. Strict frontend static audit reports custom-component parser false positives; it does not establish accessibility compliance. Beam poof presentation is being refined separately.

## 2026-10-25T01:50:01+05:30 — Reproducible upper-body model research preflight

- Changed: Added an isolated, source-licensed RGB training pipeline, 13-joint head/arms/hips target, masked labels, explicit oracle ROI, resumable acquisition/checkpoints, held-out evaluation and ONNX parity/export. Raw data, environments and weights remain ignored. COCO acquisition contains 8,503 eligible CC-BY photos; MPII annotations are prepared and image acquisition remains in progress.
- Why: Address the user's large-dataset training request without pretending the browser MediaPipe API can fine-tune arm localization or treating a few training steps as a production model.
- Validation: Seven Python assertions passed. A real three-step CPU preflight used 24 photo crops with 20,121 train records available and 919 validation people; validation loss worsened 0.0174751→0.0202273. ONNX parity on eight held-out crops passed, with max heatmap error about 1.18e-6. Exact source/sample/checkpoint hashes and negative quality outcome are recorded in training/PREFLIGHT_EVIDENCE.json.
- Limits: Full multi-dataset training has not completed; no weights were promoted into the game and no tracking-quality improvement is claimed. This is separate noncommercial research, now secondary to the requested dataset level/assets work.

## 2026-10-25T01:40:13+05:30 — Blender MCP authored level and arena assets

- Changed: Built six original MIT GLBs and a saved Blender source scene through the official Blender MCP local bridge: glyphs, armour, beam ring, pylon, complete eight-shard block and clear-centre neon arena background. Retained generator, bridge/bootstrap, actual preview, exact tool/source hashes, independent geometry reports and repeat-export hash evidence.
- Why: Follow the user's request to author level assets and background in Blender MCP. Cell Fracture is unavailable, so the documented complete eight-octant path is explicit; it is not presented as 14 fracture cells.
- Validation: Six GLBs total 3,320 triangles / 194,488 bytes; all passed Khronos with zero errors/warnings and independent volume/pivot/watertight/axis/stage checks. Three asset-checker tests passed. Two actual MCP regenerations produced identical GLB hashes. Docs checks passed.
- Limits: Asset correctness is separate from GPU performance and human/live-game evidence. The arena and source scene contain no camera imagery or external downloaded models.

## 2026-10-25T01:38:56+05:30 — Dynamic song arrangements and attributed dataset input

- Changed: Added real continuous 10 s fade-in / 60 s highlight / 10 s fade-out editing, raised-cosine gains, exact source/WAV/PCM receipts and fresh derivative chart generation. Added eight attributed independent COCO upper-body annotations and a bounded, hash-verified replay adapter with strict topology/clock validation, no fingers, no depth and no invented temporal motion.
- Why: Follow the user's dataset-first trial and dynamic short-song direction while retaining all three full originals. A continuous source window avoids hidden hard splices; the highlight is a disclosed energy/onset heuristic.
- Validation: Full worktree check passed typecheck/lint/250 assertions/build; 52 targeted runtime/dataset assertions passed. Real Chrome arrangement harness passed 9 checks across three songs. The pending app integration completed an actual 80 s Pamgaea trial to results with 131 Miss and zero fabricated hits; UI integration is committed separately next.
- Limits: No chorus-quality, live gesture or trained-tracker claim. Independent stills have no gesture labels; training preflight is separate research work.

## 2026-10-25T01:16:05+05:30 — Bounded tracking and head-to-hips input

- Changed: Implemented optional camera setup, owned bounded worker buffers/capture, GPU→CPU initialization fallback, filters, calibrated body/hand cursors, gesture hysteresis/charge, palm-to-point anchor/confirmation/grace/latch/rearm/cancellation, deterministic replay and explicit opt-in recorder. Pinned model URLs/checksums/WASM/license. Added same-origin CSP prepared server/Vite model route and HTTP assertions. Per user instruction, lower-limb coordinates are zeroed before transfer/replay/recording and masks stop at the actual hip line; live and illustrative rendering changes integrate in the UI checkpoint.
- Why: Keep the menu independent of permissions, share capture-time input paths and preserve privacy/ownership. Actual browser tests found Vite public-module routing and MediaPipe cached module-factory failures, then cold first-inference cost; fixes target those observed causes without weakening steady-state freshness.
- Validation: 58 targeted tracking/gesture/replay assertions passed; model preparation passed exact hashes. Static server tests passed 5 with one symlink test skipped because this Windows environment cannot create it. Native Chrome synthetic model initialization/inference returned GPU results (not webcam performance). Native in-app camera setup subsequently reached GPU preview and Cancel preserved music browsing. Documentation checks passed before this checkpoint.
- Limitations: No consenting person completed matching calibration or a live scored hit; no tracking accuracy/throughput, motion-to-photon or human menu-reach claim. The user redirected work to dataset trials and Blender assets rather than additional webcam tuning; release gates remain open. The upstream pose network still internally computes its pretrained full pose, while the app retains only head-to-hips outputs.

## 2026-10-25T01:05:30+05:30 — Local starter music and deterministic generation

- Changed: Acquired unchanged official CC-BY 4.0 Pamgaea, Electro Cabello and Cipher audio with exact sources, acquisition/license receipts and attribution. Packaged nine validated Easy/Normal/Hard maps, measured previews/durations, hashes and manifest. Implemented FFT/STFT/flux/onsets/tempo/beats/energy, safe seeded assignment/chords/beam reservation/walls, strict schema/catalog/hash validation, cancellable upload worker, grouped optional IndexedDB cache and real acquisition/generation scripts. Pinned local Orbitron/Rajdhani fonts with OFL notices.
- Why: First play must require no uploaded music or network service. Browser tests exposed source-zero errors from iTunSMPB trim and aliasing from native analysis resampling; generator v2 corrects those with gapless canonical PCM and a band-limited resampler, rather than loosening admission checks.
- Validation: Music/font/PCM/generator suites passed as part of 174 asserted tests and the full application check. All nine packaged maps/hashes validated. The isolated real Chrome 155 numeric harness passed 25 checks including three songs at 22050/44100/48000 Hz, one-sample duration agreement and zero-lag source correlation; raw result and failed-before-fix evidence retained under app/tests/fixtures/audio. Documentation checker passed after the virtual-environment exclusion fix. Map assets were not reformatted after hashing.
- Limitations: All three tempo-confidence values remain low and are visibly labelled onset-only; catalogue BPM does not overwrite measured uncertainty. Held-out annotated musical evaluation, live comfort, audible synchronization and generation/performance targets are unverified. No demo excerpt or release evidence is claimed. This checkpoint adds real node scripts; npm script integration follows with the shell checkpoint.

## 2026-10-25T01:02:56+05:30 — Exclude local training dependencies from doc checks

- Changed: The documentation walker now excludes nested Python virtual environments, Python caches and the isolated npm cache; extended the existing regression fixture to cover training/.venv third-party Markdown.
- Why: The new isolated training environment exposed dependency-internal links outside this repository. Those must not be interpreted as project documentation.
- Validation: Both documentation-checker assertions passed; the repository link checker passed with zero errors after this fix.
- Correction: The 01:01 audio/game entry incorrectly says documentation checks passed before that commit. They actually failed on four links in the newly installed ONNX Runtime package; PowerShell continued to the commit because the earlier command lacked an explicit exit-code guard. The audio/game assertions did pass. Subsequent chained validation now explicitly stops on a nonzero exit code. No history was rewritten.

## 2026-10-25T01:01:41+05:30 — Capture-time game and audio spine

- Changed: Implemented framework-free session/spawning, swept palm/blade collision, capture-time judgement, delayed miss deadlines, deterministic two-hand arbitration, beam charge/aim/fire, torso walls, combo/multiplier, genuine frozen results and motion estimate. Implemented heard-time audio clock, pre-roll, explicit preview/source disposal, decode admission, analyser and bounded original procedural SFX; added shared math/pool/hash utilities.
- Why: Make the first playable integration use real audio timing and exactly one terminal outcome per object before rendering polish. User requested much smaller, more frequent commits; subsequent subsystems are checkpointed separately.
- Validation: 33 targeted assertions across seven game/audio suites passed, including 30/60/120 Hz replay and render stalls, late/duplicate/old-session inputs, exact scoring windows, 200 seeded blade trajectories, source lifecycle and 20-cycle integration tests in the separate pending runtime increment. The full worktree also passed typecheck/lint/174 assertions/production build at 00:52; this commit stages the completed audio/game portion. Documentation checks passed before commit.
- Limitations: No live webcam hit or audible synchronization proof yet. Browser model initialization required a genuine module-factory fix, and first GPU inference exceeded the original one-second watchdog; tracking repairs are the next checkpoint. P0/P1 live gates remain open. Procedural SFX/destruction are functional fallbacks; signature geometry, held-out music evaluation, P4 benchmarks and P5 release proof remain pending.

## 2026-10-25T00:35:12+05:30 — Executable foundation contracts

- Changed: Implemented shared tracking/cursor/body/result/chart/catalog types, central constants, menu input contracts, typed events with idempotent disposal, explicit lifecycle transitions/epochs, worker timestamp normalization, dev-only allowlisted flags and bounded instrumentation. Added seven real foundation assertions and ignored the isolated temporary npm cache. Registered bounded admission, DSP refinement and original procedural-SFX defaults for the subsystem increments now being integrated.
- Why: Establish one framework-free contract before parallel tracking, audio/game, music and UI consumers. Preserve the clean starting point at `750257cc4b76298cb466241e4d66a0c845a0c34c`.
- Validation: Initial `npm ci` failed on a corrupt/missing npm cache entry; `npm ci --cache C:\Github\sign-saber\.npm-task-cache` succeeded without lockfile/package upgrades (187 packages, zero reported vulnerabilities). Initial shared-contract `npm run check` passed with 7 assertions/typecheck/lint/build. A later integration run passes 111 assertions but correctly fails three remaining empty scaffold suites after removing `--passWithNoTests`; those are being replaced/removed in the next increment. Documentation checks below were run before this checkpoint.
- Limitations: This checkpoint alone is not playable and does not complete P0. Live webcam/delegate/browser interaction, human calibration/gesture accuracy, physical audio latency and P4/P5 evidence are unverified. Host is Windows 11 10.0.26300, Node 26.8.1/npm 12.2.1 (CI's Node 22 baseline still requires clean-clone verification), AMD Radeon Graphics driver31.0.21925.1001 and RX6600M driver32.0.21045.16010; reported display refresh165Hz. Actual camera modes were not requested during baseline inspection.

## 2026-10-25T00:08:18+05:30 — Core menu, camera onboarding and starter music

- Changed: Added docs25 as the authoritative mouse/keyboard/palm-to-point menu and setup contract, plus root DESIGN.md for the figure-centred visual direction. Promoted hand navigation from optional dwell to CORE deliberate Open→Point activation, with a stable palm anchor, one-shot latch/rearm, transition grace, stale/epoch/disabled/native-input guards and explicit browser-owned exceptions. BOOT now reaches camera-free SELECT: an illustrative central person and **Set up camera** appear until matching calibration; setup is a SELECT subflow independent of song choice, with labelled live preview and recoverable errors. Updated vision, contracts/constants, state/tracking/gesture/render/UI/audio specs, roadmap, QA, demo and measurement guidance to agree. Required three full starter songs and all difficulty maps by P2; selected Pamgaea, Electro Cabello and Cipher by Kevin MacLeod, with official-source/license credits, planned manifest, explicit previews and local asset integrity rules.
- Why: Make the first-run experience usable before camera access, preserve the player as the menu's centrepiece and provide an included music library with equivalent native/hand control. A placeholder must never masquerade as tracking evidence or a gesture as trusted browser input.
- Validation: `npm run check` passed (typecheck/lint/build; ten placeholder Vitest files and zero tests). Two documentation-checker tests passed; 39 Markdown files/455 local links checked with zero errors; `git diff --check` passed. DESIGN.md official lint passed with zero errors/warnings. Frontend static audit in strict mode reported no findings on the scaffold; JSON retained locally. Three agents reviewed menu UI, camera lifecycle and starter-music sourcing; official per-track/license pages were checked.
- Limitations: Documentation only: no audio/maps were downloaded, no menu/controller/camera implementation exists, and no browser/human/accessibility/gesture/performance checks were performed. Catalog BPM/duration are publisher metadata, not our analysis. Runtime UI and three-song packaging remain roadmap tasks; static audits do not prove those behaviors.

## 2026-10-24T23:51:07+05:30 — Complete music, timing, QA and evidence contracts

- Changed: Completed DSP/format/QA/risk/companion review (docs08/09/17/21/23), including corrected tempo confidence/support, harmonic bounds, minimum-gap rounding, silence checks, deterministic ergonomic assignment, cache versions, cancellation, unknown-input validation and safe optional-service lifecycle. Registered remaining DSP/flow defaults in docs02 and aligned generator/validator density windows. Reconciled precharged beams, negative-time early-note pre-roll, neutral low-confidence countdown, async resume, live accuracy refresh and replay/debug keys across runtime/UI. Added explicit companion health/status payloads. All numbered specifications have now been reviewed and updated, with primary API sources where needed.
- Why: Make the complete build reproducible and the judge demonstration credible: the musical/physical experience, runtime contracts, performance protocol and failure recovery must agree.
- Validation: Final documentation check passed: 37 Markdown files, 392 local links/fragments, zero errors. Two checker regression tests passed; code fences are balanced and the complete JSON example parses. `git diff --check` passed. `npm run check` passed after the scaffold header changes (zero Vitest tests). Verified `npm run beatmaps` still exits 1 as its documented placeholder and `npm run server` exits without a listener. Three agents completed independent subsystem and integration reviews.
- Limitations: Gameplay, browser/WebGL/MediaPipe compatibility, Blender exports, model download integrity, musical holdout quality, comfort/accessibility and benchmark targets remain unverified until implementation. No measured performance, raw evidence bundle or playable release was fabricated. The roadmap starts at P0.

## 2026-10-24T23:46:26+05:30 — Remove inherited kickoff instructions from source stubs

- Changed: Updated 92 source/shader/test contract headers to refer to the roadmap phase gates, plus the optional server header. Changed the deliberately failing beatmap placeholder's message from H3 to P2; no runtime implementation was added.
- Why: The retired event restriction should not survive in the files a builder opens next, or contradict the roadmap and contributor guide.
- Validation: `npm run check` passed after these edits (typecheck, lint, production build; ten placeholder Vitest files, zero tests). Documentation checks and `git diff --check` also passed in the surrounding milestone.
- Limitations: These are documentation comments and a placeholder message only. The scaffold still provides no gameplay, generation or listening server.

## 2026-10-24T23:43:30+05:30 — Signature visuals with one quality registry

- Changed: Polished rendering/UI/asset specifications (docs10–14/16/18): fixed mask copies and projection assumptions, shader edge math, degenerate slicing/fallbacks, shatter accounting, trail sampling, deterministic effects, scene-wide Calm mode, focus/error states and owned 2.5D highlights. Consolidated all quality presets in docs16 and asset ceilings in docs18. Made Blender/MCP optional with validated procedural/manual paths, manifests and honest pipeline limits. Updated AI usage, including the owner's report of occasional Devin collaboration without attributing this pass to Devin.
- Why: Make the signature movement/cut/drop experience buildable, legible, reproducible and comfortable, while removing contradictory tier values and unsupported render/asset performance claims.
- Validation: `npm run check` passed again (scaffold checks; still zero Vitest tests). Documentation checker tests passed; 37 Markdown files/385 local links checked with zero errors. `git diff --check` passed. The rendering review also checked balanced fences and Python syntax in the Blender templates.
- Limitations: No rendered scene, Blender asset export, live camera play, accessibility measurements or GPU timings were executed. All effect/performance budgets are proposals; runtime source remains stubs.

## 2026-10-24T23:39:39+05:30 — Gate-driven roadmap and executable documentation checks

- Changed: Added root `ROADMAP.md` with P0–P5, file-level implementation order, reviewable tasks and proof gates. Replaced inherited timetable/folder restrictions in `AGENTS.md` and docs19. Reworked README, docs index, vision, ADRs, demo, glossary and folder READMEs to distinguish plans/stubs from implementation. Added docs24 benchmark/evidence protocol. Corrected runtime contracts in docs02/04/05/06/07/15: worker time origins, output-aligned song clock, bounded input lifetime, capture-only scoring, beam targeting/whiffs, reachable 100% accuracy, pause guards and mask ownership. Added a dependency-free Markdown path/fragment checker with regression tests and replaced CI's subshell-based checker, whose failure status was lost.
- Why: Preserve and strengthen the existing specification while making the actual build order and judge-facing proof concrete; remove assumptions from the unrelated prior event and fix contradictions before implementation.
- Validation: `npm run check` in `app/` passed (typecheck, lint, production build; Vitest discovers ten placeholder files with zero tests). `node --test scripts/check-docs.test.mjs` passed two tests, including broken-link exit status; `node scripts/check-docs.mjs` checked 37 Markdown files/376 local links with zero errors at this milestone. `git diff --check` passed.
- Limitations: No gameplay, camera, audio, Blender or benchmark measurements were exercised. Model downloader remains unpinned; actual benchmark/replay/generation tools and assets are planned. Visual/audio/performance subsystem reviews continue in the next documentation milestone.

## 2026-10-24T21:50:00+05:30 — Specification and project scaffold

- Changed: Added the complete pre-build specification under `docs/` (index + 23 numbered documents: vision, architecture and contracts with the constants table, ADRs, state machine, tracking, gestures, hit detection and scoring, beatmap generation and format, rendering ×4, UI/UX, audio sync, performance budget, testing, Blender MCP pipeline, build plan, demo script, risks, glossary, YouTube companion). Adapted the workflow conventions of a hackathon repository template (`README.md`, `AGENTS.md`, `SUBMISSION.md`, `CHANGELOG.md`, `AI_USAGE.md`, `.gitignore`, PR template) to the project, dropping event-specific rules. Scaffolded `app/` (Vite + TypeScript + Three.js + React toolchain config, `index.html`, documented module stubs for every file in the source layout, test stubs), `server/` (companion service skeleton), `scripts/download-models.mjs`, `assets-src/`, CI workflow (typecheck, lint, test, build, Markdown link check).
- Why: Implementation is built at the hackathon. A precise specification lets four parallel tracks start building immediately against agreed contracts and constants.
- Validation: `npm install` in `app/` resolves the pinned dependency set; `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` pass on the stub tree (recorded in the commit). Relative Markdown links checked. No gameplay exists yet.
- Limitations: Documentation and scaffolding only; no application behaviour. `AI_USAGE.md` is intentionally empty until the build starts. Bundled demo tracks and MediaPipe models are not committed (fetched by script / added at H1).
