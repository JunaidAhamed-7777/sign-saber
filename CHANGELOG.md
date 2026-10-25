# Change log

Record each meaningful project change, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## Development log

Implementation and historical specification work are recorded below. Automated, dataset, browser-audio and live-camera evidence are identified separately.

## 2026-10-25T05:50:47+05:30 — Verify PR #9 from a fresh committed clone

- Changed: Retained the initial old-banner harness failure and corrected clean-clone drill receipts under docs/evidence/pr-audit-release-drill and pr-audit-release-drill-fixed; linked current evidence from README and docs17. This documentation commit records tested application/harness source 886f7beb990af721bd2faf4292cc9260c97379fb.
- Validation: Clean clone/checkout, npm ci, full npm run check (560 application tests and three bundle tests), production build, offline menu/audio unlock, 84 Perfect synthetic hits, Retry, pause and Songs all passed. All 24 observed requests were local; no console/runtime/CSP errors, external attempts or cleanup failure. Unit tests 6 and docs tests 2 passed; documentation links are rechecked before commit.
- Limits: Initial source 810bf67 reached real results but failed its stale source-banner check; that failure remains recorded. Neither run proves live-camera recognition, audible sync, physical latency or a complete manual release gate.

## 2026-10-25T05:46:45+05:30 — Keep the release drill aligned with neutral run screens

- Changed: Normally integrated merged PRs #7/#8. The release drill now uses the existing stats diagnostics to assert the synthetic-performer evidence lane and camera-free provenance instead of requiring a removed source banner. Native UI actions and DOM judgement counts still drive the journey.
- Why: Current main intentionally uses neutral run copy; the old banner predicate would reject a successful synthetic session.
- Validation: The initial clean clone installed and passed the full 560-test application check and bundle gate. Release-drill unit tests and documentation checks are run before this fix commit. The initial old-harness browser attempt and corrected end-to-end run are recorded separately after completion.
- Limits: Full corrected browser validation is still pending here; no live-camera, audible-sync or performance claim is added.

## 2026-10-25T05:43:08+05:30 — Record missing-browser release-drill failures

- Changed: Normally integrated current main into the release-drill branch, preserving the README showcase and release-drill instructions. `scripts/cdp-client.mjs` now rejects browser spawn errors through its awaited startup path; `scripts/release-drill.test.mjs` covers a missing executable.
- Why: An invalid `--browser` path previously emitted an unhandled child-process error, bypassing the drill's failure report and temporary-clone cleanup.
- Validation: Release-drill unit tests passed 6/6, the real worker/network browser regression passed 1/1, documentation tests passed 2/2, and the local Markdown checker passed (56 files, 600 links).
- Limits: This patch verifies browser-launch failure handling and worker isolation. The final integrated application check and clean-clone/offline journey are performed separately; live camera, human QA and release gates remain open.

## 2026-10-25T05:03:12+05:30 — Verify the PR's prepared integration build

- Changed: Retained separately labelled prepared-build JSON/Markdown and linked them from docs17. The exact tracked browser journey was reused on committed integration `f68f84e933bb6495bc66f80da455f7b3ae5e3fd8` (main `db45982`); the earlier clean-clone and missing-asset artifacts keep their own tested SHAs. This publication changes documentation only.
- Why: The opened PR needed a newer normal integration. Verify its actual presentation/audio/game flow without relabelling earlier installation evidence or duplicating a browser driver.
- Validation: The integrated source passed full `npm run check` (481 assertions/55 suites/build). Its prepared production build passed BOOT → selection → native sound enable → real 80-second synthetic performer → Results (84 Perfect, zero misses, 54,700 score) → Retry → play → pause → Songs. Runtime/console, CSP and interception errors were zero; cleanup succeeded. Root documentation tests/checker passed for these artifacts.
- Limits: This supplemental run is explicitly not a new clone/install exercise. Camera/models, people, recognition, audible sync and performance targets remain outside its scope. The separately recorded clean-clone pass and intentional catalog-404 failure remain the release-drill control evidence; later main commits are outside this frozen integration.
## 2026-10-25T06:30:00+05:30 — Corner camera view and steadier live tracking

- Changed: Added a corner camera view (bottom right) that shows the mirrored webcam with MediaPipe pose and hand landmarks, hand labels/gestures, tracking rate, inference time and drops. The camera `<video>` is now attached to the page (invisibly) so frame callbacks keep flowing; a stall first restarts capture (up to `TRACK_STALL_RESTARTS`) and the stall window is 3 s instead of 1 s. Removed GPU/delegate wording from setup status, the GPU line from diagnostics, and the dataset-camera settings page (`?camera=dataset` still works for testing). Dev builds expose `window.signSaber` for console debugging.
- Why: User saw "Tracking stopped producing frames" on a real webcam, wants to watch MediaPipe live in a corner, and asked to remove leftover GPU/dataset wording.
- Validation: Full `npm run check` passed (482 tests). In the desktop app's pane the dataset camera ran through setup with the corner view showing the feed and rate; that pane is backgrounded, so its frame timing is not representative.
- Limits: Not yet confirmed on the user's webcam.

## 2026-10-25T05:44:14+05:30 — Audit PR #8 and preserve current menu integration

- Changed: Normally merged main including PR #6, preserved current README and camera-on-first-page behavior, retained bounded eight-song paging assertions, and updated current README library/credit counts while leaving historical measurements source-labelled.
- Why: Review verified the eight MP3s, 24 charts, acquisition/generation receipts and official attribution pages; current main's menu test expectations needed combining with the larger catalog.
- Validation: Full npm run check passed (560 application tests, typecheck/lint/build, three bundle regressions); all ten chunks pass. Docs tests (2), link checker and whitespace check passed. Shared runtime asset validators and synthetic planner accept all 24 maps with zero unplayable notes.
- Limits: No new human music-quality, webcam, comfort or performance gate is claimed.

## 2026-10-25T04:54:57+05:30 — Freeze all eight songs on generator v4 from main 09671b7

- Changed: Froze the issue #2 acceptance checkpoint on upstream 09671b7, which adds real tempo-period refinement and generator version 4 alongside other upstream work. Normally integrated it and regenerated all 24 maps/receipts/manifest again through the shared script. Resolved generated JSON through regeneration and reconciled the music registry without losing the five additions. Updated current version/confidence docs, retained the v4 chart diagnostic/browser report, and refreshed the actual PNGs. Original audio bytes, acquisition/attribution receipts and canonical PCM hashes are unchanged.
- Why: The issue requires the same latest generator across all eight songs; the tempo change alters real map hashes and which songs qualify for beat snapping. Earlier v2/v3 acceptance results are preserved as historical checkpoints, with no claim that they verify v4.
- Validation: Full npm run check passed typecheck, lint, 54 suites/558 assertions and production build. All 24 maps passed shared structural/readability tests and full synthetic InputPipeline/GameSession replays; the v4 diagnostic reports zero unplayable notes for every chart. Chrome 155/SwiftShader at both 1440×900 and 1024×640 selected all eight v4 songs/all 24 difficulty maps, paged music/credits, started/stopped original preview and verified all eight exact attributions/source/license links. Zero CSP, JavaScript-console, music-request or external-page-request failures. Current manifest SHA-256: c0d70d68751eb90593e9b8c55fca15a3a6611ef91e1f7e4a5c5a8760cbfc460a. Scoped formatting passed; root documentation checks are rerun before committing this frozen checkpoint.
- Limits: Freeze identifies a tested upstream source; later unrelated main changes are not retroactively claimed as tested. Existing favicon/bundle warnings and human/camera/music-quality/performance gates remain explicit. No production generator/game algorithm was changed by this music issue.

## 2026-10-25T04:44:12+05:30 — Preserve the later block-asset main integration

- Changed: Normally integrated main 87032d0 into the issue #2 branch before final handoff, preserving the upstream block-model/render changes and resolving the shared changelog overlap. The eight-song acquisition bytes, exact credits, generator version 3, all generated maps and manifest are unchanged.
- Why: Keep the PR current with main without discarding other contributors' work or expanding music scope.
- Validation: Full npm run check passed again (typecheck, lint, 50 suites/502 assertions, production build). The existing current-v3 two-viewport/all-eight-song/all-24-map browser evidence still identifies the unchanged music manifest; no new browser/performance result is claimed for unrelated block work. Root documentation checks are rerun before this integration commit.
- Limits: Existing large-bundle/favicon warnings and all previously stated human/camera/music-quality limits remain unchanged.

