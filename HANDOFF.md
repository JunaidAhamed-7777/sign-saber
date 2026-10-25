# Sign Saber implementation handoff

The user requested this checkpoint and is handing the repository to another agent. History is preserved; only the integrator committed and pushed. Start with git status, AGENTS.md, README.md, ROADMAP.md, DESIGN.md, docs/README.md and relevant numbered specs. No P0–P5 release gate is declared complete.

## Later cloud refinement — 2026-10-25

The avatar root anchor now follows smoothed shoulder/clavicle transforms, fixing torso-transition and tracking-loss drift without changing capture-time scoring. The avatar source/GLB was regenerated through the official Blender MCP bridge in a dedicated cloud Blender 4.3.2 instance: smoother suit surface, fine rear seams, explicit pre-rig mesh cleanup, and unchanged 43-bone/rest-anchor contract. See [cloud authoring evidence](docs/evidence/2026-10-25-cloud-avatar-polish.md) for exact artifact hashes and validation limits. The historical checkpoints below remain historical; no release gate is newly declared passed.

Additional CI commands: `node --test scripts/check-avatar.test.mjs`, `node scripts/check-avatar.mjs`, and `python scripts/test_blender_bootstrap.py` (from the repository root after app dependencies are installed). The isolated authoring bootstrap now refuses failed startup and disables optional update/service callbacks.

## Latest round (2026-10-25, seven parallel agents, integrated on main)

What now works end to end without a camera:

- **Watch synthetic performer**: a chart-planned performer (`app/src/performer/`) plays the selected chart through the real input pipeline, judge, renderer, SFX and results. Logic replay hits every planned note on all nine bundled charts (`app/tests/performer.test.mjs`). Synthetic only — not webcam evidence.
- **Dataset camera**: `?camera=dataset` (or Settings → Use dataset camera) feeds real COCO photos, or `&reel=performer` the posed avatar, through the unchanged live camera path. Harness: `scripts/prepare-dataset-camera.mjs` then `scripts/dataset-camera-trial.mjs`. Evidence: [dataset camera trial](docs/evidence/2026-10-25-dataset-camera-trial.md). It fixed an inverted handedness mapping (~92% wrong before).
- **Rigged 3D avatar** (Blender, `avatar.glb`) replaces the SVG/line figure in menu, setup, play, pause and results; driven by tracked or performer landmarks.
- **Distinct targets**: slash slab, cracked smash cube, distant beam orb, each with its own break; blade ribbons, sparks, bloom, layered arena.
- **Charts v4**: capped density (≤3/4/5 on screen), balanced slash/smash/beam, per-hand gaps; beat-confident Electro Cabello and Cipher.
- **Original synthesized SFX** wired to gameplay/menu events; rebuilt interface with in-world judgement pops and gesture breakdown.
- Fixes: bundled MP3s failed in embedded Chromium (gapless trim), playback decoded at 22 kHz, `ONE_EURO_BETA` lagged fast swings (0.08 → 10).
- Training: partial COCO+MPII run (25% of steps), PCK@0.2 0.334 on oracle crops; not used by the game ([status](training/STATUS.md)).

By user request the in-game avatar now faces away from the viewer, the menu buttons read **Play level** / **Watch auto-play**, and visible "dataset / synthetic / no camera" banners and captions were removed (exported diagnostics still record the source lane). Camera integration is paused until the user asks for it.

