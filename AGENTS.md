# Agent guide — Sign Saber

This guide is for everyone who commits to this repository, human or AI coding assistant (Claude Code, Codex, or similar). The workflow conventions are adapted from a hackathon repository template; the project-specific rules are ours.

## Hackathon ground rules

- Implementation is built at the hackathon. Before kick-off the repository holds the specification in `docs/` and documented module stubs only.
- Libraries, APIs, and public datasets are welcome. Document their sources and licenses in `README.md`.
- Record every meaningful AI-assistant contribution in [AI_USAGE.md](AI_USAGE.md) once the build starts. It stays empty until then.
- Prepare the code repository, short project description, and working demo in [SUBMISSION.md](SUBMISSION.md). Follow whatever submission method and deadline the organisers announce.

## The docs are the contract

- **Read before you build.** Start at [docs/README.md](docs/README.md). The module you are implementing has a numbered spec; its stub file under `app/src/` names it in the header comment.
- **Identifiers are normative.** Types, events and constants named in [docs/02-architecture.md](docs/02-architecture.md) MUST be used verbatim (`TrackingFrame`, `HandCursor`, `note:hit`, `WINDOW_PERFECT_MS`, …) so that a search for a doc term finds the code.
- **Constants live in one place.** Every tunable goes in `app/src/core/constants.ts` with the name from the constants table. Never inline a magic number in a subsystem; if you need a new constant, add it to the table in 02 and to `constants.ts` in the same commit.
- **If code and docs disagree, fix one in the same commit.** A doc change that alters behaviour gets a line in `CHANGELOG.md`.
- **Scope tags are real.** `[CORE]` ships; `[POLISH]` only after the H7 checkpoint; `[STRETCH]` only when everything is green. Feature freeze is H12 (twelve hours after kick-off). See [docs/19-build-plan.md](docs/19-build-plan.md).

## Folder ownership during the build

| Track | Folders | Rule |
| --- | --- | --- |
| Tracking & Input | `app/src/tracking/`, `app/src/gestures/` | Only this track edits these |
| Rendering | `app/src/render/`, `assets-src/`, `app/public/assets/models/` | Only this track edits these |
| Audio & Beatmap | `app/src/audio/`, `app/src/beatmap/`, `server/`, `app/public/assets/tracks/` | Only this track edits these |
| Game & UI | `app/src/core/`, `app/src/game/`, `app/src/ui/`, `app/src/state/` | Integrates the others; owns `constants.ts` edits (others propose values in chat) |

Cross-track changes go through a quick message, not a surprise diff. This is how we avoid merge conflicts at 4 AM.

## Use basic coding patterns

- Prefer straightforward, idiomatic TypeScript: small functions, clear names, plain data, modules with one responsibility (the stubs already define them).
- Add an abstraction only when an actual repeated need makes the code easier to understand.
- Keep dependencies few and purposeful. The dependency list in `app/package.json` is intentional; adding one needs a reason in the commit message.
- **No per-frame allocation in hot paths** (`render/`, `game/`, `gestures/`, `tracking/`). Reuse scratch vectors, use pools and typed arrays. ESLint warns on `new Vector3()` in those folders for this reason. See [docs/16-performance-budget.md](docs/16-performance-budget.md).
- `game/` never imports `three`. `render/` and `ui/` never mutate game state; they subscribe to events.
- Validate inputs, handle errors explicitly, and show useful failure messages (the BOOT error cards in [docs/04](docs/04-state-machine.md#boot)). Do not hide failures behind fabricated success or demo data.

## Document every meaningful change

- Update [CHANGELOG.md](CHANGELOG.md) in the same commit as each meaningful change: timestamp with timezone, what changed, why, files/feature, validation performed, known limitations.
- Update [README.md](README.md) whenever setup, commands, behaviour, or demo instructions change.
- Update [AI_USAGE.md](AI_USAGE.md) whenever an AI assistant makes a meaningful contribution during the build. Brief summaries; no transcripts.
- Keep claims accurate. Distinguish implemented-and-verified from planned. Never invent test results, performance numbers, or timestamps. "Verified live with the webcam" means someone actually did.

## Make regular, timely commits

1. Inspect `git status` before editing. Preserve teammates' work; stage only your track's files.
2. Finish a small, coherent change, run `npm run typecheck && npm run lint && npm run test` in `app/`, update its documentation.
3. **Commit after each completed milestone; while actively building, about every 30 minutes.** Checkpoints in the build plan are mandatory commit points.
4. Commit before a handoff, a break, or sleep. Incomplete work gets an honest `wip:` message.
5. Short, descriptive messages: `feat(tracking): worker posts TrackingFrame at 30 Hz`, `fix(judge): bad cut no longer scores`, `docs: record ADR-007 fallback decision`.
6. Do not create empty commits, backdate, squash away the event record, force-push, or rewrite shared history.
7. Push to `origin/main` after every checkpoint when the network allows. Resolve conflicts with care; folder ownership should make them rare.

## Check work and protect credentials

- Real commands only: `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run models`, `npm run beatmaps`, `npm run server`. Add new ones to `README.md` as soon as they exist.
- For documentation-only changes, check links (CI does) and consistency with the constants table.
- Report what ran and what passed, failed, or could not be checked.
- No credentials, API keys, approved QR codes, or private participant data in commits or logs. This project needs no secrets; if one appears, something is wrong.

## Before submission

- Complete [SUBMISSION.md](SUBMISSION.md); replace all placeholders.
- Confirm the README's run steps work on a clean clone (`npm install`, `npm run models`, `npm run dev`).
- Run the manual QA checklist in [docs/17-testing-and-qa.md](docs/17-testing-and-qa.md) and record the results.
- Update the changelog and AI usage record, commit the final coherent change, push, and record the SHA in `SUBMISSION.md`.
- Follow the organisers' actual submission method and timing.
