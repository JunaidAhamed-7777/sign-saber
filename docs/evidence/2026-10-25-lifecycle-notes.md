# Non-camera lifecycle evidence — 2026-10-25

The [complete report](2026-10-25-lifecycle-qa.md) and [raw JSON](2026-10-25-lifecycle-qa.json) passed all eight issue #4 scenarios on clean source `ca7eefeb482a7a8e2520ac18efb89b6d052e9cb2`, including upstream avatar checkpoint `30572bb`. Every scenario ran; all 20 measured cycles are retained individually. The original synthesized upload reached real Results with 12 Perfect hits, one wall dodge, score 2,100 and accuracy 1. Cancellation occurred during actual STFT at fraction 0.45. Low, medium and high each reached genuine positive performer Results.

The later [loaded-avatar context report](2026-10-25-lifecycle-avatar-ready/2026-10-25-lifecycle-qa.md) and [raw supplement](2026-10-25-lifecycle-avatar-ready/2026-10-25-lifecycle-qa.json) passed all 12 context checks on clean source `99fe5d4e4c5c2150fc233d1bc8b0356974b3732b`. Its only application addition is a read-only view of the renderer's existing `avatarStatus` getter. Both menu and play waited for `ready` and two actual animation frames before losing WebGL. The supplement deliberately leaves the other seven cases **not-run**, reports overall incomplete and exits 1; it does not overwrite or relabel the complete eight-case report.

## Failures found and addressed

- IndexedDB denial/quota allowed chart generation but hid the cache warning. The ready selection now visibly says **Local cache unavailable · chart not saved**, including the compact layout.
- Actual WebGL loss left audio/scoring and render callbacks running behind a broken canvas. The runtime now stops/cancels owned work, presents the existing opaque fatal screen and requires native Retry/reload. Menu and play reload recovery passed; play has a suspended native realtime audio context, zero active SFX voices, a stopped clock/score and zero observed continuing application frame callbacks.
- A real tab switch delivered blur before visibility change, recording a hidden pause as manual. Blur now cancels pointer input; actual visibility owns hidden pauses. A prior manual pause retains its reason. Countdown cancellation, hidden play pause and explicit Resume passed; returning alone never starts play.

The [pre-fix partial probe](2026-10-25-lifecycle-baseline.json) and [first complete failed matrix](2026-10-25-lifecycle-first-matrix.json) remain unchanged. The partial probe's upload assertion also incorrectly treated an existing Three.js geometry warning as an error; its genuine Results remain recorded. The final harness preserves warnings separately and fails actual console errors/exceptions.

## Resource boundary and all 20 samples

The first full matrix compared a running Results/menu boundary with nine native AudioNodes against paused/quit boundaries with ten or eleven, and correctly failed its strict gate. That failure was not removed or given a tolerance.

The final run first completes a generated-chart performance, exercises one retry cycle and one quit cycle, then requires three identical quiet/post-GC snapshots at the same suspended-audio menu boundary. Its fixed baseline is 110 geometries, 14 textures, 188 native DOM event listeners, two native workers, three native audio contexts and eleven native AudioNodes. Every measured cycle stays at or below every gated baseline metric; every fifth cycle also completes Results and Retry. Application cleanup/listener registrations remain 13. Observer registration tokens are auxiliary only.

The JSON includes native node IDs, types, context states and outgoing graph connections. At every quit, the realtime context is suspended, the app reports zero active SFX voices, and the one or two remaining native buffer sources have no outgoing connections. Their IDs are replaced on later cycles rather than accumulating. These observations distinguish bounded stopped browser nodes at suspension from growth in a connected graph. Source-stop/disconnect behavior also has runtime/SFX regressions. Warm-up is separate from all 20 measured samples; the baseline never moves during measurement.

Native measurements use the installed Chrome protocol's [WebAudio lifetime/graph events](https://chromedevtools.github.io/devtools-protocol/tot/WebAudio/), `Memory.getDOMCounters`, `HeapProfiler.collectGarbage` and current-context `Target.getTargets`. The probes retain string IDs rather than AudioNode/DOM/Worker objects. Actual `renderer.info.memory` comes through the opt-in read-only stats snapshot.

The [earlier complete pre-avatar report](2026-10-25-lifecycle-96aa536/2026-10-25-lifecycle-qa.md) and [raw evidence](2026-10-25-lifecycle-96aa536/2026-10-25-lifecycle-qa.json) separately passed on clean `96aa536`. Its 107-geometry/13-texture baseline is historical and is not reused for the final avatar renderer.

## Reproduce and checks

From the repository root, with Node 22+, Chrome (or `BROWSER_BINARY`) and installed `app/` dependencies:

```powershell
node --test scripts/lifecycle-helpers.test.mjs
node scripts/lifecycle-qa.mjs
```

The full command builds production assets and writes dated JSON/Markdown. Independent cases use `--scenario upload`, `cancel`, `invalid`, `cache`, `context`, `cycles`, `hidden` or `tiers`; comma-separated selections work. A partial run intentionally exits nonzero. Use a separate `--out <directory>` for supplements. `--no-build` requires a production build from the intended source checkpoint.

Required application checks passed typecheck, lint, 488 assertions in 55 files and production build, including the final read-only diagnostic addition. Five pure harness tests and two documentation-checker tests passed. Root Markdown link/heading checking and whitespace validation passed before committing. The generic strict UI auditor's pre-existing native-select/shared-target findings are recorded in the changelog; a clean static audit is not claimed.

Current screenshots were captured from the actual app at [1440 × 900](2026-10-25-lifecycle-cache-1440.webp) and [1024 × 640](2026-10-25-lifecycle-cache-1024.webp), with the fatal recovery screen at [desktop](2026-10-25-lifecycle-graphics-error-1440.webp) and [compact](2026-10-25-lifecycle-graphics-error-1024.webp) sizes. They were visually inspected; no mockups or camera recordings were used.

## Limits

Chrome 155.0.8059.86 on Windows, Node 26.8.1, muted headless SwiftShader. Audio files are original deterministic pulse/tone/noise WAVs; motion is the planned synthetic performer through actual scoring. This proves non-camera functionality and resource ownership at declared boundaries. It establishes no webcam recognition, audible sync, human comfort, GPU speed, FPS or musical-quality benchmark. Forced GC/resource instrumentation is separate from release-performance measurement. The existing large-bundle warning remains outside issue #4.
