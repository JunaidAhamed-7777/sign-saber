# 23 — YouTube Companion Service

**Optional planned extension; not implemented.** `server/src/index.mjs` is a skeleton. Bundled tracks and local upload are the complete core input paths; the game works with this service absent. Schedule companion work only after P2 in [ROADMAP.md](../ROADMAP.md), and omit it from judging unless rehearsed on the actual network.

The browser cannot assume direct access to YouTube audio. A local Node process may invoke `yt-dlp` for authorised content, subject to platform terms/tool availability. Rights to a recording do not waive platform restrictions; review [YouTube's terms](https://www.youtube.com/static?template=terms). Prefer a local licensed file for demonstrations. Never publicly host this service, expose it on the LAN or use it to bypass restrictions.

## Prerequisites and current command

Node must meet `server/package.json`'s engine requirement (≥20.19); use the project's documented version. Record actual Node, yt-dlp and ffmpeg versions, not invented example versions. Tools must be on PATH when implemented; see [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp).

The existing command runs **from `server/`**, not the repository root:

```bash
cd server
npm run server
```

Today the empty module exits without starting a listener or printing status; it does not serve the API below. The planned built-in-only Node service binds `127.0.0.1:8787` and caches under `server/cache/`. Document optional `PORT`, `CACHE_DIR`, `MAX_CACHE_MB`, `ALLOWED_ORIGIN` configuration when implemented; no secrets or account cookies are required. Default approved origin: exactly `http://localhost:5173`. Preview on another port needs explicit configuration/rehearsal.

## API contract

Errors: `{ "error": { "code": "badUrl", "message": "Useful recovery text" } }`. Exclude raw subprocess output, private paths and tool arguments. Validate method/path/input before work; unsupported methods return 405, unknown routes 404.

### `GET /api/health`

Returns process/tool availability, actual version strings, job count and cache bytes. HTTP 200 means the process is alive, not that extraction works. Missing tools keep the URL field disabled.

```ts
interface CompanionHealth {
  ok: boolean;                 // true only when both required tools are available
  ytDlp: string | null;         // detected version, never an executable/private path
  ffmpeg: string | null;
  jobs: number;                // non-negative count of active/reserved downloads
  cacheBytes: number;          // finite non-negative completed-cache byte count
}
```

Health may return 200 with `ok: false`; the client checks the payload and HTTP status rather than treating transport success as usable tools.

### `GET /api/yt/resolve?url=<encoded>`

Validate/canonicalise the ID, then run a bounded metadata-only process:

```text
yt-dlp --ignore-config --no-playlist --skip-download --dump-single-json -- https://www.youtube.com/watch?v=<validated-id>
```

Use `spawn` argument arrays with `shell: false`; the line above is explanatory, not a user-built shell command. At most two resolves, 15-second timeout and bounded stdout/stderr. Return `{ id, title, author, durationMs }`; returned ID must match. Reject playlists/live streams, unknown duration and items exceeding either `COMPANION_MAX_VIDEO_MS` or client `MAX_TRACK_MS`. Render metadata as text. Do not fetch remote thumbnails implicitly in a local privacy-focused demo.

Errors include `badUrl` 400, `notFound` 404, `tooLong` 413, `busy` 429, `toolMissing` 503, `timeout` 504 and sanitised upstream failure. Extractor wording changes; unrecognised errors must not be guessed into success.

### `POST /api/yt/fetch`

Require JSON body `{ "url": "..." }` within 4 KB. Resolve/validate metadata before download; unknown duration cannot bypass client limits.

1. Validated complete cached file → `200 { id, status: 'ready' }`.
2. Same ID active → `202 { id, status: 'downloading' }`.
3. Two downloads active → 429 busy.
4. Reserve a slot before asynchronous work, create a job-owned temporary directory inside the cache root, start extraction and return 202 queued.

Use `--ignore-config`, `--no-playlist`, MP3 extraction, a file-size ceiling no greater than the client upload limit, a fixed output template based on the validated ID and canonical URL after `--`. Independently enforce output/disk limits: `--max-filesize` cannot guarantee converted size. Validate completed media and atomically publish `<id>.mp3` only on success. Never serve partial/intermediate files.

Timeout: 180 seconds. Abort/timeout/shutdown stop extractor **and** spawned ffmpeg, wait for termination and release the slot once. Test Windows process-tree cleanup; killing one immediate child is insufficient proof. Resolve cleanup paths inside the cache root and remove only that job's files.

If progress parsing fails, show an indeterminate stage rather than invent a percentage. Keep bounded records and monotonic `queued → downloading → ready|error` transitions. Retry is a new attempt, not a duplicate process.

### `GET /api/yt/status/:id`

Return `{ id, status, progress, error? }` after ID validation. Retain completed records for ten minutes; later lookups may find validated cached media. Unknown ID is 404. File existence alone does not establish completion after a failed job.

```ts
interface CompanionStatus {
  id: string;                  // validated video ID
  status: 'queued' | 'downloading' | 'ready' | 'error';
  progress: number | null;      // finite 0..1 when known; null means indeterminate
  error?: { code: string; message: string }; // bounded sanitized text on error only
}
```

Ready means a complete validated published file and `progress: 1`. Queued or unparseable progress uses `null`; no timer-based percentage. Error is terminal for the attempt and never changes to ready merely because a partial file exists.

### `GET /api/yt/audio/:id`

Serve only complete validated `<id>.mp3` inside the cache root, with type/length and no directory listing. Full fetch suffices. Optional preview range support must implement/test single ranges, 206/Content-Range, suffix/open-ended requests and unsatisfiable 416; do not advertise it before implementation. See [HTTP Range semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range).

Update LRU on successful access; never evict an active stream. Client hashes bytes and applies the same decode/admission/validation path as upload.

## Client lifecycle

The planned adapter `beatmap/youtube.ts` does not exist yet.

- Probe `COMPANION_URL` on SELECT with `COMPANION_HEALTH_TIMEOUT_MS`; recheck every `YT_HEALTH_INTERVAL_MS` only while SELECT remains active. Cancel the timer/request on exit. Enable only with HTTP and tools available; absence never blocks bundled songs.
- Resolve → confirm metadata → request extraction → poll at `COMPANION_POLL_MS` → fetch bytes → generate with `source: 'youtube'`. Failures return to usable SELECT.
- Abort polling/fetch and invalidate request IDs on song change, SELECT exit or replacement URL. Stale responses cannot replace current selection. Release object URLs/buffers.
- Hosted/HTTPS pages may encounter browser local-network or mixed-content restrictions. Support only the tested local origin; do not promise public deployment can reach this process.

Copy: “Optional companion offline — run `npm run server` from `server/`, or upload a local file.” Distinguish missing tools, duration, busy and extraction errors. Never replace failed input with a different song silently.

## Security and limits

CORS is a browser read policy, not authentication. Reject requests **before work**, not merely by omitting response headers. See [CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

- Loopback only. Check `Host` against configured loopback host/port to resist DNS rebinding; arbitrary hostnames remain forbidden even if they resolve locally.
- Every `/api/yt/*` request carries the exact approved `Origin`; missing/null/other origins return 403. CLI tests explicitly send it. No-Origin health may be allowed because it launches no work. This is not protection against malicious local software.
- Exact-origin CORS with `Vary: Origin`; preflight allows only declared methods/headers. Enforce origin/host/body checks again on actual requests.
- Parse with `new URL`: HTTPS, no credentials, approved YouTube/youtu.be hosts, supported watch/shorts/single-short-link paths, ID `/^[A-Za-z0-9_-]{11}$/`. Reject playlists/live URLs and ambiguous duplicate parameters. Only the canonical validated ID reaches the tool.
- Invoke the real executable with argument arrays and `shell: false`; use an executable, not a Windows shell wrapper. See [Node subprocess documentation](https://nodejs.org/api/child_process.html).
- Bound body/query bytes and read time, concurrency, metadata/output bytes, stderr buffers, disk and status records. Unlimited JSON/stdout collection is a memory leak.
- Cache uses a resolved root and validated IDs. Reject symlink/path escapes; no user output paths. Remove only job-owned temporary files. Evict least-recent completed files over the documented cache ceiling (initial proposal: 500 MB); protect active jobs/streams.
- Logs contain ID/stage/attempt/sanitised code, not full URLs, credentials, private paths or media. Never import cookies or access private/age-restricted media.

## Test plan

Tests are planned under `server/test/` with Node's runner. Add a real script to package.json/README when implemented; filenames alone are not test results.

- URL/ID tables cover valid forms, credentials, lookalike hosts, ports, duplicate parameters, playlists/live streams and shell-looking text. Invalid input launches zero processes.
- Check Origin/Host/method/body, including missing/null origin, rebinding hostname, OPTIONS, unsupported content type and read overflow/timeout.
- Stub subprocesses for concurrency reservation, deduplication, bounded output, missing tools, conversion failure, timeouts, shutdown and Windows process-tree cleanup.
- Cache tests cover partial/empty files, atomic publication, LRU, active streams, symlinks, confined cleanup and recovery.
- Client tests cover absent service, stale results, polling cancellation, failed decode and return to upload without silently changing audio.
- Authorised-media rehearsal records actual versions/network/time. Verify audio and validated map, then finish a core run with service stopped. No online success is claimed until actually tested.

## Acceptance criteria

- [ ] Bundled/upload play completes with no service; optional field gives useful status.
- [ ] Forbidden origins/hosts/input trigger no subprocess/protected-file access.
- [ ] Work/output/memory/disk/lifetime limits are tested, including Windows cleanup.
- [ ] Received media passes the same client admission/validation as upload.
- [ ] Rights/platform restrictions are respected; no credentials/private media needed.
- [ ] Online performance is separate evidence, never an offline-core dependency.
