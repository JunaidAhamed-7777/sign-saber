# Change log

Record each meaningful project change, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## Development log

Implementation and historical specification work are recorded below. Automated, dataset, browser-audio and live-camera evidence are identified separately.

## 2026-10-25T03:34:38+05:30 — Opaque boot splash and arrangement source card

- Changed: BOOT is now an opaque void splash (hidden header, unwrapped wordmark, indeterminate bar); `index.html` shows a static pre-boot mark until React mounts and its description no longer claims full-body play. After an 80-second cut is prepared (which clears the bundled selection), the source song card is marked “Arrangement ready” and the ready header keeps the source cover/artist.
- Why: Screenshots showed a blank page before mount, a translucent boot overlay over the arena and no visible selection after a dataset trial returned to Songs.
- Validation: `npm run check` passed on rerun (two arrangement/gapless tests timed out once under parallel-agent CPU load, then all 324 passed); headless Chrome boot (held manifest), compact settings/calibration/HUD (1024×640, 800×600) and 1920×1080 HUD/return-to-songs screenshots were inspected.
- Limits: Presentation-only; no live camera or hand-navigation verification.

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

## 2026-10-25T02:58:00+05:30 — Gapless MP3 normalization and full-band playback decode

- Changed: Added `audio/gapless.ts`, a browser port of the canonical iTunSMPB parser plus an MPEG layer III sample-rate probe. `decodeForPlayback` trims encoder delay/padding only when the decoded length proves the browser ignored the metadata (exact untrimmed count at the decode rate, within `GAPLESS_LENGTH_TOLERANCE_SAMPLES`), never twice. Playback buffers now decode through the live context or an offline `PLAYBACK_DECODE_SR` (44.1 kHz) decoder instead of the 22.05 kHz analysis rate, matching docs15. Registered both constants. Corrected the previous entry's mistyped timestamp (02:45, not 12:20).
- Why: In the desktop app's embedded Chromium every bundled song failed selection with a 57.5 ms duration mismatch (Pamgaea decoded 168,568.16 ms = untrimmed 528 + 7,431,319 + 2,009 samples), so the dataset trial could not start. Playback at the analysis rate also discarded everything above 11 kHz.
- Validation: Seven new assertions compare the parse against `scripts/music-pcm.mjs` for all three tracks, trim at 44.1 and 22.05 kHz, and refuse already-trimmed/unexplained lengths. Full `npm run check` passed. The embedded browser now selects Pamgaea and starts the dataset trial.
- Limits: Only iTunSMPB metadata is honoured (the bundled files use it); LAME-header-only gapless files decode as the browser returns them. No audible listening test or latency measurement was made.

## 2026-10-25T02:45:00+05:30 — Parallel authoring preparation

- Changed: bootstrap.py accepts `--port` and `--blend` for a separate dedicated Blender MCP instance; `scripts/blender-mcp.mjs` honours a validated `BLENDER_MCP_PORT`. CHANGELOG.md and AI_USAGE.md use Git's built-in union merge so parallel branches keep both appended entries.
- Why: Avatar and arena-asset authoring run concurrently without sharing one scene or bridge port.
- Validation: Port parsing checked from Node (default 9876, explicit 9877, rejection of 80).
- Limits: No asset was regenerated by this preparation step.

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
