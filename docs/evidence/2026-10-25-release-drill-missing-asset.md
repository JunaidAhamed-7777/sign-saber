# 2026-10-25 — Release drill (injected missing asset)

Outcome: **FAIL**. Tested commit: `d14c980aca096e530586a771983edfb65ca22cdd`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-24T22:59:23.886Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (3258 ms; exit 0).
- PASS — Checkout tested SHA (941 ms; exit 0).
- PASS — npm ci (460142 ms; exit 0).
- PASS — npm run check (76025 ms; exit 0).
- PASS — npm run build (3712 ms; exit 0).
- PASS — Inject missing catalog asset into temporary prepared build (3 ms).
- FAIL — BOOT → SELECT offline (32460 ms): Local music catalog did not load.
- NOT RUN — Select song and enable sound with native CDP input.
- NOT RUN — Synthetic performer → genuine results.
- NOT RUN — Results → Retry → playing → pause → Songs.
- NOT RUN — Offline network, console and CSP assertions.

Network: 13 observed page/worker requests, 0 blocked external attempts; 1 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: not reached.

The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.

Failure: Error: Local music catalog did not load at waitFor (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:206:9) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:393:9 at async step (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:552:23) at async browserJourney (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:390:7) at async runDrill (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:649:5) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:702:11
