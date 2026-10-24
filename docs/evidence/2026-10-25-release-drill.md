# 2026-10-25 — Release drill

Outcome: **PASS**. Tested commit: `10bca5ef1aa1aada09c06b1ead5139f7f4bf11c6`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-24T23:17:30.853Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (610 ms; exit 0).
- PASS — Checkout tested SHA (781 ms; exit 0).
- PASS — npm ci (53167 ms; exit 0).
- PASS — npm run check (49392 ms; exit 0).
- PASS — npm run build (1871 ms; exit 0).
- PASS — BOOT → SELECT offline (1632 ms).
- PASS — Select song and enable sound with native CDP input (3372 ms).
- PASS — Synthetic performer → genuine results (92560 ms).
- PASS — Results → Retry → playing → pause → Songs (3550 ms).
- PASS — Offline network, console and CSP assertions (0 ms).

Network: 17 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: {"counts":{"perfect":84,"great":0,"good":0,"miss":0,"badcut":0},"hits":84,"summary":"Score\n54,700\nAccuracy\n100.0%\nBest combo\n84","label":"◆SYNTHETIC PERFORMER · planned motion · no camera"}.

The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.
