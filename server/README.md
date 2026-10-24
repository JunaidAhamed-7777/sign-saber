# Sign Saber companion service (optional)

A planned local Node service for rights-cleared YouTube audio. **Current status: empty entry-point stub; no listener, CORS policy, job queue or cache is implemented.** The core game will use local upload and bundled tracks; this optional `[POLISH]` work follows the P2 gate in [ROADMAP.md](../ROADMAP.md).

Full specification: [docs/23-youtube-companion-service.md](../docs/23-youtube-companion-service.md).

## Prerequisites

- Node 22.12+ on the Node 22 line used by the client/CI
- `yt-dlp` and `ffmpeg` on `PATH`

## Run

```bash
cd server
npm run server
```

Run from the repository root. Today this command invokes the empty module and exits. Once implemented, bind only to loopback, validate exact allowed client origins, use a bounded single-job process with time/output limits, and cache only server-owned paths. Preview and dev origins must be handled explicitly; CORS is not authentication. See the [service specification](../docs/23-youtube-companion-service.md) for required request protection and failure behavior.

## Legal

Only use with content you have the rights to and in accordance with the source service's applicable terms. Keep third-party binary licenses and notices. Do not add arbitrary URL download, cookies, credentials or private media to the project.