## 2026-10-25T04:39:17+05:30 — Regenerate the eight-song pack with awaited generator v3

- Changed: Main integrated the awaited chart branch immediately after PR #8 opened. Kept the PR draft while normally integrating 93e411e, regenerated all 24 maps/receipts/manifest with upstream generator version 3, and resolved the three generated-receipt conflicts using generator output. Extended upstream chart-readability tests, full synthetic InputPipeline/GameSession replays and the existing chart diagnostic to every song in the eight-track manifest. Updated the music registry/current format version and retained current-v3 browser/diagnostic evidence; original audio bytes/credits remain unchanged.
- Why: Issue #2 explicitly requires the latest chart generator across the complete library before review. Earlier passing generator-v2 browser/check results are historical and are superseded for current acceptance.
- Validation: Full npm run check passed typecheck, lint, 50 suites/502 assertions and production build. All 24 maps passed the shared validator/readability tests and full synthetic performer replays; the retained diagnostic reports zero unplayable notes for every chart. Actual Chrome 155/SwiftShader at 1440×900 and 1024×640 selected all eight current-v3 songs/all 24 difficulties, paged music/credits, started/stopped preview and verified every exact attribution/source/license link. There were zero CSP, JavaScript-console, music-request or external-page-request failures. The browser report identifies the merging main SHA and exact eight-track manifest SHA-256. PNGs were refreshed and inspected; root documentation checks are rerun before this integration commit.
- Limits: Existing favicon 404 responses and the separate large-bundle warning remain recorded. Synthetic logic, offline selection and numeric audio validation do not establish webcam recognition, human comfort, musical quality or measured performance.

## 2026-10-25T04:22:29+05:30 — Verify music pack against newer main

- Changed: Normally integrated main 752acf3 and then 52e9c81 into the issue #2 branch after the content checkpoint, preserving their camera Settings, footer/ARIA, training and other upstream work. Refreshed the final music/credits screenshots and retained both final integration browser reports. Generator version 2 and all music-generation sources are unchanged from the final full-pack regeneration.
- Why: Main changed before opening the PR; the extra Settings page moves the Credits navigation target, and the subsequent interface update changes the footer.
- Validation: Full npm run check passed on code commits d49bbf7 (380 assertions) and 0ec036c (48 suites/382 assertions), including typecheck, lint and production build. Native Chrome at 1440×900 and 1024×640 booted, navigated to/selected the eighth song and traversed the updated Settings/credits pages; every exact attribution passed with zero CSP, console or external-request failures. PNG screenshots were captured explicitly after upstream changed its generic screenshot helper to JPEG. Root docs checks passed 2/2 and the link checker passed; they are rerun after this evidence update. Scoped formatting checks passed.
- Limits: The existing favicon 404 and large-bundle warning remain explicit, separate from music acceptance. No human, webcam, musical-quality or performance proof is inferred.


## 2026-10-25T04:10:41+05:30 — Eight licensed full songs and 24 generated charts (issue #2)

- Changed: Extended the explicit music acquisition/generation lists with Chipper Doodle v2, Funkorama, Cut and Run, Rhinoceros and Marty Gots a Plan. Added five unchanged official CC-BY 4.0 MP3s (35,593,862 bytes total), exact attribution/acquisition receipts and 15 generated maps; regenerated the entire eight-song/24-map pack with main's generator version 2 after integrating cfdcc40. Refreshed the manifest, measured metadata, credits/docs and audio/PCM/map integrity tests. Existing paging assertions now use the registered page capacity instead of assuming the entire library fits in one page; production UI is unchanged.
- Why: Fulfil issue #2's 3 → 8 licensed local library, with catalog tempo/genre variety (92–140 BPM for the additions), measured durations of 168–214.766 seconds and preserved source identity.
- Validation: Official catalog/track-page license templates verified at acquisition; all hashes/receipts retained. Shared generation/validator passed all 24 maps. Full npm run check on cfdcc40 passed typecheck, lint, 48 suites/380 assertions and production build; scoped Prettier checks passed. Root docs tests passed 2/2 and the link checker passed. Native Chrome 155/SwiftShader at 1440×900 and 1024×640 selected all eight songs/all 24 difficulties, started/stopped the original preview, paged the library and checked all eight exact credits offline. After main's renderer/UI merge, another browser run repeated all eight Normal selections/credits/preview at both sizes. Reports and inspected screenshots are linked from docs/evidence/2026-10-25-eight-song-library.md.
- Limits: No live-camera, human musical-quality, comfort or performance claim. The existing large-bundle warning belongs to issue #1; unrelated favicon 404 responses remain recorded. Initial shared-cache install failure, three obsolete paging assertions and two browser-driver failures are disclosed in the evidence; the corrected checks pass. Final integration with any newer remote main is recorded separately.
## 2026-10-25T05:42:41+05:30 — Integrate the merged bundle gate into PR #7

- Changed: Normally merged main after PR #6 and made the contributor check sequence describe the current bundle gate.
- Validation: Repeated documentation checker tests and local-link validation; no application behavior changed. CI runs the full integrated application check.
- Limits: Guide evidence retains its recorded historical source; no live-camera or release gate is claimed.

## 2026-10-25T05:40:37+05:30 — Audit player guides against current main

- Changed: Normally integrated main `97bf0d3`, preserving its showcase README and restoring links to the player, troubleshooting and contributor guides. Updated the live button to **Play with camera**, documented the main-menu camera actions and steady-framing auto-confirmation, distinguished camera setup Cancel from pre-play Esc, and replaced a removed README fragment with the player guide's camera setup link. The contributor guide explicitly identifies the pending bundle-budget check integration.
- Why: PR #7's frozen screenshots retain honest historical provenance, but the instructions and local links must follow current controls and documentation before merging.
- Validation: Root documentation tests passed 2/2; checker passed 52 Markdown files / 608 local links / zero errors. Both staged and working-tree whitespace checks passed. The final documentation checks were repeated after this entry.
- Limits: Documentation audit and normal integration only; no new browser, webcam, human, audible-sync or performance evidence. The application changes are inherited from main and receive the sequential PR integration checks separately.

## 2026-10-25T05:28:45+05:30 — Refresh player guides for auto-play and the avatar

- Changed: Normally integrated exactly main `30572bb` into the existing issue #5 guide branch, preserving the incoming quick start and guide links. Updated the three guides' affected action/source wording to **Watch auto-play** and **Play level**, removed claims that the current neutral run screens show source banners, and retained explicit synthetic-performer/dataset limitations. Refreshed all four small WebPs in `docs/images/` and added the scoped source/browser/results/hash record `docs/evidence/2026-10-25-guide-capture-30572bb.json`.
- Why: The visible buttons and avatar changed after the original guide checkpoint. Freeze this requested source explicitly so player instructions and illustrations match the tested app.
- Validation: `npm run check` passed typecheck, lint, 481 tests in 55 files and production build. Native Chrome 155.0.8059.86 actions completed Pamgaea Normal → Enable sound → Watch auto-play → actual 80-second results → Songs twice (one diagnostic preflight and one normal-interface capture): 54,700 score, 84 Perfect, zero other note judgements and 100% accuracy. Inspected the four final 1440×900/1024×640 captures; verified their WebP signatures/hashes and that the final checked build's index hash matches the captured build. Root docs tests passed 2/2; checker passed 51 Markdown files/582 local links/zero errors. Whitespace validation passed before commit.
- Validation failures retained: The initial harness label equality included the button's **Demo run** caption; corrected the selector assertion. The diagnostic preflight's console-empty gate failed on the upstream `THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.` warning. The final capture gate requires no JavaScript errors/exceptions and retains that same warning; it does not claim an empty console. The frozen upstream build also emits its existing large-chunk warning.
- Limits: Documentation/capture maintenance only; no application behavior authored. Headless SwiftShader with muted output supplies no webcam/person, audible-sync, accessibility, comfort or GPU-performance acceptance. Historical 131-note guide results remain historical; these refreshed captures use the actual current 84-note arrangement.

## 2026-10-25T04:20:26+05:30 — Final guide verification checkpoint at main 52e9c81

