# AI usage

Brief contribution summaries; no transcripts, credentials or private recordings. Documentation/review contributions are recorded as well as runtime work. Existing specification and scaffold work was present before this pass; no new gameplay implementation is claimed here.

The development workflow also occasionally includes collaboration with **Devin**, as reported by the project owner. Record specific Devin contributions alongside other AI assistance when they occur; no Devin contribution is attributed to this documentation pass.

## 2026-10-24 — Codex documentation and roadmap pass

- Built on the existing Claude-edited specification/scaffold rather than replacing its useful technical detail.
- Used three parallel review agents for runtime/input/audio-clock contracts; rendering/UI/asset pipeline; and DSP/performance/QA/benchmark evidence. The primary agent integrated the reviews, product scope, workflow, roadmap, demo and repository documentation.
- Added a dependency-free documentation path/heading checker and meaningful regression tests; corrected CI failure propagation.
- Defined P0–P5 implementation tasks and a reproducible benchmark protocol, explicitly separating planned targets, deterministic replay and live-camera evidence.
- Actual validation at the first milestone: scaffold `npm run check` passed with zero executed Vitest tests; two documentation-checker tests passed; local documentation links passed. No webcam, gameplay, Blender or performance results were created or claimed.
- Continuing review reconciled quality presets, gesture charge behavior, countdown/pre-roll, map validation, benchmark sampling and failure drills across subsystems. Detailed checks and remaining limitations are recorded in the matching changelog milestones.
- Replaced obsolete kickoff/hour references in 92 scaffold contract headers and the optional server header; updated the beatmap placeholder message to P2. This mechanical documentation pass did not implement the modules. The scaffold checks passed again afterward, with zero gameplay assertions executed.
- Final integration registered DSP/ergonomic defaults, aligned timing/scoring/UI/companion payloads, and completed QA/risk/demo/evidence guidance. Final local validation: 37 Markdown files and 392 local links/fragments passed; two checker tests passed; fences and the complete JSON example checked. `beatmaps` was confirmed to fail as a placeholder, and the companion to exit without a listener. Runtime, human playtests and benchmark measurements remain pending.
