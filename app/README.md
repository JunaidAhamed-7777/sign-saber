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
| `npm run test` | Vitest; currently ten placeholder files and zero assertions, not gameplay coverage |
| `npm run build` | Production build into `dist/` |
| `npm run check` | typecheck + lint + test + build (what CI runs) |
| `npm run beatmaps` | Placeholder; exits with an error until the real P2 generator exists |

## Folder map

See [02 — Architecture §Source layout](../docs/02-architecture.md#source-layout). Every file under `src/` currently holds only a documented contract; the browser page is an empty shell. Start implementation with P0/P1 in [ROADMAP.md](../ROADMAP.md). The inherited event timing/folder restrictions no longer apply; keep contracts and links accurate if paths change.

## Runtime assets

`public/models/` is git-ignored except for its README. The downloader copies WASM and fetches models; P0 still needs pinned model checksums. `public/assets/tracks/` has no bundled music yet. A fully prepared production build must pass the offline exercise in P5; downloading models does not make the stub game playable.

Use Node 22.12+ on CI's Node 22 line. `npm ci` reproduces the lockfile. From the root, `node scripts/check-docs.mjs` validates local documentation paths/fragments; see the [root README](../README.md) for current command/status details.
