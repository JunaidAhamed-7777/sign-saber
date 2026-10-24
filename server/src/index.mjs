// Sign Saber — companion service entry point
//
// Responsibility: HTTP service on http://localhost:8787 wrapping yt-dlp:
//   GET  /api/health
//   GET  /api/yt/resolve?url=…
//   POST /api/yt/fetch        { url }
//   GET  /api/yt/status/:id
//   GET  /api/yt/audio/:id     (range requests)
// Zero npm dependencies: node:http, node:child_process, node:fs.
// Spec: docs/23-youtube-companion-service.md. Decision: docs/03-decisions.md ADR-012.
//
// Implementation begins at the hackathon (docs/19-build-plan.md, H10 [POLISH]).
