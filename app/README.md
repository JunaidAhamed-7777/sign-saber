# Sign Saber — web client

Vite + TypeScript + Three.js + React. The specification lives in [`../docs/`](../docs/README.md); start with [02 — Architecture](../docs/02-architecture.md) for the module map and contracts.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run models` | Copy MediaPipe WASM from `node_modules` and download the `.task` models into `public/models/` (needs network once; see `scripts/download-models.mjs`) |
| `npm run dev` | Dev server on <http://localhost:5173> (camera works on `localhost` without HTTPS) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run build` | Production build into `dist/` |
| `npm run check` | typecheck + lint + test + build (what CI runs) |
| `npm run beatmaps` | Regenerate bundled beatmaps (script lands at H3, see build plan) |

## Folder map

See [02 — Architecture §Source layout](../docs/02-architecture.md#source-layout). Every file under `src/` currently holds only a header comment stating its responsibility, its spec section, and its inputs/outputs. Implementation starts at the hackathon kick-off per the event rules.

## Runtime assets

`public/models/` is git-ignored except for its README; run `npm run models` before the event so the app works offline. `public/assets/tracks/` will hold the bundled CC0 demo tracks and their pre-generated beatmaps.