Open: a consenting live-webcam session, the dataset-camera performer reaching Results on an idle machine, avatar head tilt in the natural render, listening checks for SFX, and the GitHub issues labelled `chatgpt` (#1–#5).

## Current direction

Prioritize the dataset level trial, Blender assets/background and dynamic 10 s fade-in → 60 s highlight → 10 s fade-out arrangements. Camera tuning is secondary. Keep only head, arms and torso through hips in input, placeholder and every figure. Use agents with temporary boundaries and one integrator. Commit small tested increments frequently and push origin/main without force or co-author trailers.

## Working implementation

- Camera-free local three-song menu, guarded native/hand actions, side-rail paging and upper-body placeholder. Optional camera setup is independent of song selection. Setup currently lives in Settings; original prominent first-launch camera acceptance remains deferred under the latest dataset-first direction.
- Full licensed local Pamgaea, Electro Cabello and Cipher; nine validated difficulty maps, exact credits/acquisition/hash receipts and local fonts. All three disclose low tempo confidence/onset-only timing.
- Continuous 80-second derivative audio with raised-cosine fades and dynamically selected energy/onset highlight. Fresh charts use the actual edited WAV; receipts retain sample/fade bounds and hashes. This is not verified chorus detection.
- Eight attributed independent COCO still annotations. No fingers, gesture labels, metric depth, masks or temporal motion are invented. Dataset start automatically arranges music, skips camera readiness only for this source, and reaches genuine results.
- Pure capture-time game/audio spine: slash, smash, beam, torso walls, exactly-once scoring/misses, multiplier/rank, heard-time clock, pause/recovery and actual results. Native browser Pamgaea trials reached 131 Miss/zero hits, as expected without gesture labels. Pause/resume, Enter retry and Quit were exercised.
- Six original GLBs and saved source scene authored through the official Blender MCP local add-on bridge. Retained Khronos reports show zero errors/warnings; 3,320 triangles/194,488 GLB bytes and matching repeat-export hashes. Exact capped cuts have 200 seeded-plane tests. Bounded shatter, distinct whole-target beam collapse, terminal failure visuals, authored arena and owned head/body snapshots are integrated.
- Peripheral hand/gesture/charge HUD clears stale/absent/dataset input. Fixed tier and contrast consumers apply actual render resolution, effect budgets/lifetimes, poof counts, pylon counts and joint/bone choices. Unsupported effects stay explicit.

## Verification

See [dataset browser evidence](docs/evidence/2026-10-25-dataset-trial.md) and [clean-clone evidence](docs/evidence/2026-10-25-clean-clone.md). The original clean-clone failure is retained: a CRLF working-copy hash was corrected to canonical LF Git bytes in 08d7555 with four integrity regressions. A real remote clean clone of 08d7555 passed official Node 22.23.4/npm 10.9.9 installation, typecheck, lint, 262 assertions/build and 29 prepared local HTTP/CSP/hash checks. Later source increments have their own outcomes in CHANGELOG.md.

Native Chrome numeric audio checks passed 25 source/resampling and 9 arrangement checks. These are separate from audible synchronization, webcam and performance evidence. The latest tier integration has source assertions but still needs native visual exercise.

The final handoff worktree passed typecheck, lint, 307 assertions across 41 suites, production build and source formatting. Root documentation tests passed 2/2; 47 Markdown files and 514 local links checked with zero errors. These latest checks do not replace a fresh remote clone of the final checkpoint; the retained clean-clone result above identifies its exact earlier SHA.

Run npm run check and npm run format:check in app. Root docs checks are node --test scripts/check-docs.test.mjs and node scripts/check-docs.mjs. Asset checks are node --test scripts/check-model-assets.test.mjs and node scripts/check-model-assets.mjs. Avoid formatting generated/hash-pinned assets. In PowerShell, stop explicitly after a nonzero native command exit.

## Training remains research

[training/STATUS.md](training/STATUS.md) records 8,503 selected COCO CC-BY photos and the completed official MPII archive: 12,088,943,206 bytes, 24,984 JPEG members, verified hash/CRC/path/coverage. MPII is unextracted with no optimizer steps. A real three-step COCO RGB preflight used 24 crops; held-out loss worsened. ONNX parity passed numerically, not as an accuracy result. No weights were promoted into the browser. Full multi-dataset training is incomplete. Data, environments, weights and downloaded tracking models remain intentionally local/ignored; research/noncommercial restrictions apply.

## Next work and limitations

1. Preserve the dataset trial first. Positive gesture play needs labelled temporal hands or consenting live input; do not turn annotation holds into successful hits.
2. Finish core hand visuals: speed-triggered solid blade/ribbon and bounded particles. Existing rings/history lines are partial. Full post-FX/bloom/HDR/AA, camera choreography, richer music-band response, boot probe/adaptation and complete 2.5D result composition remain partial/absent.
3. Expand diagnostics to the docs24 harness. A proposed but uncreated JudgementTraceRecorder would use bounded typed storage, semantic event order, explicit repeats/overflow, idempotent subscription/disposal and async SHA export excluding delivery timestamps. Current export has four sample streams and no complete scenario/repetition/soak harness.
4. Exercise upload-to-results/cancel/corrupt input/cache denial/context loss/repeated lifecycle/offline and tier flags. Large main-bundle warning remains.
5. Matching live calibration/scored hits/menu accuracy, held-out musical quality, human comfort/flashing review, physical latency, GPU/frame budgets, 15-minute soak, disconnected venue drill, first-time users and release/demo recording remain uncompleted. No release tag or actual event details were invented.

The prepared preview is normally http://127.0.0.1:4173/; Vite may remain on 5173. Browser viewport overrides were reset. A dedicated fresh Blender 5.2.2 instance hosts the local bridge on 127.0.0.1:9876; preserve unrelated user scenes. No acquisition or training jobs remain running. See CHANGELOG.md for final checkpoint checks and AI_USAGE.md for contributions.
