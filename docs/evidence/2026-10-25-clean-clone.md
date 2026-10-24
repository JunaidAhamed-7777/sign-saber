# Clean-clone validation — 2026-10-25

The exact pushed checkpoint `08d7555c09cca40116862fbc75b5b99f9c45b964` passed in a fresh remote clone on Windows with checksum-verified Node 22.23.4 and npm 10.9.9. The checkout was clean before installation and after verification. [The compact manifest](2026-10-25-clean-clone.json) records the runtime archive hash, lockfile hash, commands, exits and counts.

`npm ci` succeeded, followed by typecheck, lint, **262 tests across 38 files** and the production build. Documentation checks passed two assertions and checked 44 Markdown files / 484 local links with zero errors. Asset/server checks passed eight assertions; one symlink test was skipped because this host cannot create symlinks. The six GLBs passed read-only geometry checks: 3,320 triangles / 194,488 bytes. Vite retained its large-chunk warning.

The [prepared-build HTTP report](2026-10-25-clean-clone-http.json) records 29 local responses, all with status 200 and CSP, with zero integrity failures. Registry hashes matched the three complete MP3s, nine maps, dataset annotations, six GLBs, two fonts and their licenses. No optional tracking models were present.

The [before-fix failure](2026-10-25-clean-clone-before-fix-http.json) is retained. At `db09f2b`, source checks passed but the dataset HTTP hash failed: Git distributed canonical LF bytes while the runtime pin described the original CRLF file. The corrected pin and four byte-level tests are included in `08d7555`.

This is build/HTTP evidence. Browser gameplay, audible sync, human/webcam acceptance, a disconnected venue exercise, GPU/frame timing and P5 release gates were not exercised by this check. The HTTP probe was a temporary diagnostic script, not an advertised repository command.
