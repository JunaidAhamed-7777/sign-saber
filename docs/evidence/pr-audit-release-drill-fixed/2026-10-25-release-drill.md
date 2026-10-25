# 2026-10-25 — Release drill

Outcome: **PASS**. Tested commit: `886f7beb990af721bd2faf4292cc9260c97379fb`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser Chrome/155.0.8059.86.

Recorded at 2026-10-25T00:16:47.852Z; evidence filename date uses Asia/Calcutta. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (3127 ms; exit 0).
- PASS — Checkout tested SHA (1810 ms; exit 0).
- PASS — npm ci (68474 ms; exit 0).
- PASS — npm run check (39224 ms; exit 0).
- PASS — npm run build (1223 ms; exit 0).
- PASS — BOOT → SELECT offline (2063 ms).
- PASS — Select song and enable sound with native CDP input (1541 ms).
- PASS — Synthetic performer → genuine results (91662 ms).
- PASS — Results → Retry → playing → pause → Songs (2141 ms).
- PASS — Offline network, console and CSP assertions (0 ms).

Network: 24 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: {"counts":{"perfect":84,"great":0,"good":0,"miss":0,"badcut":0},"hits":84,"summary":"Score\n54,700\nAccuracy\n100.0%\nBest combo\n84","source":{"lane":"synthetic-performer-logic-replay","performerTrial":{"synthetic":true,"camera":false,"plannedUnplayableNotes":0}}}.

The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.