- Changed: Normally integrated main `52e9c81`, preserving its interface/training changes. Rechecked the new pause summary, keyboard focus, short-window styling and source-specific performer footer; refreshed all four guide captures and their exact source provenance. The issue #5 diff remains the requested guides/images/links and required contribution records.
- Why: Main continued changing during the issue pass. This is the explicit tested source checkpoint for the documentation PR; later unrelated work does not become untested evidence in these captures.
- Validation: `npm run check` passed typecheck, lint, 369 assertions in 48 files and production build. Root docs tests passed 2/2; checker passed 50 Markdown files/555 local links with zero errors. The prepared build completed the full native-action Pamgaea Normal synthetic-performer run to actual results (90,800 score, 131 Perfect, zero other note judgements, 100% accuracy), then returned to Songs. Chrome console was empty; all refreshed 1440×900/1024×640 WebPs were inspected, including the corrected synthetic-performer footer. Whitespace validation passed.
- Limits: Same synthetic/headless SwiftShader/muted-output and human/live/performance limits as the preceding entries. The existing large-bundle warning is retained for issue #1. No application behavior was authored for this issue.

## 2026-10-25T04:13:14+05:30 — Recheck issue #5 guides against latest main

- Changed: Normally integrated main `752acf3` after the documentation milestone. Updated the exact **Start live play** label, distinguished the prepared-photo inference lane in the contributor diagram/text and refreshed all four WebPs plus capture provenance for the new dataset-camera Settings page/pager totals. Preserved every upstream tracking/evidence change and changelog entry.
- Why: Issue #5 requires wording and captures to be rechecked against the latest main before opening the PR; main advanced after the first validated milestone.
- Validation: Rebuilt the production app; repeated real native menu actions through the complete Pamgaea Normal 80-second synthetic-performer run → results (90,800 score, 131 Perfect, zero other note judgements, 100% accuracy) → Songs. Inspected all four current captures at 1440×900/1024×640; Chrome console remained empty. `npm run check` on the integrated source passed typecheck, lint, 367 assertions in 48 files and build. Root documentation checks and whitespace validation were rerun before the merge commit.
- Limits: Synthetic/browser documentation evidence only, with the same declared webcam, audible-sync, human/accessibility and performance limits as the preceding entry. The upstream large-bundle warning remains assigned to issue #1; this PR adds no application behavior.

## 2026-10-25T04:06:23+05:30 — Player, troubleshooting and contributor guides (issue #5)

- Changed: Added `docs/player-guide.md`, `docs/troubleshooting.md` and `docs/contributor-guide.md`, linked from README and the documentation index. The guides cover current setup/menu flow, gestures and judgement windows, Calm/difficulty/80-second arrangements, exact searchable recovery messages, code/data flow, current commands, the tunable registry and evidence/commit conventions. Four small actual-app WebPs under `docs/images/` show the desktop menu, labelled synthetic play, results and compact menu; their source SHA/browser/rendering limits are stated in the player guide. `AI_USAGE.md` records the contribution and independent review.
- Why: Issue #5 requests accessible player and contributor entry points verified against the app, without replacing the normative specifications or claiming unobserved capabilities.
- Validation: Fetched/integrated concurrent main updates through `cfdcc40`, rechecked UI/error/renderer sources and refreshed all captures against its production build. In isolated headless Chrome 155.0.8059.86/SwiftShader with muted output, native menu actions completed Pamgaea Normal → Enable sound → synthetic performer → actual 80-second results (90,800 score, 131 Perfect, zero other note judgements, 100% accuracy) → Songs; console errors/warnings were empty. Inspected captures at 1440×900 and 1024×640. Final `npm run check` passed typecheck, lint, 367 assertions in 48 files and build. Root docs tests passed 2/2 and the final checker reported 50 Markdown files/554 local links/zero errors. Prepared-server tests passed 5 with 1 host-limited symlink skip. `git diff --check` passed.
- Validation failures retained: The first `npm ci` hit a shared npm-cache ENOENT/corrupt-tarball error; an isolated-cache install succeeded without changing dependencies. An intermediate unchanged suite under parallel host load timed out the existing audio-arrangement test at its 20-second limit (362/363 passed); the final unchanged suite above passed without widening any timeout. Two retries were interrupted to integrate newer main or stagger concurrent checks. Initial temporary capture-harness selector quoting was corrected, and captures were repeated after entrance animations settled.
- Limits: Documentation and synthetic-input/browser evidence only; no webcam/person, audible synchronization, screen-reader/standing-distance, comfort/flashing or GPU-performance acceptance. The existing large-bundle warning remains for issue #1. No application behavior or dependency changed in this commit.
## 2026-10-25T06:05:00+05:30 — Camera play on the main menu

- Changed: **Set up camera** sits next to Enable sound on the first play page. Once calibrated, the main action becomes **Play with camera** (live play); Watch auto-play and Play level stay available. Holding a steady, framed pose for `CALIB_AUTO_CONFIRM_MS` confirms camera setup and starts the live count-in without returning to the mouse.
- Why: User asked to integrate the camera properly; setup and live start were hidden in Settings and required mouse clicks while standing back.
- Validation: Full `npm run check` passed. Live webcam behaviour still needs the user's hands-on test.
- Limits: No consented live session has been recorded by the agent.

## 2026-10-25T05:45:00+05:30 — Walls only cost points

