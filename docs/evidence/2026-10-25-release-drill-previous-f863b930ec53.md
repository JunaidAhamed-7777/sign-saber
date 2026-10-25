# 2026-10-25 — Release drill

Outcome: **PASS**. Tested commit: `d14c980aca096e530586a771983edfb65ca22cdd`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-24T22:54:42.079Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (3009 ms; exit 0).
- PASS — Checkout tested SHA (1026 ms; exit 0).
- PASS — npm ci (53248 ms; exit 0).
- PASS — npm run check (70626 ms; exit 0).
- PASS — npm run build (3603 ms; exit 0).
- PASS — BOOT → SELECT offline (3530 ms).
- PASS — Select song and enable sound with native CDP input (2323 ms).
- PASS — Synthetic performer → genuine results (96092 ms).
- PASS — Results → Retry → playing → pause → Songs (2322 ms).
- PASS — Offline network, console and CSP assertions (0 ms).

Network: 16 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: {"counts":{"perfect":131,"great":0,"good":0,"miss":0,"badcut":0},"hits":131,"summary":"Score\n90,800\nAccuracy\n100.0%\nBest combo\n131","label":"◆SYNTHETIC PERFORMER · planned motion · no camera"}.

The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.
