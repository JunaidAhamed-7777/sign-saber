# 2026-10-25 — Release drill

Outcome: **FAIL**. Tested commit: `810bf679db2efe25818df0a5dece8b48b5c8bd06`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-25T00:15:17.576Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (773 ms; exit 0).
- PASS — Checkout tested SHA (629 ms; exit 0).
- PASS — npm ci (20199 ms; exit 0).
- PASS — npm run check (34624 ms; exit 0).
- PASS — npm run build (3747 ms; exit 0).
- PASS — BOOT → SELECT offline (2285 ms).
- PASS — Select song and enable sound with native CDP input (1573 ms).
- FAIL — Synthetic performer → genuine results (91144 ms): Synthetic performer label missing.
- NOT RUN — Results → Retry → playing → pause → Songs.
- NOT RUN — Offline network, console and CSP assertions.

Network: 24 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: {"counts":{"perfect":84,"great":0,"good":0,"miss":0,"badcut":0},"hits":84,"summary":"Score\n54,700\nAccuracy\n100.0%\nBest combo\n84"}.

The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.

Failure: Error: Synthetic performer label missing at file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:441:17 at async step (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:557:23) at async browserJourney (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:429:7) at async runDrill (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:654:5) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:707:11
