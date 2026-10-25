# 2026-10-25 — Release drill

Outcome: **FAIL**. Tested commit: `b9b1a85fa76bcd77924a6d86b9c64f847c2c9bbc`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-24T22:42:48.675Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (3539 ms; exit 0).
- PASS — Checkout tested SHA (1102 ms; exit 0).
- PASS — npm ci (47134 ms; exit 0).
- PASS — npm run check (275488 ms; exit 0).
- PASS — npm run build (15696 ms; exit 0).
- PASS — BOOT → SELECT offline (2315 ms).
- PASS — Select song and enable sound with native CDP input (3099 ms).
- FAIL — Synthetic performer → genuine results (30310 ms): Did not reach CALIBRATION.
- NOT RUN — Results → Retry → playing → pause → Songs.
- NOT RUN — Offline network, console and CSP assertions.

Network: 52 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: not reached.

The browser uses a dead loopback proxy for non-loopback destinations, plus CDP Fetch interception on the page and attached workers. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.

Failure: Error: Did not reach CALIBRATION at waitFor (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:171:9) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:406:9 at async step (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:532:23) at async browserJourney (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:404:7) at async runDrill (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:629:5) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:682:11
