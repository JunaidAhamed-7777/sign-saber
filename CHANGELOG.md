# Change log

Record each meaningful project change, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## Development log

No gameplay implementation has been recorded yet. Documentation and scaffold maintenance are recorded below; passing stub checks is not evidence of a playable game. Add entries using this shape:

```text
## <actual timestamp> — <short change title>

- Changed: <feature or files changed>
- Why: <reason for the change>
- Validation: <commands or manual checks actually run, with results>
- Limitations: <known issues or "None identified in these checks">
```

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