- Changed: A wall hit now deducts `SCORE_WALL_PENALTY` (100, floored at zero) and no longer breaks the combo. Walls never pause or stop the run: frames without a body cannot hit a wall, and an unobserved wall passes with neither penalty nor reward. Merged the remote README showcase (#10) with the user's local README edit.
- Why: User direction — touching a red wall should just reduce points. The old body-tracking pause during walls made live play feel like it ended whenever tracking flickered.
- Validation: Full `npm run check` passed (482 tests), including new score and session assertions.
- Limits: No live-camera play yet; that integration follows.

## 2026-10-25T05:41:22+05:30 — Audit and integrate PR #6 bundle enforcement

- Changed: Normally integrated current main, preserving its README and camera/game changes. CI now runs the complete application check including bundle budgets. Added the existing postprocessing dependency to its own chunk; no dependency or runtime feature was added.
- Why: Review found CI skipped the budget command, and the integrated application entry measured 530999 bytes, exceeding the unchanged 500000-byte limit.
- Validation: Full npm run check passed (482 application tests, three budget regressions, typecheck/lint/build); all ten chunks pass, largest 363984 bytes. Docs checker tests (2) and local-link checker passed. A fresh headless production-menu smoke reached SELECT with three songs and a canvas, with zero runtime errors; browser cleanup is recorded separately if it fails.
- Limits: This validates build integration and camera-free startup, not live-camera play, audible synchronization or release performance gates.
## 2026-10-25T05:35:00+05:30 — README quick start

- Changed: Rewrote the README run section as a quick start: requirements, clone/install/run commands, the play flow (pick song, Enable sound, Watch auto-play or Play level, pause), gesture summary, command table and troubleshooting.
- Why: User asked for how-to-run instructions in the README.
- Validation: Documentation checks passed.
- Limits: Camera play is described as a later step; it is paused by the user.

## 2026-10-25T05:25:00+05:30 — Synthetic performer reel for the dataset camera

- Changed: new `tracking/performerReel.ts` renders the skinned avatar (`AvatarFigure.poseFromJoints`, natural variant, no outline) in a plain room from a virtual front camera framed to `PERFORMER_SHOULDER_WIDTH_NORM`, posed each frame from `Choreography`/`performerJoints` on the session song clock (rest pose outside a session; arm and face depth from the rig's proportions), drawn into the dataset-camera canvas. Enabled with `?camera=dataset&reel=performer`; evidence lane `dataset-camera-synthetic-performer` (reels may now declare their lane; the runtime keeps the last lane after the camera stops). `?stats=1` diagnostics expose the current dataset frame image (never for a webcam). Harness lane `performer` (low tier) saves the rendered camera frame. Registered the PERFORMER_REEL_* constants.
- Why: exercise the real camera → MediaPipe → scoring path with a moving performer.
- Validation: `npm run check` 424 tests in 50 files and build passed; trial: MediaPipe detected pose and both hands in 100% of rendered frames, handedness 690/690. Calibration was not accepted at 3.5 Hz / 311 ms inference under 82–86% machine load, so no notes were scored through the camera.
- Limits: synthetic render, not a person or webcam; the avatar's head renders tilted (face error ~0.5 shoulder widths); play-to-results comparison with the logic replay still needs an idle machine.

## 2026-10-25T04:59:57+05:30 — Resolve the release-drill PR's newer main integration

- Changed: Normally integrated main `db45982567a217f861cd94e576d4629201a84a13` after the PR was opened; preserved its HUD/projection, camera-reel, training and historical work. Exported the existing browser journey unchanged so the post-integration prepared-build smoke check reuses the actual driver rather than duplicating it. The default release command still performs its fresh clone/install/check/build sequence.
- Why: GitHub reported the focused PR needed integration with newer main. Keep the clean-clone evidence at its real `10bca5e` SHA and exercise the changed presentation path separately.
- Validation: The integrated application passed typecheck, lint, 481 assertions in 55 suites and production build. Documentation validation passed. The exact browser journey follows on the committed prepared build; the earlier positive/negative clean-clone proof remains intact.
- Limits: The supplemental prepared-build run is not a new clean-clone/install result and is labelled separately. No camera, person, recognition, audible-sync or performance claim is added.

## 2026-10-25T04:51:52+05:30 — Verify the normally integrated release-drill snapshot

- Changed: Refreshed the canonical passing JSON/Markdown from the actual committed integration `10bca5ef1aa1aada09c06b1ead5139f7f4bf11c6` (main `09671b7`), archived the previous `d14c980` pass byte-for-byte, and updated docs17 to distinguish each tested source. This final evidence publication changes documentation only.
- Why: New charts, sound-worker/audio behavior, score/results and rendering landed on main after the first passing candidate; those changes need their own actual browser outcome rather than inheriting the earlier numbers.
- Validation: The real release command exited 0 from a clean invoking checkout and fresh committed clone. `npm ci`, full application check (480 assertions/54 suites) and explicit production build passed. BOOT → selection → native sound unlock → the updated 80-second performer → Results yielded 84 Perfect, zero misses and 54,700 score. Retry → play → pause → Songs passed. All 17 observed app requests were local, with zero runtime/console/CSP/interception errors; temporary-directory cleanup succeeded. Earlier deliberate catalog-404 command exited 1 with failure evidence at its explicitly recorded `d14c980` SHA. The unchanged helper/browser regression coverage previously passed 6/6; root docs tests/checker passed for the publication.
- Limits: Planned synthetic landmarks and headless Chrome, no camera/person or recognition proof. The browser is blocked from external destinations after installation; this is not an unplugged-network or audible-sync test. No performance or complete P5 gate is claimed, and later main commits are outside this frozen snapshot.
## 2026-10-25T05:22:18+05:30 — Showcase README with real browser media and measured evidence

- Changed: Rebuilt `README.md` around real auto-play footage, a screenshot feature grid, exact run instructions, gesture controls, Mermaid architecture, measured numbers, source layout, roadmap and asset credits. Added `docs/media/`, the reusable `scripts/capture-readme.mjs` browser harness and `docs/evidence/2026-10-25-readme-metrics.json`; updated `AI_USAGE.md`. Application source is unchanged from remote main `30572bb9cdbe345b79e8e48279019bd7d8b59877`.
- Why: Make the project page demonstrate its working interactions while replacing stale test/asset/training counts with source-identified evidence. Synthetic auto-play, static annotations, dataset-camera inference and separate training results retain their distinct scopes.
- Validation: Fresh-worktree install succeeded with an isolated npm cache after the default cache failed with ENOENT/corrupt-tarball warnings. `npm run check` passed typecheck, lint, 481 tests in 55 files and production build. Targeted performer replay passed 13/13: all 1,643 notes Perfect across nine full charts, zero bad cuts/wall collisions. Chart report and asset structural checks passed; asset regressions 3/3; all 56 synthesized full/Calm renders matched the receipt. Real headless Chrome UI completed an 80-second Normal Pamgaea arrangement: 84 Perfect, zero misses/bad cuts, 100.0% accuracy, score 54,700 and rank SS. Capture script syntax and whitespace checks passed. Final documentation tests passed 2/2; 49 Markdown files and 574 local links checked with zero errors. All three GIFs/five screenshots were visually reviewed; ffprobe verified GIF dimensions/durations/frame counts, and all eight media lengths/SHA-256 hashes match the capture receipt.
- Limits: Captures use synthetic hands through the real judge, not a webcam. Retained COCO photo and oracle-crop training measurements were not rerun. Latest main still emits a >500 kB JavaScript chunk warning; measured entry size is 1,373,350 raw / 412,107 gzip-level-9 bytes. The capture retained a Three.js non-indexed-geometry warning; no runtime exception or live-camera/FPS/latency/release claim was introduced.

## 2026-10-25T05:20:00+05:30 — Back-facing avatar and neutral run labels

- Changed: The arena avatar is rotated 180° so the viewer sees its back; tracking/performer joints keep their screen sides and forward reach goes into the lane (`AVATAR_FACE_AWAY`). The virtual-camera performer pose still faces the camera. Removed the visible dataset/synthetic/no-camera banner, status, captions and pre-roll copy; buttons now read **Play level** and **Watch auto-play**. Added HANDOFF summary of the multi-agent round.
- Why: Direct user requests: avatar back turned to the player, and no on-screen "dataset instead of camera" wording. Camera integration is paused by the user.
- Validation: Full `npm run check` passed (481 tests). Exported diagnostics still name the source lane.
- Limits: Hand shapes on the turned avatar use reflected landmark geometry; not tuned.

## 2026-10-25T04:58:00+05:30 — Rigged avatar replaces the outline and line figure

- Changed: `render/renderer.ts` loads `avatar.glb` (tier `AVATAR_TIER_FIGURE`; low tier and load failure keep the line skeleton) and drives it from tracking/dataset/synthetic frames, an illustrative idle in the menu placeholder (static in Calm), a frozen pose when paused and the saved pose in results; the mask silhouette and line skeleton hide while the avatar shows. The avatar draws after the arena and before a depth-clear sentinel so all targets/effects render over it, in both the post-FX and direct paths. `MenuShell` `Figure` shows the SVG outline only when the avatar failed or is disabled and reports the placeholder state to the renderer. Fixed side mapping for ears/eyes/hand points in retargeting. Placeholder scale/height retuned.
- Why: The user asked for a moving person model built on the tracked skeleton instead of the stick outline and thin lines.
- Validation: typecheck and lint clean; 480/480 tests across 54 files. Embedded browser at 1440×900: menu idle shows the holographic avatar; "Watch synthetic performer" pre-roll and play show it driven by the performer with hands on the cursor rings and open/fist hand shapes, targets drawn over it.
- Limits: No live webcam exercise; dataset-trial visual check not repeated after the merge; no GPU timing. Holographic material and proportions are a first pass.

## 2026-10-25T04:50:00+05:30 — Blade ribbons, hand particles and a cleaner shatter

## 2026-10-25T04:49:34+05:30 — Partial COCO + MPII run evaluated and exported

- Changed: Compact dataset storage so worker processes no longer get a pickled copy of every index row (40.5 MB down to 12.9 MB per worker; items are byte-identical on 36 checked samples). Training now uses 1 DataLoader worker, and export checks the training contract instead of the raw config hash. STATUS.md/STATUS.json, training/README.md and README.md now record the partial run.
- Why: The user asked to wrap up. The run was stopped at step 1,800 of 7,210 while the machine was memory-thrashing.
- Validation: Full held-out evaluation (3,776 people, oracle crops): heatmap loss 0.00416 and pooled PCK@0.2 0.334 (COCO 0.393, MPII 0.310), compared with the untrained head (0.01808 / 0.016), the 3-step preflight (0.02128 / 0.014) and a mean-pose-in-crop guess (PCK 0.093). ONNX parity passed on 16 crops (1.8e-6). Unit tests pass 12/12.
- Limits: This is a partial run: one epoch plus 358 batches, and the schedule never annealed. Results use oracle crops, with no detector and no browser or webcam evaluation. The model was not promoted, and the game keeps MediaPipe.

## 2026-10-25T04:47:08+05:30 — Browser check of the synthesized SFX in the performer trial

- Changed: Documentation only (this entry).
- Why: Record what the headless browser run of the new SFX wiring actually showed.
- Validation: Production build served by `scripts/serve.mjs` in headless Chrome (48 kHz, reported output latency 40 ms), driven over CDP with trusted clicks: Pamgaea → Enable sound → hover three buttons → Watch synthetic performer, one Escape pause and Resume, run to results. A read-only page probe counted buffer starts by shape: uiEnable 1, uiHover 3, countNeutral 3 (scheduled exactly −2.000/−1.339/−0.673 s before song start; final tick rate 1.25), smash 69, slash 58, sparkle 130, glint 1, zap 4, poof 4, charge 4, combo 3 (rates 1–1.498), milestone 4 (rates 1–2), wallWarn 2 (scheduled ahead, panned −0.55 toward the left wall), dodge 2, resume 2, resultsHigh 1; hit pans spanned −0.55…0.55, jitter rates 1.01–1.05. Analyser taps measured peak 0.623 on the master output and 0.654 after the SFX limiter, with no full-scale samples. No console errors.
- Limits: Headless output, nothing heard; analyser polling every 20 ms can miss short peaks. The Vite dev server could not be used for a long run because the pinned HMR socket fails and reloads the page. The second `resume` cue was not traced.

## 2026-10-25T04:46:22+05:30 — Integrate current main before final release-drill verification

- Changed: Normally integrated main `09671b7b6f5a6f1d89fa756cd6c825f58abd4bba`, preserving the new charts, avatar/target rendering, SFX worker, score/result changes and their existing history. The release harness, favicon fix and recorded failures remain scoped to issue #3.
- Why: The user requests frequent pulls; the current main contains material application changes beyond the earlier tested candidate, so its evidence cannot be borrowed from that older SHA.
- Validation: The integrated worktree passed `npm run check`: typecheck, lint, 480 assertions in 54 suites and production build. Root docs tests passed 2/2; 53 Markdown files / 546 links checked with zero errors. The earlier positive and negative clean-clone runs remain explicitly tied to `d14c980`.
- Limits: This integration's actual CLI/browser run follows after committing the exact snapshot. No new webcam, human, audible-sync or performance claim is made; later remote changes are outside this frozen candidate.

## 2026-10-25T04:43:58+05:30 — Judgement pops at the hit position and combo-break note

- Changed: `core/judgementPops.ts` keeps a pooled `MAX_POPS` queue of terminal judgements with world positions (impact point for hits, hit-plane note position for Miss/Bad Cut) and Great/Good timing error; the runtime pushes on `note:hit`/`note:miss`/`note:badcut`, prunes after `POP_LIFETIME_MS` at the UI tick (so Calm pops also expire) and clears outside PLAYING/PAUSED. The HUD projects each pop through `ui/projection.ts` (mirrors the static play camera: `CAM_POS`, `CAM_LOOK_AT`, `CAM_FOV_DEG`, full viewport) into six pooled slots, moving text out of the central `HUD_POP_TORSO_CLEAR_FRACTION` band; the central single judgement was removed. Breaking a combo of at least `HUD_COMBO_BREAK_MIN` briefly tints the ring/count and shows “Combo ended · N” (cleared by the next hit); no scene shake. Removed the interim `judgementSeq` field. Both constants are registered in docs02.
- Why: Requested positional pops and readable, non-punishing combo-break feedback.
- Validation: Typecheck, lint, 426/426 tests in 51 files (new queue test; HUD test renders a projected Great with timing), build, prettier and docs checks passed.
- Limits: Not screenshot-verified in a browser this step; the projection must follow any future camera choreography. The compact pre-roll overlap item was not started.

## 2026-10-25T04:42:00+05:30 — Hit spark bursts and subtle gameplay camera response

- Changed: `render/sparks.ts` adds a bounded spark pool (`HIT_SPARK_POOL` × `HIT_SPARKS`, one additive Points draw, closed-form motion, seeded directions) for Slash hits (spray flattened into the cut plane) and Smash hits; tier count follows the poof preset and Calm halves it. `render/cameraRig.ts` adds trauma-based smooth value-noise shake (hits, perfect, bad cut, obstacle, kick, drop; capped by `SHAKE_MAX_M`/`SHAKE_MAX_ROLL_DEG`) and a `CAMERA_BASS_FOV_DEG` breath, active only in play and never in Calm.
- Why: Hit payoff and kinetic response from docs 11–13, kept restrained per the user's playability request.
- Validation: Lint, build and 64 render/quality/slicer assertions pass; synthetic-performer trial screenshot in native Chrome inspected (planned motion, no camera).
- Limits: No frame-safety projection test for the shake, no GPU timing, no flashing review.

## 2026-10-25T04:41:00+05:30 — Dataset camera trial evidence and docs

- Changed: added `docs/evidence/2026-10-25-dataset-camera-trial.md` with the final run's JSON, per-lane app evidence and setup screenshots; docs05 §1.3, docs17 §3, docs24 §2/§9 and README describe the dataset camera, harness and judgement trace (docs05 handedness link now points at the trial report). The camera controller keeps the last stopped source's evidence so failed dataset runs stay inspectable. A refused camera Confirm (readiness lapsed between display and click) now shows the existing framing status instead of being ignored silently. The harness treats a guard flipping between check and click as "not yet clickable", retries guarded clicks like a persistent user, waits for a genuinely new setup preview and handles fatal pauses.
- Why: record what works and fails through the real camera path.
- Validation: `npm run check` 367 tests in 48 files and build passed; docs tests 2/2 and docs checker 0 errors. Trial: canvas stream and Chrome fake webcam both reached GPU preview; pose detected on 24/24 photos; median per-photo joint error 0.118 shoulder widths; handedness agreement 369/393 under the new mapping; calibration with the declared-rule photo never framed (one hand); with the measured photo framing became ready but Confirm was not accepted under 2.6–5.5 Hz tracking.
- Limits: whole-machine CPU was 52–100% busy before and ~100% during lanes from unrelated training/Blender/agent work, so timings are not performance evidence and the play → Results → Retry flow was not reached. Still photos only; not webcam evidence.

## 2026-10-25T04:40:56+05:30 — Passing release drill and deliberate missing-asset failure

- Changed: Published the real release-drill command and evidence links in `README.md` and docs17/19. Retained dated passing/missing-asset JSON and Markdown plus earlier failures. Bound the worker regression fixture to its created target ID and deliberately opened another blank page to prevent a later page from stealing the inspected session. Cleanup now has a separate useful Markdown error and bounded retries within the validated own temporary directory; it never kills unrelated Chrome processes.
- Why: Issue #3 requires a reproducible clean-commit installation and actual offline browser journey, plus proof that a broken step yields failure evidence and a nonzero exit.
- Validation: Both real commands tested `d14c980aca096e530586a771983edfb65ca22cdd` in fresh clones: install, full application check (367 assertions/48 suites) and explicit production build passed. The positive command exited 0 after BOOT → select → native sound enable → actual 80-second synthetic performer → Results (131 Perfect, 90,800 score) → Retry → play → pause → Songs, with 16 local requests and zero runtime/console/CSP/interception errors. The negative command removed only the cloned prepared catalog, observed its actual 404/menu error, wrote failure evidence and exited 1. Five pure-helper tests plus the real worker browser regression passed (6/6). A preceding worker-test rerun timed out because its fixture used the last ready page; the target-ID correction passed with an intentionally later blank page. Root documentation tests/checker passed.
- Limits: These reports identify their exact tested SHA and exclude later main integrations. Installation uses network and a task-specific npm cache; only the browser stage blocks external destinations. Camera/model preparation, actual people, audible sync, performance and the remaining P5 gates are excluded. Auxiliary raw command logs are generated locally; committed JSON includes exit codes, timings and output tails. Cleanup failures remain failures with their own message and retained directory, not fabricated gameplay failures.

## 2026-10-25T04:38:46+05:30 — Keep the bundle PR current with generator v3 and target assets

- Changed: Normally integrated main `87032d0`, refreshed production-preview evidence and visually inspected menu/performer WebP captures. Updated docs16; application/runtime code remains unchanged by issue #1.
- Why: Keep the open PR valid after the chart/avatar/target work landed without reusing old-source results as new proof.
- Validation: `npm run check` passed (typecheck/lint, 424 assertions/50 suites, production build without a chunk-size warning, three budget regressions). All eight JS chunks pass; the entry is 443013 raw/161024 gzip bytes. Real dataset results: 86 Miss/0 hits; synthetic results: 86 Perfect/0 misses; Songs return passed after both. Menu and play captures show the arena. Root documentation tests/checker and whitespace checks are rerun before commit.
- Limits/failures: Application assertions passed at `18745d446601dee57176078eef22ea87ab5d2a5c`; one upstream geometry warning and favicon 404s are retained. The temporary probe later exited 1 during optional profile cleanup (Windows EBUSY lockfile), and the profile was left safely in place. The JSON separates this cleanup failure from application results. No performance gain, live-camera or release completion is claimed. Earlier source-identified measurements remain intact.
## 2026-10-25T04:39:19+05:30 — Results hits by gesture

- Changed: `render/blade.ts` adds per-hand blade ribbons (white-hot core plus tinted additive glow) rebuilt into preallocated buffers from the measured `HandCursor.history`, uniformly resampled by arc length, drawn length eased by a critically damped spring (`BLADE_LENGTH_SPRING_RAD_S`), reset on reacquisition and guarded against degenerate tangents. `render/trails.ts` adds tier-sized GPU particles per hand (two-ring orbit, fist knot, point cone; band-driven orbit speed, twinkle off in Calm) that elongate onto the blade spine. The renderer feeds the latest cursors (visual only) and hides trails in results/paused. Shatter pieces start at `SHATTER_PIECE_SCALE`, vanish by `SHATTER_VISIBLE_FRACTION` of the lifetime, use saturated magenta cross-sections and darker rims; the dev preview no longer has a hands toggle.
- Why: The doc 12 blade/particle look was missing and busy smash runs still filled the near field with pale pieces.
- Validation: New `tests/renderTrails.test.ts` (4 assertions: monotone growth to the measured length, hilt on the palm, retract/reset, no NaNs on stationary history, tier draw ranges). Typecheck, lint and build pass; full vitest 364/366 — the two failures are arrangement-audio tests timing out under concurrent Blender/Chrome load (20–60 s each), unrelated to rendering. Native Chrome synthetic-performer screenshots (planned motion, no camera) inspected.
- Limits: Tip sparks, beam-noise cylinder and hit spark bursts are not implemented; no allocation profile or GPU timing was measured.

## 2026-10-25T04:39:19+05:30 — Results hits by gesture

- Changed: `SessionStats.byType` records hits versus chart totals for slash, smash and beam. `ScoreState` derives totals from the map and counts each hit once (`hit(judgement, type)`); `GameSession` passes the note type and syncs the copy. Results shows “Hits by gesture” bars with gesture icons on the second left page (and a compact page) beside the motion estimate.
- Why: Requested breakdown; `SessionStats` did not expose it.
- Validation: New score test checks per-type totals, single counting, snapshot isolation and that per-type hits sum to perfect+great+good; full suite, typecheck and lint passed.
- Limits: Bad cuts and misses are not split by type; no browser screenshot yet in this step.

## 2026-10-25T04:37:00+05:30 — Blade ribbons, hand particles and a cleaner shatter

## 2026-10-25T04:36:52+05:30 — Original synthesized SFX set and audio feel wiring

- Changed: Replaced the 7-tone placeholder SFX with 28 original cues synthesized from code (`app/src/audio/sfxSynth.ts`: TPT filters, polyBLEP oscillators, FM bells, grains, Karplus–Strong, small room), each normalized to a registered BS.1770 momentary loudness under a soft-knee −5 dBFS ceiling, with Calm renders 3 LU quieter and low-passed. Added `sfxMetrics.ts` (K-weighted loudness, peak, centroid), `sfxRender.worker.ts` + `sfxBank.ts` (off-main-thread rendering, validated LRU cache, inline fallback), `tonic.ts` (Krumhansl–Kessler tonal-centre estimate so pitched gameplay cues follow the track), a rewritten `sfx.ts` bus (per-voice stereo panner, per-sound and global voice caps with oldest-voice stealing, hard-knee limiter with spec makeup trimmed out, scheduled starts/offsets, pause-aware silencing that keeps future cues, full disconnection on stop/dispose) and `sfxDirector.ts`, which subscribes to game, lifecycle, store and DOM events. Wired: hits by gesture and judgement (Perfect sparkle, Great glint layers; lane/hand pan; swing-speed dynamics; early hits snap to chart time), bad cut, rate-limited miss, beam charge riser per hand and zap on fire, wall warning timed to arrival from the wall side, wall hit, dodge, multiplier and milestone rewards transposed by key mode, soft combo break, chart-timed drop sting, countdown ticks for both start paths (pitched for confident tempo, unpitched neutral ticks otherwise), resume, results sting by rank, unlock chime, menu hover/focus/confirm/back/select and hand-pointer hover/arm/activation. `core/runtime.ts` now constructs the director and calls `attach`, `beginSession`, `hands`, `pointer`, `menuAction`, `stop` and `dispose`; the old per-event `play` calls are gone. Registered the new `SFX_*` constants in `constants.ts` and docs/02 (removed `SFX_SYNTH_*`, `SFX_PITCH_JITTER_CENTS` 69 → 35), rewrote docs/15 §6, noted neutral ticks in docs/15 §2.1, and added `scripts/render-sfx.mjs` with the 48 kHz receipt `assets-src/audio/sfx-receipt.json`.
- Why: Only the bus was constructed and a few events played near-identical noise tones; the performer trial path scheduled no countdown at all. The user asked for a premium, cohesive and tight original SFX set with distinct gesture timbres, judgement layering, musical pitch, restrained loudness and correct pause/quit behaviour. Runtime synthesis renders at the device rate without decode or resampling, makes Calm and per-track tuning cheap, avoids uneven Ogg Vorbis support and means the tested buffers are exactly the played ones. Loudness rather than peak normalization was adopted after measuring that peak-normalized crackly cues varied by 2.8 LU between 44.1 and 48 kHz.
- Validation: `npm run check` passed (typecheck, lint, 384 tests in 48 files, production build with a separate 21 kB SFX worker chunk). New suites: `sfxSynth.test.ts` (determinism, receipt hashes, loudness/peak/DC/edge bounds, role balance, gesture centroids, Calm, sample-rate consistency, tonal transposition, wall-peak and charge-ping timing, tonic estimates), `sfxBus.test.ts` (unlock, limiter trim, scheduling, per-sound/global caps, jitter, pause boundary, release, retries, bank validation/fallback/LRU/warm order) and `sfxDirector.test.ts` (every event mapping, countdown modes, drop lookahead, store/DOM/pointer cues, charge lifecycle, tuning, disposal); `runtime.test.ts` now separates music from SFX sources and adds an unlock/countdown/quit lifecycle case. `node scripts/render-sfx.mjs --out … --ffmpeg` agreed with ffmpeg ebur128 within 0.1 LU on all 56 renders. Docs checks passed (47 files, 521 links).
- Limits: Nothing was listened to; balance against each track, audible stacking, the drop duck and audiovisual skew need a recorded listening check on real speakers. Paused-screen menu cues, a pause sting and resume-countdown ticks are silent because pause suspends the shared context. The tonal estimate is a cosmetic heuristic (Electro Cabello correlates only 0.57). There is no master limiter on the music path. docs/14 still describes a `combo` cue on the SS/S rank letter; the implemented cue is the results sting on RESULTS entry.

## 2026-10-25T04:26:00+05:30 — Fine beat-period search; two bundled songs now beat-confident (generator v4)

- Changed: `beatmap/dsp/tempo.ts` adds a fine period search (`TEMPO_REFINE_RANGE` ±1%, `TEMPO_REFINE_STEP` 0.01%) that keeps the period whose best rigid-grid phase aligns the most supported onsets (`gridAlignment`), taking the middle of the maximum plateau. `GENERATOR_VERSION` is 4; the nine bundled maps, receipts and manifest were regenerated. Electro Cabello and Cipher are now confident, beat-snapped maps with manifest BPM 117 and 150; Pamgaea stays onset-only. Docs 02/08/09 and the tracks README record the method, the new visibility/hand-budget validation rules and per-map counts.
- Why: All three songs disclosed low tempo confidence although their detected tempi were within 1 BPM of the catalog. Hop-quantized span refinement left the period a fraction of a BPM off (94.1/117.2/150.8), so a song-long grid drifted out of the ±35 ms tolerance and alignment confidence collapsed (0.159/0.202/0.230).
- Validation: Refined tempi are 94.0/117.0/150.0 BPM, matching the publisher catalog (94/117/150), which the analysis never reads; confidence 0.252/0.496/0.558 against the 0.35 gate. A new syncopated 117 BPM synthetic click test fails without the search (117.2 BPM, low confidence) and passes with it; the 128 BPM, 90/180 BPM octave, noise and hum tests still pass. v4 charts: Electro Cabello 117 (57/51/9), 176 (104/64/8), 281 (132/135/14); Cipher 111 (59/41/11), 195 (98/82/15), 266 (108/140/18); Pamgaea unchanged from v3. The performer still reaches every note of all nine charts. `npm run check` passed (typecheck, lint, 376 tests in 46 files, production build); prettier on changed sources and both docs checks passed.
- Limits: The search maximises the same alignment used for confidence, so it carries a small upward selection bias; catalog agreement is independent evidence only for these three tracks. No annotated beat fixtures or held-out beat F-measure exist yet. Pamgaea's strong onsets are mostly syncopated, so its 94.0 BPM is not claimed as confident.

## 2026-10-25T04:24:06+05:30 — Correct worker blocking in the release harness

- Changed: `release-drill.mjs` now applies an ordered CDP Network origin allowlist to app page/worker targets, uses Fetch interception only on page/frame targets, and excludes Chrome's internal `browser_ui` targets. Added `scripts/release-drill.browser.test.mjs`, a real isolated-Chrome regression that resumes a dedicated worker, permits its loopback fetch and verifies an external fetch is blocked by the inspector before network access. Retained the first committed-candidate failure and the previous browser attempt unchanged.
- Why: The actual `b9b1a85` drill passed clean-clone installation, all 367 application assertions and production builds, then exposed `Fetch.enable` as unavailable on worker targets. The unsupported command left the generator paused in the harness. This was a harness defect, not an application or camera result.
- Validation: Five pure-helper tests and the real Chrome worker regression passed (6/6 total). The worker returned `local ok` and rejected the explicitly labelled external probe with `blockedReason: inspector`. The earlier browser run had zero console/CSP errors and proved the favicon fix, menu and native sound unlock before the harness defect.
- Limits: The corrected full synthetic journey and deliberate missing-asset acceptance are pending the next committed-snapshot run. No release, webcam, human or performance gate is declared complete.

## 2026-10-25T04:22:47+05:30 — 200% zoom and narrow compact tiers

- Changed: At ≤520 px tall the compact rails hide page captions, button sub-captions and chips and use 16 px button text; at ≤760 px wide compact song cards drop the cover so titles fit. Targets stay at `MENU_TARGET_MIN_PX` with `MENU_TARGET_GAP_PX` gaps. The breakpoint test whitelists these documented sub-tiers.
- Why: A 720×450 (200% zoom of 1440×900) screenshot showed the bottom rail scrolling and truncated song titles.
- Validation: After merging main, `npm ci`, typecheck, lint, 369/369 assertions in 48 files (`--testTimeout=90000` because of 100% CPU from parallel jobs), build and prettier check passed. Headless Chrome screenshots at 720×450 (menu, pause), 1024×640 (performer pre-roll) and 1440×900 (pause run summary with autofocused Resume) were inspected.
- Limits: Zoom was emulated by viewport size, not browser zoom; no human readability check.

## 2026-10-25T04:20:00+05:30 — Readable, playable charts (generator v3)

- Changed: Rewrote `app/src/beatmap/assign.ts`. Charts now pick musical events by salience under hard caps instead of turning nearly every onset into a note: lower `MAX_DENSITY_PER_S` (0.75/1.5/2.5) and larger `MIN_NOTE_GAP_MS` (700/400/260), new `MAX_VISIBLE_NOTES` (3/4/5 notes per approach span), an energy-scaled local gap, deliberate phrase rests (`PHRASE_MAX_MS`/`PHRASE_REST_MS`), rare strong two-hand chords (`CHORD_MIN_STRENGTH`/`CHORD_MIN_SPACING_MS`, none on Easy), a phrase-local smash share (`SMASH_MAX_SHARE`) so strong kicks punch and other accents slash, relative-sustain beams (`BEAM_SUSTAIN_PERCENTILE`/`BEAM_SUSTAIN_MAX_DB`) spaced by a longer `BEAM_MIN_SPACING_MS`, a per-hand recovery budget (`FLOW_HAND_LEAD_MS`/`FLOW_HAND_FOLLOW_MS`/`FLOW_GESTURE_CHANGE_MS`, exported as `handGapMs`) with each hand on its own side, and walls planned first on the beat cadence (`OBSTACLE_PERIOD_BEATS`/`OBSTACLE_SPACING_MS`) with notes moved to the open side. Removed `EASY_SMASH_TO_SLASH_EVERY`, `FLOW_HAND_MIN_GAP_MS`, `FLOW_GESTURE_SWITCH_MIN_MS`, `FLOW_MAX_COLUMN_STEP`, `OBSTACLE_EMPTY_WINDOW_MS` and `OBSTACLE_LOOKAHEAD_*`. The validator enforces the on-screen cap and `handGapMs`. `GENERATOR_VERSION` is 3; all nine bundled maps, receipts and the manifest were regenerated with `npm run beatmaps`. The in-app 80-second arrangement uses the same generator. Added `scripts/chart-report.mjs`, `tests/unit/chartQuality.test.mjs` and assignment tests; the performer replay now covers all nine charts. Docs 02 registry, 08 §9–§10 and the tracks README describe the rules with before/after counts.
- Why: The user reported the synthetic performer's screen filling with simultaneous blocks and asked for actually playable charts. Measured v2 problems: Electro Cabello Normal had 320 smashes to 9 slashes and no beams; up to 9 notes shared the screen; the performer could not reach 59/149/56 notes on Pamgaea/Electro Cabello/Cipher Hard (13.8%/25.8%/13.8%) and 23 on Electro Cabello Normal.
- Validation: v3 bundled charts (notes slash/smash/beam): Pamgaea 89 (45/34/10), 178 (97/69/12), 230 (112/100/18); Electro Cabello 116 (52/54/10), 183 (110/62/11), 285 (129/140/16); Cipher 116 (65/42/9), 202 (106/83/13), 267 (120/131/16) for Easy/Normal/Hard; 0.5–0.6/0.9–1.1/1.2–1.5 notes per second; at most 3/4/5 on screen. The performer replay through the real input pipeline and judge hit every note of all nine charts Perfect with zero bad cuts and zero wall hits; unplayable thresholds tightened to 0 on Easy/Normal and 2% on Hard. In-memory 80-second middle cuts of all three songs also produced valid charts with zero unplayable notes. Typecheck, lint and production build passed; `npm run check` ran 373/374 tests green, the remaining `gapless.test.mjs` case timed out at 5 s under parallel host load and passed 7/7 when rerun alone. Prettier on changed sources and both docs checks passed.
- Limits: Synthetic performer and algorithmic checks only; no human comfort, musical-quality annotation or live webcam play. Tempo confidence is unchanged: all three songs remain onset-only. Hard is now about 1.2–1.5 notes per second, intentionally below controller rhythm games.

## 2026-10-25T04:20:00+05:30 — Three distinct target families and a calmer busy-moment look

- Changed: Per the user's request for gesture-distinct, playable blocks, `block_shell.glb` is replaced by `block_targets.glb` with `block_slash` (a thin bladed rhombic slab, chamfered glowing rims and a horizontal cut seam) and `block_orb` (a faceted 12-segment orb with a glowing equator band, slowly turning except in Calm). Smash targets are now the authored 14-cell Voronoi fracture assembled with crack gaps (`SMASH_CRACK_SCALE`), so their fracture faces glow as cracks and the shatter breaks along the same pieces; the low tier uses its eight-octant set for both. Slash halves are cut from the slab's own rhombic prism (`diamondFaces`, same quad topology and bounded buffers) with a white-hot cap cooling over `SLICE_CAP_HEAT_MS`. All targets fade in over `TARGET_FADE_IN_M` after spawning; glyphs sit just proud of each silhouette with per-family scales; trims, near-plane glow, shard flash and inner glow are restrained; shards and armour debris now recede from the camera (`SHATTER_DEPTH_FRACTION`, `SHATTER_RECEDE_MPS`) and shrink steadily; the shader grid is dimmer and less saturated. Target dimensions are read by the Blender generator from `SLASH_SLAB_DEPTH` and `BEAM_ORB_RADIUS`. The generator writes LF text, records retired ids, and its closed-mesh check now also requires consistent winding.
- Why: Busy moments read as identical magenta cubes and glare; the user asked for slice/crush/laser targets readable by silhouette and actually playable.
- Validation: Blender MCP regeneration (dedicated port 9878); asset checks pass (7 GLBs, 5,996 triangles, 352,056 bytes; Khronos not rerun). Typecheck, lint, 366/366 vitest assertions and production build pass. Native Chrome screenshots of the synthetic-performer trial (planned motion, no camera) were inspected at 1440×900 — trial output is visual evidence only.
- Limits: Blade ribbons/hand particles, hit sparks and camera response are still not implemented; no GPU timing or human readability study was run.

## 2026-10-25T04:17:49+05:30 — Final tested bundle checkpoint after camera-source integration

- Changed: Normally integrated main `752acf3`, retained the final source-identified production-preview receipt, and updated docs16. No additional application code was required.
- Why: Preserve the new camera-source work and verify that module splitting still satisfies issue #1's complete acceptance.
- Validation: Full `npm run check` passed again (typecheck/lint, 367 assertions/48 suites, production build with no >500 kB warning, three budget regressions). All eight emitted JS chunks passed; the largest entry is 441521 raw/160440 gzip bytes. Actual preview completed both 80-second trials and Songs with 131 real dataset misses and 131 synthetic Perfect hits, no runtime console errors/CSP violations. Root docs tests and link checker passed before this evidence-only commit; changed-source formatting and whitespace checks passed.
- Limits: Tested source `8da67439a6597cc02f9a9ddd557497a48725915e`; later UI/training changes on main are outside this frozen checkpoint. Browser/environment/cache and single-run limitations remain those documented above. No webcam, FPS, load-time or P0–P5 release-gate claim is made.

## 2026-10-25T04:16:00+05:30 — wip: pure avatar retargeting and avatar runtime module

- Changed: Added `render/avatarRetarget.ts` (play-space targets from MediaPipe pose/hands with mirror mapping, world or limb-foreshortening depth and camera-ray placement; torso/head/clavicle solve, two-bone arm IK with bounded stretch and pronation sharing, hand frames, per-joint finger flexion/spread with limits, hold-then-ease to neutral, slerp smoothing, idle and explicit-joint inputs) and `render/avatar.ts` (GLB loading/validation, holographic skinned shader with outline hull, natural PBR variant, placement, snapshot/restore, `poseFromJoints`). Registered the `AVATAR_*` constants in `core/constants.ts` and docs02, documented the asset/retargeting in docs10 §11 and docs18 §11, and added `pose_avatar_preview.py` deformation renders.
- Why: Drive the authored person model from tracked, dataset and synthetic skeletons instead of thin lines.
- Validation: 16 new assertions against the actual exported GLB (rest identity, horizontal raise with hand on wrist, 90°/120° elbows, bounded stretch, fist/point/open recovered from 21-point landmarks, hold-then-ease, head turn and limit, mirroring/handedness, 2D depth, camera-ray placement, leg indices ignored, explicit joints, static Calm idle). Typecheck clean. Blender pose renders show clean fist and raised-arm deformation.
- Limits: Not yet wired into the renderer or menu; no browser or webcam check.

## 2026-10-25T04:11:38+05:30 — Release-drill implementation and retained failures

- Changed: Added `scripts/release-drill.mjs` and pure-helper tests. The drill clones the exact committed SHA, captures install/check/build command logs, serves the prepared build with the existing server, blocks external browser destinations, and observes native-input synthetic playback/results/retry/Songs. It writes dated JSON/Markdown evidence, preserves previous attempts and excludes camera/model preparation. Added a local SVG favicon declaration in `app/index.html` after the browser exposed a missing favicon request.
- Why: Issue #3 requires repeatable clean-clone and offline release evidence with visible failures and no console/CSP errors.
- Validation: Helper tests passed 5/5; documentation tests passed 2/2 and 521 local links checked with zero errors. A fresh clone of `ad41466` passed `npm ci`, the full application check (363 assertions) and production build. The integrated `cfdcc40` worktree plus favicon passed `npm run check` (367 assertions/48 suites/build). Main `752acf3` is now integrated for the committed-snapshot run. An earlier `5a786e5` clone failed one gapless-test timeout; its failure is retained. The first browser attempt reached the selected song and enabled sound, then exposed an incorrect harness predicate (the successful sound action replaces its button) and a real favicon 404; both were corrected.
- Limits: The corrected committed-snapshot browser journey and injected missing-asset drill are pending the next evidence step. No complete P5, live-camera, recognition, audible-sync or performance gate is claimed. The initial failed-run filename uses its UTC date; subsequent evidence includes the local timezone/date explicitly.
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

## 2026-10-25T04:07:42+05:30 — Pause run summary, performer footer label and short-window tier

- Changed: Pause shows the run so far (song position, score, combo/multiplier, accuracy) beside the frozen figure. The footer uses `trialCopy().controls`, so the synthetic performer is labelled “Synthetic performer · mouse/keyboard to pause or quit” instead of “Dataset replay”; the duplicate footer keyboard hint was removed (the header keeps it). Compact armed trial pre-roll keeps only countdown and Back below the stage so the play-projected figure's hips stay clear. A ≤520 px tall sub-tier (for example 200% zoom) hides secondary captions/chips without shrinking targets. Rail pages are labelled `role="group"` regions. DESIGN.md notes generated covers and on-control hand states.
- Why: Screenshot review of performer and dataset runs (footer mislabel, empty pause rail, compact pre-roll overlap) and docs14's 200% zoom requirement.
- Validation: Full suite passed 338/338 in 45 files with `--testTimeout=90000` and the build passed; the default `npm run check` hit audio/DSP 5 s timeouts only, with machine CPU at 100% from parallel jobs. Typecheck, lint, prettier and docs checks passed. New assertions cover the pause summary and that no performer label mentions the dataset; the breakpoint test allows the documented 520 px sub-tier.
- Limits: The 520 px tier and pre-roll trim were not re-screenshotted in this step.

## 2026-10-25T04:02:00+05:30 — wip: a-priori dataset-camera trial and measured calibration photo

- Changed: retained `docs/evidence/2026-10-25-dataset-camera-apriori-trial.json` and its sweep app evidence. The harness now retries camera setup once after an error (as a person would), shares one Chrome profile across lanes (first lane cold GPU program cache), records whole-machine CPU busy fractions and GPU adapters, exports app evidence when calibration framing fails, times the sweep from the accepted setup and saves JPEG screenshots. `prepare-dataset-camera.mjs --calibration-from <sweep evidence>` moves the photo with the best measured two-hand detection to the calibration slot and records the evidence hash plus the declared rule's own choice.
- Why: the a-priori calibration photo (declared annotation rule) yielded one detected hand in every frame, so the unchanged calibration (both hand slots seen) never became ready in 30 s — the same outcome as a player showing one hand. Cold first GPU inference exceeded the 15 s first-result deadline on the first attempt of each fresh profile; the retry succeeded.
- Validation: sweep under the new handedness mapping: 442/484 matched hands agree with annotated wrists; pose detected on 21/21 swept photos; median labelled-joint error 0.119 shoulder widths. Background CPU was 66% busy before launch and 99.9% during the lane (other workloads on the machine).
- Limits: timings are contaminated by unrelated machine load; still photos only; not webcam evidence.

## 2026-10-25T04:01:41+05:30 — Shortened the full run under machine contention and allowed execution-only resume changes

- Changed: The full COCO + MPII run (local upper-body-coco-mpii-9ep, launched 03:15 at below-normal priority) completed epoch 0 (frozen backbone, 1,442 steps) and was stopped deliberately at its saved epoch-1 boundary checkpoint. Resume now compares a training-contract hash that excludes only execution settings (`cpuThreads`, `dataLoaderWorkers`, `dataLoaderPrefetchFactor`, `checkpointEverySteps`, the default `epochs`, download settings) and records every changed key, the checkpoint's requested epochs/total steps and the new horizon. config.json now uses 2 DataLoader workers and a 5-epoch default.
- Why: Another process held about 61% of total CPU at above-normal priority and system commit reached 34.8 of 40.1 GB with up to 19,000 pages/s. Frozen steps averaged 865 ms (versus 340 ms uncontended), spawned workers held about 770 MB private memory each, and the epoch-0 validation pass took about 18 minutes while starved. Nine epochs would not finish in the requested three to four hours.
- Validation: Epoch 0 measured 1,300 s wall, mean training loss 0.009677, 29 ms mean data wait; held-out validation loss 0.004589 and pooled labelled-joint PCK@0.2 0.2379 on 3,776 COCO + MPII people. The boundary checkpoint (step 1,442, SHA-256 b96ff0b7…) was copied before any resume. Unit tests pass 12/12, including the new contract test.
- Limits: Epoch 0 used the original 9-epoch cosine horizon; the resumed 5-epoch horizon lowers the learning-rate scale from 0.980 to about 0.935 at the boundary. This one discontinuity is recorded rather than hidden. The original manifest records dirtyTree true because report.py was being edited at launch; train.py, upper_body.py and config.json matched b17e703.

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
