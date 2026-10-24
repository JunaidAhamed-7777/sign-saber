# Eight-song local library — 2026-10-25

**Current acceptance uses generator version 3.** Immediately after the initial PR opened, main integrated the awaited chart branch in 93e411e. The branch normally integrated that work and regenerated the entire eight-song/24-map pack again, resolving generated JSON conflicts only through the shared generator. Original MP3/acquisition/attribution bytes and canonical audio hashes remain unchanged.

The current pack passed the complete npm run check: typecheck, lint, 50 suites/502 assertions and production build. Upstream readability and full synthetic InputPipeline/GameSession replay tests now cover all 24 charts. [The v3 chart diagnostic](2026-10-25-eight-song-chart-report-v3.txt) reports zero unplayable notes on every chart. These are algorithmic/synthetic checks, not webcam or human musical-quality evidence.

[The current-v3 browser report](2026-10-25-eight-song-library-v3-browser.json) passed at both 1440×900 and 1024×640: all eight songs/all 24 difficulty maps selected through native controls, original preview started/stopped, music/credits pages traversed and every exact attribution/source/license link verified. No external page requests were attempted; there were zero CSP violations, JavaScript-console errors or failed music requests. Existing favicon 404 responses remain visible. The report retains its base/merging-main SHAs and exact manifest SHA-256 (18293e3138d186798367f337e30245d36ed7e8e5869fb3471c20e3be2a063744). The linked PNGs below were refreshed and inspected from this v3 run.

The earlier generator-v2 checkpoints below are retained as history; current acceptance relies on the v3 outcomes above.

Issue [#2](https://github.com/JunaidAhamed-7777/sign-saber/issues/2) expands the three-song starter pack to eight full songs. The five additions were fetched unchanged from the official Incompetech catalog on 2026-10-25 local time. Each official track page explicitly supplied the By Attribution 4.0 license template at acquisition; the receipts retain the page/catalog/audio SHA-256, ISRC, original filename, exact attribution and verification timestamp.

- Chipper Doodle v2: catalog 92 BPM; canonical duration 172,173.923 ms; original MP3 6,892,257 bytes.
- Funkorama: catalog 101 BPM; canonical duration 201,386.168 ms; original MP3 8,199,078 bytes.
- Cut and Run: catalog 109 BPM; canonical duration 214,766.395 ms; original MP3 8,595,361 bytes.
- Rhinoceros: catalog 126 BPM; canonical duration 203,809.524 ms; original MP3 6,526,607 bytes.
- Marty Gots a Plan: catalog 140 BPM; canonical duration 168,000 ms; original MP3 5,380,559 bytes.

Catalog BPM guided selection and is not a confident detector result. All eight tracks retain their actual low-tempo-confidence warnings. The shared generator produced Easy/Normal/Hard charts from the exact canonical PCM for every track (24 maps). `generation.json` receipts record the actual onsets, chart counts, gapless decode bounds and PCM hashes. All maps passed the shared validator. No generated JSON was reformatted by hand.

The initial regeneration used generator version 2 from main `1fa18275ede204275a1c8dbc4c835da32e85ed30`, fetched immediately before regeneration. After main advanced with renderer/UI assets, the branch integrated `cfdcc408947658716222f2f48c184411917e564e` normally and regenerated all 24 maps again with its unchanged generator version 2. Environment: Windows, Node 26.8.1, npm 12.2.1 and ffmpeg 9.0.2. The initial `npm run check` passed typecheck, lint, 47 suites/376 assertions and production build. The existing large-bundle warning belongs to separate issue #1. Root documentation tests passed 2/2 and the documentation link checker passed.

The integrated `npm run check` on cfdcc40 passed typecheck, lint, 48 suites/380 assertions and production build. Scoped Prettier checks passed. Root docs tests passed 2/2; the checker reported 48 Markdown files/521 links before the final screenshot links were added.

The first full check exposed three existing UI structure assertions that assumed the whole library fit on one page. They now assert the registered page size and actual page count; production UI behavior was unchanged. The first dependency installation failed because the shared npm cache lost a tarball; an isolated-cache `npm ci` succeeded without a lockfile change.

Browser outcomes are retained in [the JSON report](2026-10-25-eight-song-library.json). [The initial browser harness failure](2026-10-25-eight-song-library-harness-failure.json) is retained separately: a polling predicate returned a DOM element instead of a boolean, causing CDP serialization to fail before app assertions. It was corrected in the temporary driver.

The complete browser run passed on Chrome 155.0.8059.86 with headless SwiftShader. At each of 1440×900 and 1024×640, native CDP clicks selected all eight songs and every difficulty (24 maps per viewport), traversed the music pages, enabled sound, started/stopped the original-song preview and verified all eight exact attribution strings plus source/license links. Non-loopback page requests were blocked; none were attempted. There were zero CSP violations, JavaScript console errors or failed music requests. The unrelated favicon 404 remains visible in the report.

After integrating the renderer/UI changes from main, [the final integration browser run](2026-10-25-eight-song-library-latest-main.json) repeated boot, every song's Normal selection, preview and all exact credits at both viewports. It passed with the same zero-failure music/CSP/console/external-request outcomes. The current screenshots were inspected: [desktop library](../images/2026-10-25-library-eight-1440.png), [compact library](../images/2026-10-25-library-eight-1024.png), [desktop credits](../images/2026-10-25-library-credits-1440.png) and [compact credits](../images/2026-10-25-library-credits-1024.png).

[A second attempt](2026-10-25-eight-song-library-favicon-failure.json) completed all desktop song/difficulty/credits checks but the driver incorrectly treated the app's existing unrelated `/favicon.ico` 404 as a music-library failure. The final attempt continues to record every HTTP failure while asserting zero failed music assets. No favicon or other unrelated product change was made. That attempt also hit a Windows lock while removing its isolated browser profile; cleanup was changed to use bounded retries.

Main subsequently added a separate dataset-camera Settings page in 752acf3. A normal merge produced code commit d49bbf7c300679eea1083293dfff0a5b7365beda. Its complete npm run check passed typecheck, lint, 48 suites/380 assertions and production build. The generator sources/version and all music hashes remained unchanged. [The pager integration report](2026-10-25-eight-song-library-final-integration.json) rechecks eighth-song selection and every exact credit through the additional Settings page at both viewports; it passed with zero music/CSP/console/external-request failures.

Main's later footer/ARIA and unrelated training updates in 52e9c81 were preserved by another normal merge, producing tested code commit 0ec036c0474acbc7983038d239fb3e881fad72b4. Its full npm run check passed typecheck, lint, 48 suites/382 assertions and production build. [The current-head browser report](2026-10-25-eight-song-library-verified-head.json) repeats the eighth-song selection and exact eight-credit navigation at both requested viewports with zero CSP, console or external-request failures. The linked PNG screenshots were refreshed and inspected from this code commit. Subsequent evidence-only commits do not change the tested application.

These checks do not establish human musical quality, comfort, webcam recognition, live gesture play, frame-rate or release readiness.
