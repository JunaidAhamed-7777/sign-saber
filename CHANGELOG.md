# Change log

Record each meaningful project change, newest first. Update this file in the same commit as the change. Use a real timestamp with timezone, for example `YYYY-MM-DDTHH:MM:SS+05:30`.

## Event build log

No project implementation has been recorded yet. Add entries as you build, using this shape:

```text
## <actual timestamp> — <short change title>

- Changed: <feature or files changed>
- Why: <reason for the change>
- Validation: <commands or manual checks actually run, with results>
- Limitations: <known issues or "None identified in these checks">
```

## 2026-10-24T21:50:00+05:30 — Specification and project scaffold

- Changed: Added the complete pre-build specification under `docs/` (index + 23 numbered documents: vision, architecture and contracts with the constants table, ADRs, state machine, tracking, gestures, hit detection and scoring, beatmap generation and format, rendering ×4, UI/UX, audio sync, performance budget, testing, Blender MCP pipeline, build plan, demo script, risks, glossary, YouTube companion). Adapted the workflow conventions of a hackathon repository template (`README.md`, `AGENTS.md`, `SUBMISSION.md`, `CHANGELOG.md`, `AI_USAGE.md`, `.gitignore`, PR template) to the project, dropping event-specific rules. Scaffolded `app/` (Vite + TypeScript + Three.js + React toolchain config, `index.html`, documented module stubs for every file in the source layout, test stubs), `server/` (companion service skeleton), `scripts/download-models.mjs`, `assets-src/`, CI workflow (typecheck, lint, test, build, Markdown link check).
- Why: Implementation is built at the hackathon. A precise specification lets four parallel tracks start building immediately against agreed contracts and constants.
- Validation: `npm install` in `app/` resolves the pinned dependency set; `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` pass on the stub tree (recorded in the commit). Relative Markdown links checked. No gameplay exists yet.
- Limitations: Documentation and scaffolding only; no application behaviour. `AI_USAGE.md` is intentionally empty until the build starts. Bundled demo tracks and MediaPipe models are not committed (fetched by script / added at H1).
