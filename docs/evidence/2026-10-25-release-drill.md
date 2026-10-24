# 2026-10-25 — Release drill

Outcome: **FAIL**. Tested commit: `ad41466990b7e62321b835c7261df4559dc53921`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (3249 ms; exit 0).
- PASS — Checkout tested SHA (2875 ms; exit 0).
- PASS — npm ci (79318 ms; exit 0).
- PASS — npm run check (149651 ms; exit 0).
- PASS — npm run build (7142 ms; exit 0).
- PASS — BOOT → SELECT offline (2745 ms).
- FAIL — Select song and enable sound with native CDP input (30867 ms): Sound did not unlock.

Network: 15 observed page/worker requests, 0 blocked external attempts; 1 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: not reached.

The browser uses a dead loopback proxy for non-loopback destinations, plus CDP Fetch interception on the page and attached workers. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.

Failure: Error: Sound did not unlock at waitFor (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:107:9) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:192:9 at async step (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:250:23) at async browserJourney (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:188:7) at async runDrill (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:280:5) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:301:15
