# 2026-10-25 — Prepared integration preview

Outcome: **PASS**. Tested commit: `f68f84e933bb6495bc66f80da455f7b3ae5e3fd8`.

This supplemental check runs the same tracked browser journey against the prepared production build after the normal main integration. It does not perform a fresh clone or installation; those earlier results remain at their explicit source SHAs.

- PASS — BOOT → SELECT offline (3369 ms).
- PASS — Select song and enable sound with native CDP input (6295 ms).
- PASS — Synthetic performer → genuine results (101389 ms).
- PASS — Results → Retry → playing → pause → Songs (2560 ms).
- PASS — Offline network, console and CSP assertions (0 ms).

Results: {"counts":{"perfect":84,"great":0,"good":0,"miss":0,"badcut":0},"hits":84,"summary":"Score\n54,700\nAccuracy\n100.0%\nBest combo\n84","label":"◆SYNTHETIC PERFORMER · planned motion · no camera"}.

Observed app requests: 17; console/runtime errors: 0; CSP violations: 0.

Camera/model preparation, people, recognition, audible synchronization and performance targets are excluded. This is planned synthetic input, not webcam evidence.
