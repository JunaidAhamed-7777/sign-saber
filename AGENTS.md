# Agent guide — Sign Saber

This is the working agreement for humans and coding agents in this repository. The inherited event timetable, pre-kick-off implementation restriction, team-size limit and exclusive folder tracks have been retired. The current repository is a starting point, not a required layout for another event.

## Start with the product and roadmap

- Read [docs/README.md](docs/README.md), [ROADMAP.md](ROADMAP.md), then the numbered specifications relevant to the task. For UI, read [DESIGN.md](DESIGN.md), [14](docs/14-ui-ux.md) and [25](docs/25-menu-and-hand-navigation.md); preserve the clear central human stage and shared mouse/keyboard/hand behavior.
- Use the evidence gates in the roadmap. `[CORE]` is the release requirement; `[POLISH]` follows the P2 complete-core gate; `[STRETCH]` follows P4 with all core gates still passing. No hour offset or deadline is assumed.
- Keep useful existing work. Inspect `git status` before editing; coordinate files when people or agents work in parallel. There is no permanent folder ownership. Agree temporary edit boundaries for each task.
- Source layout may change when it makes implementation clearer. Update links, source headers and architecture in the same change; avoid moving files merely to make the tree look different.

## Treat contracts as build inputs

- Identifiers in [02 — Architecture](docs/02-architecture.md) are normative: use `TrackingFrame`, `HandCursor`, `note:hit`, `WINDOW_PERFECT_MS` and other named contracts verbatim.
- Shared tunables are registered in [02 §Constants](docs/02-architecture.md#constants); renderer/UI-only tables in the linked subsystem docs are explicit sub-registries. During P0, export the specified values centrally from `app/src/core/constants.ts`. That file now exports the registry: keep code and tables synchronized.
- No hidden tunables or subsystem magic numbers. Add a new value to its registry and central exports together once implementation exists. Structural counts and unit conversions should still be named where that improves clarity.
- If behavior or a contract changes, update its producers, consumers, docs and meaningful tests together. Record the behavior change in `CHANGELOG.md`.
- Document planned behavior as planned. A passing stub build is not a working game; a replay result is not evidence that a webcam works.

## Keep implementation direct

- Prefer small idiomatic TypeScript modules, plain data, clear names and explicit error handling. Add abstractions only for actual repeated needs.
- Keep dependencies purposeful; explain additions in the commit message and document sources/licenses in `README.md`.
- `game/` stays independent of Three.js. Renderers and UI consume game events; actions go through the state machine instead of mutating game state from presentation code.
- Pool application-owned hot-path buffers, vectors and effects. Browser/MediaPipe APIs may allocate: measure those boundaries and release `ImageBitmap`, masks, model results and GPU resources explicitly. Do not promise impossible zero-allocation browser calls.
- Keep the camera pipeline bounded. Score capture-time samples exactly once; visual prediction cannot change scoring. See [05](docs/05-tracking-pipeline.md), [07](docs/07-hit-detection-and-scoring.md) and [15](docs/15-audio-playback-sync.md).
- Keep raw camera pixels private. Recording fixtures is explicit, local and opt-in. No credentials, tokens, private participant data or unconsented recordings in commits or logs.
- Show useful failure messages. Do not conceal broken inputs behind fabricated success, demo data or benchmark numbers.

## Validate and record meaningful work

- For application milestones, run `npm run check` in `app/` (typecheck, lint, test, production build). Add behavior tests as implementation arrives; the application now has asserted suites; do not restore empty-suite success.
- For documentation changes, run `node --test scripts/check-docs.test.mjs` and `node scripts/check-docs.mjs` from the root. The checker verifies local Markdown paths and headings; it does not verify remote URLs or runtime claims.
- Run targeted additional checks when a change introduces new risks. Follow [17 — Testing & QA](docs/17-testing-and-qa.md) and [24 — Benchmark & Evidence](docs/24-benchmark-and-evidence.md) for release evidence.
- Update `CHANGELOG.md` in each meaningful commit: actual timestamp with timezone, changed files/behavior, reason, checks actually run and limitations. Preserve the historical record; correct old claims in a new entry.
- Update `AI_USAGE.md` for meaningful AI contributions, including specification and review work. Brief summaries only. Update `README.md` when status, setup, commands, behavior or demo instructions change.
- Only document commands that exist as current commands. Clearly mark future tools in the roadmap; never describe a placeholder script as a working feature.

## Commit frequently and preserve history

1. Finish a coherent, reviewable step; validate it; stage only completed work.
2. Commit at each roadmap gate and after small milestones, about every 20–30 minutes during sustained work. Commit before a handoff or break; use an honest `wip:` message for incomplete work.
3. Use short descriptive messages such as `feat(judge): finalize misses after capture watermark` or `docs: define reproducible benchmark gates`.
4. Do not create empty commits, backdate, force-push, rewrite shared history or add `Co-Authored-By:` trailers. AI contributions belong in `AI_USAGE.md`.
5. Push checkpoints when requested or already authorized. For the current documentation pass, the user explicitly requested a final push to `origin/main`; preserve any new remote work with a normal integration, never a force push.

## Release and judging

- The actual event's rules, judging rubric, deadline and submission channel are not supplied. Record them when known; do not import another hackathon's assumptions.
- Before release, run the clean-clone setup, manual QA, offline exercise and evidence protocol. Record failures as well as passes.
- Keep the release SHA, evidence links, music attributions, actual team and demo recording in the [README project status](README.md#project-status). Avoid a self-referential SHA claim: tag or record a tested release commit, and identify subsequent documentation-only commits separately.
- Rehearse [20 — Demo & Judging](docs/20-demo-and-judging.md). Show the strongest verified interaction first and use measured numbers only.
