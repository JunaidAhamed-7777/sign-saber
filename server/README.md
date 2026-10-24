# Sign Saber companion service (optional)

A tiny local Node service that turns a YouTube URL into an audio file the web client can analyse and play. It exists because a browser cannot fetch YouTube audio directly. The game does not need it: file upload and the bundled tracks are the primary paths (ADR-012).

Full specification: [docs/23-youtube-companion-service.md](../docs/23-youtube-companion-service.md).

## Prerequisites

- Node 20.19+
- `yt-dlp` and `ffmpeg` on `PATH`

## Run

```bash
npm run server
```

Listens on `http://localhost:8787`, allows CORS from `http://localhost:5173` only, caches audio in `server/cache/` (git-ignored).

## Legal

Only use with content you have the rights to. This is a demo convenience, not a download tool.
