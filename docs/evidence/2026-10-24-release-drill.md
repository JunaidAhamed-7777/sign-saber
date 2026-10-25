# 2026-10-24 — Release drill

Outcome: **FAIL**. Tested commit: `5a786e544d9e2945ac318193fbcb55d36ac26c6b`.

Environment: Node v26.8.1, npm 11.19.0, win32 10.0.26300 x64; browser not reached.

Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.

- PASS — Clone current commit (1392 ms; exit 0).
- PASS — Checkout tested SHA (1057 ms; exit 0).
- PASS — npm ci (60089 ms; exit 0).
- FAIL — npm run check (71988 ms; exit 1).

Network: 0 observed page/worker requests, 0 blocked external attempts; 0 console/runtime/log errors; 0 CSP violations. Unreached checks are not passes.

Synthetic performer results: not reached.

The browser uses a dead loopback proxy for non-loopback destinations, plus CDP Fetch interception on the page and attached workers. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.

Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.

Failure: Error: npm run check exited 1. > sign-saber@0.1.0 check > npm run typecheck && npm run lint && npm run test && npm run build npm notice run sign-saber@0.1.0 typecheck npm notice run tsc -p tsconfig.json && tsc -p tsconfig.node.json npm notice run sign-saber@0.1.0 lint npm notice run eslint . npm notice run sign-saber@0.1.0 test npm notice run vitest run RUN v5.0.5 C:/Users/Junaid/AppData/Local/Temp/sign-saber-release-drill-7Kp846/repo/app ❯ tests/unit/gapless.test.mjs (7 tests | 1 failed) 12177ms ❯ browser gapless normalization (7) × never trims a buffer the decoder already trimmed, or one of unexplained length 6825ms ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯ FAIL tests/unit/gapless.test.mjs > browser gapless normalization > never trims a buffer the decoder already trimmed, or one of unexplained length Error: Test timed out in 5000ms. If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout". ❯ tests/unit/gapless.test.mjs:51:3 49| expect(result.getChannelData(0)[0]).toBe(Math.round(trim.encoderDe… 50| }); 51| it('never trims a buffer the decoder already trimmed, or one of unex… | ^ 52| const bytes = bytesOf('cipher'); 53| const trim = readITunSmpb(bytes); ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯ Test Files 1 failed | 44 passed (45) Tests 1 failed | 334 passed (335) Start at 03:44:13 Duration 19.16s (transform 48%, tests 42%, import 10%, worker 1%) Isolate 45 workers spawned · ~700ms startup each (spawn + environment, per file) at least ~1.40s faster with isolate: false — reuses workers across files instead of one per file at step (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:255:33) at async runDrill (file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:276:7) at async file:///C:/Github-2/sign-saber-issue-3/scripts/release-drill.mjs:303:15
