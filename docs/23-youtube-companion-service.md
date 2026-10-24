# 23 — YouTube Companion Service

An **optional**, local-only Node service in `server/` that turns a YouTube URL into an audio file the client can decode and map. Browsers cannot fetch YouTube audio directly (CORS, obfuscated streams), so this is the only honest way to offer a URL field ([ADR-012](03-decisions.md#adr-012--youtube-via-a-local-companion-service-mp3-upload-is-the-primary-path)). The game never depends on it: audio-file upload and bundled tracks are the primary paths, and the UI detects when the service is absent.

**Legal / terms-of-service caveat (state it in the README too):** downloading YouTube audio may violate YouTube's Terms of Service and the rights of the content owner. This service exists for demonstrating the beatmap generator with content you have the rights to use (your own uploads, Creative Commons tracks). It is not shipped to any host and must not be exposed beyond `localhost`.

## Prerequisites

| Requirement | Version | Check |
| --- | --- | --- |
| Node.js | ≥ 20 | `node --version` |
| `yt-dlp` on `PATH` | current release (it breaks when stale) | `yt-dlp --version` |
| `ffmpeg` on `PATH` (yt-dlp needs it for `-x` extraction) | ≥ 4 | `ffmpeg -version` |

Zero npm dependencies: `node:http`, `node:child_process`, `node:fs`, `node:path`, `node:crypto`, `node:url` only. The service is one file (`server/src/index.mjs`, ≈ 250 lines) plus `server/package.json` with a `start` script.

## Run

```bash
npm run server
```

(from the repo root; the script is `node server/src/index.mjs`). Defaults: port `8787`, cache directory `server/cache/`. Environment variables: `PORT`, `CACHE_DIR`, `MAX_CACHE_MB` (default 500), `ALLOWED_ORIGIN` (default `http://localhost:5173`). Startup prints a one-line status including whether `yt-dlp` and `ffmpeg` were found; if either is missing the server still starts but every `/api/yt/*` call returns `503 toolMissing` and `/api/health` reports it.

## Endpoints

All responses are JSON unless stated; errors are `{ error: { code, message } }`.

### `GET /api/health`

```json
{ "ok": true, "ytDlp": "2026.09.30", "ffmpeg": true, "jobs": 1, "cacheMB": 112.4 }
```

Always `200` while the process is alive; `ytDlp: null` / `ffmpeg: false` when missing. The client uses this to decide whether to enable the URL field.

### `GET /api/yt/resolve?url=<encoded>`

Validates the URL (§URL validation), then runs

```
yt-dlp -J --no-playlist --skip-download <url>
```

with a 15 s timeout, parses stdout JSON and returns

```json
{ "id": "dQw4w9WgXcQ", "title": "…", "author": "…", "durationMs": 212000, "thumbnail": "https://…" }
```

Errors: `400 badUrl`, `404 notFound` (yt-dlp exit code ≠ 0 with "Video unavailable"), `413 tooLong` (duration > 12 min), `504 timeout`, `503 toolMissing`.

### `POST /api/yt/fetch` — body `{ "url": string }`

Validates, resolves the id, then:

1. If `cache/<id>.mp3` exists → `200 { id, status: 'ready' }`.
2. If a job for `id` is already running → `202 { id, status: 'downloading' }`.
3. If ≥ 2 jobs are running → `429 busy`.
4. Else spawn

```
yt-dlp -x --audio-format mp3 --audio-quality 5 --no-playlist --newline \
       --max-filesize 100m -o "<CACHE_DIR>/%(id)s.%(ext)s" <url>
```

and respond `202 { id, status: 'queued' }`.

`--newline` makes yt-dlp print one progress line per update, which the server parses with `/\[download\]\s+([\d.]+)%/` to a `0..1` fraction (download phase = 0..0.85, post-processing/ffmpeg phase = 0.85..1.0). Job timeout: 180 s → kill, `status: 'error', code: 'timeout'`.

### `GET /api/yt/status/:id`

```json
{ "id": "…", "status": "queued" | "downloading" | "ready" | "error", "progress": 0.42, "error": { "code": "…", "message": "…" } }
```

Job records live in memory (`Map<id, Job>`) and are kept 10 minutes after completion; a status request for an unknown id checks the cache directory first (`ready` if the file exists) and returns `404` otherwise.

### `GET /api/yt/audio/:id`

Serves `cache/<id>.mp3` with `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`, and HTTP range support (`206` with `Content-Range` for `Range` requests — the client only needs full fetches, but range support lets an `<audio>` element preview it). `404` if not ready. Touches the file's mtime (for LRU eviction).

## Client integration

`beatmap/youtube.ts` (main thread):

1. **Presence check** on entering `SELECT`: `fetch('http://localhost:8787/api/health', { signal: AbortSignal.timeout(800) })`. Success with `ytDlp` and `ffmpeg` present → the URL field is enabled. Any failure → disabled with the copy below. Re-check when the user focuses the field.
2. **Flow**: paste → `resolve` (show title, duration, thumbnail) → `fetch` → poll `status` every 500 ms (progress bar "Fetching audio… 42 %") → `audio` as `ArrayBuffer` → hand to the generator exactly like an uploaded file with `source: 'youtube'`, `sourceHash` from the bytes, `title`/`artist` from `resolve`.
3. The companion is only ever addressed at `http://localhost:8787`; the port is a constant in `core/constants.ts` (`COMPANION_URL`).

UI copy:

| State | Text |
| --- | --- |
| Service offline | "Companion service offline — run `npm run server` or upload a file instead." (field disabled) |
| Tool missing | "Companion found but yt-dlp/ffmpeg is missing on this machine." |
| Resolving | "Looking up video…" |
| Too long | "Videos over 12 minutes are not supported." |
| Busy | "Two downloads already running — wait a moment." |
| Error | "Could not fetch audio: <message>. Try uploading the file instead." |

## Security and limits

- **CORS**: `Access-Control-Allow-Origin` is exactly `ALLOWED_ORIGIN`; preflight (`OPTIONS`) answered with `Allow-Methods: GET, POST`, `Allow-Headers: Content-Type`. Any other origin gets no CORS headers (browser blocks).
- **Bind address**: `127.0.0.1` only. Never `0.0.0.0`.
- **URL validation** (reject everything else with `400 badUrl`): parse with `new URL()`; protocol `https:`; host ∈ `{ www.youtube.com, youtube.com, m.youtube.com, music.youtube.com, youtu.be }`; id = `searchParams.get('v')` for youtube.com `/watch`, or the first path segment for `youtu.be` and `/shorts/<id>`; id MUST match `/^[A-Za-z0-9_-]{11}$/`. The **id**, never the raw URL, is passed to `yt-dlp` as `https://www.youtube.com/watch?v=<id>` — this eliminates argument injection. Always `spawn` with an argument array; never a shell string.
- **Body limit**: 4 KB for `POST /api/yt/fetch`; `413` beyond.
- **Concurrency**: at most 2 concurrent `yt-dlp` download processes and 2 concurrent `resolve` processes.
- **Cache eviction**: on each successful download, if the directory exceeds `MAX_CACHE_MB`, delete the least-recently-used `.mp3` files (by mtime) until under the limit. Partial downloads (`*.part`, `*.webm`, `*.m4a`) left by a killed job are deleted on startup and when the job errors.
- **No logging of URLs with query strings beyond the id**; log lines are `[fetch] <id> started/ready/error <code>`.

## Error mapping

| yt-dlp signal | Code | HTTP |
| --- | --- | --- |
| Not installed (`ENOENT` on spawn) | `toolMissing` | 503 |
| stderr contains "Video unavailable" / "Private video" / "This video is not available" | `notFound` | 404 |
| stderr contains "Sign in to confirm your age" | `ageRestricted` | 403 |
| stderr contains "File is larger than max-filesize" | `tooLarge` | 413 |
| Non-zero exit, otherwise | `ytDlpFailed` (last stderr line, truncated to 200 chars) | 502 |
| Killed by timeout | `timeout` | 504 |
| ffmpeg conversion failed ("Postprocessing" in stderr) | `convertFailed` | 502 |

## Implementation sketch

```js
// server/src/index.mjs
import http from 'node:http'; import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';

const PORT = +(process.env.PORT ?? 8787), CACHE = process.env.CACHE_DIR ?? path.resolve('server/cache');
const ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
const jobs = new Map(); // id → { status, progress, error, startedAt, proc }

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
function extractId(raw) { /* URL parse + host whitelist + id regex, return id or null */ }
function run(args, { timeoutMs, onLine }) { /* spawn('yt-dlp', args), collect stdout/stderr, kill on timeout, resolve { code, stdout, stderr } */ }

http.createServer(async (req, res) => {
  cors(res); if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/health') return json(res, 200, health());
    if (url.pathname === '/api/yt/resolve') return json(res, 200, await resolve(extractIdOrThrow(url.searchParams.get('url'))));
    if (url.pathname === '/api/yt/fetch' && req.method === 'POST') return json(res, ...await startFetch(extractIdOrThrow((await body(req)).url)));
    if (url.pathname.startsWith('/api/yt/status/')) return json(res, 200, status(idParam(url)));
    if (url.pathname.startsWith('/api/yt/audio/')) return serveAudio(req, res, idParam(url));
    json(res, 404, { error: { code: 'notFound', message: 'No such route' } });
  } catch (e) { json(res, e.http ?? 500, { error: { code: e.code ?? 'internal', message: e.message } }); }
}).listen(PORT, '127.0.0.1', () => console.log(`[companion] http://127.0.0.1:${PORT} cache=${CACHE}`));
```

The sketch is the contract; function names are normative so the client and tests can reference them.

## Test plan

Manual (needs network):

1. `npm run server` with tools installed → health shows versions.
2. `curl "http://127.0.0.1:8787/api/yt/resolve?url=https://youtu.be/<id>"` → title/duration JSON in < 15 s.
3. `curl -X POST -H 'Content-Type: application/json' -d '{"url":"https://www.youtube.com/watch?v=<id>"}' http://127.0.0.1:8787/api/yt/fetch` → `202 queued`; `status` reaches `ready`; `audio/<id>` is a playable MP3; second `fetch` of the same id returns `200 ready` immediately.
4. Bad inputs: `https://example.com/x`, `javascript:alert(1)`, a 10-char id, a playlist URL → all `400 badUrl`; no process spawned (check `jobs` in health).
5. Rename `yt-dlp` temporarily → health `ytDlp: null`, calls return `503 toolMissing`, client field disabled with the correct copy.
6. Fill `cache/` past `MAX_CACHE_MB` with dummy `.mp3` files → next successful download evicts oldest.
7. Kill the server mid-download → client shows the error copy and the field re-checks health on focus.

Automated (`server/test/validate.test.mjs`, `node --test`, no network): `extractId` table test (12 cases), progress-line parser, error mapping from sample stderr strings, range header parsing.

## Acceptance criteria

- [ ] Game boots and plays bundled/uploaded tracks with the service **not running**; the URL field is disabled with the offline copy within 1 s of entering `SELECT`.
- [ ] With the service running, a < 5-minute video resolves, fetches, and produces a validated beatmap end-to-end in < 60 s on venue Wi-Fi.
- [ ] Every request from a non-whitelisted origin is blocked by CORS; the server listens only on `127.0.0.1`.
- [ ] No raw user string is ever passed to a shell; only the validated id reaches `yt-dlp`.
- [ ] The ToS caveat is present in `README.md` and in this document.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
