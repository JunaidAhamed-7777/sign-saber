# 16 — Performance Budget

Pillar P5: smooth delivery with fresh input. `TARGET_FPS = 60`, `FLOOR_FPS = 40`; a target frame on a 60 Hz display is 16.67 ms and the sustained floor corresponds to 25 ms. **All numbers here are engineering targets or estimates, not measured results.** [24 — Benchmark & Evidence Protocol](24-benchmark-and-evidence.md) owns metric definitions, thresholds and run procedures; this document assigns subsystem budgets.

## Main-thread frame budget

GPU execution overlaps CPU submission. Leave browser/compositor headroom, but measure it rather than assuming a fixed overhead.

| Stage (per [02 §Frame loop](02-architecture.md#frame-loop)) | User Timing name | CPU target | Investigate by |
| --- | --- | --- | --- |
| Drain fresh input, filters, classifier, cursors, body | `ss:input` | ≤ 1.5 ms | 2.5 ms |
| Spawner, simulation, collision, judge, score | `ss:game` | ≤ 1.5 ms | 2.5 ms |
| Scene matrices, uniforms, particles, ribbon, fragments, camera | `ss:scene` | ≤ 2.0 ms | 3.5 ms |
| Three.js/composer CPU submission | `ss:render` | ≤ 4.0 ms | 6.0 ms |
| Throttled HUD store writes | `ss:ui` | ≤ 0.5 ms | 2.0 ms |
| Total, HUD counted once | `ss:frame` | ≤ 9.5 ms typical | 16.5 ms |
| GPU execution, valid timer queries only | GPU sample ring | ≤ 9 ms | 18 ms |

Mask upload is charged to `ss:scene`. Asynchronous React commits need separate profiling; a store-write timer does not include them. Full-play interval/CPU acceptance thresholds are in [24 §6](24-benchmark-and-evidence.md#6-initial-acceptance-targets). CPU work, callback pacing and physical presentation are different measurements.

## Tracking worker budget

Initial planning budget for the complete hand+pose+segmentation pass:

| Work | Target |
| --- | --- |
| Hand inference at `INFER_W × INFER_H`, two hands | ≤ 18 ms |
| Downscale for pose/mask | ≤ 1 ms |
| Pose Lite with segmentation at `MASK_W × MASK_H` | ≤ 16 ms |
| Mask readback/packing and landmark transfer | ≤ 5 ms |
| Complete pass | ≤ 40 ms |

`TRACK_TARGET_HZ = 30` is a request, not a guarantee. A serial 40 ms pass cannot sustain 30 Hz. Decimate pose/mask before sacrificing hand freshness; report all three output rates. Main-thread capture/transfer targets ≤ 1.5 ms CPU, while asynchronous bitmap creation is measured end-to-end too.

Only capture when the worker is idle. Keep one inference in flight, close every consumed/abandoned bitmap, skip capture opportunities while busy, and consume the latest completed result. Never build a FIFO or an additional pending bitmap queue. [05](05-tracking-pipeline.md) owns timestamp mapping, result ownership and worker lifecycle. Distinguish skipped captures, stale results and task failures in telemetry.

## Memory and allocation

Avoid avoidable allocations in game-owned hot loops after warm-up. Browser capture, MediaPipe results, transfer wrappers and discrete events may allocate; zero allocations in the entire pipeline is not a credible browser guarantee.

- Preallocate bounded note, obstacle, half, shard, poof, judgement and trail pools. Exhaustion may recycle/suppress cosmetic effects; it MUST NOT remove a live judgement candidate, alter scoring or despawn an obstacle. Reject maps that exceed logical admission limits before PLAYING.
- Reuse vectors, matrices, typed arrays and ring buffers; use indexed loops. No geometry/material/shader construction on hit. Event payloads stay small and are consumed synchronously unless copied into a bounded replay buffer.
- Keep mask storage persistent. Recycle transferred buffers only after ownership returns; never read a detached array. Close task/mask resources after copying required data.
- Format HUD values at ≤ 20 Hz and only when changed. Prewarm effects, shader variants and glyphs in BOOT; count that cost in cold-start evidence.
- Initial steady-state budgets: JS heap ≤ 150 MB when measurable; estimated GPU resources ≤ 300 MB. These are budgets, not universally available byte measurements. Three minutes of stereo 48 kHz float PCM alone uses about 69 MB (`180 × 48000 × 2 × 4`); spectrogram and analysis copies make peak SELECT memory higher. Release them when analysis finishes.
- Dispose old geometry/materials/textures/targets, stop media tracks and terminate workers on teardown. Check retained resources at the same lifecycle point through the soak/retry test in [24](24-benchmark-and-evidence.md#4-scenario-matrix-and-repetitions).

## Draw calls, textures and geometry

The planned maximum is 120 draw calls per rendered frame, including composer passes. A typical scene is estimated at 40–75; verify the finished renderer rather than presenting that estimate as a result.

- Instance shells, glyphs, armour, walls, skeletons, pylons and poof quads. The initial shatter implementation merges the fourteen shard geometries with a shard ID and uses one pooled mesh per active shatter, as specified in [11 §4.1](11-rendering-blocks-and-destruction.md#41-asset). Count armour and every internal draw; no alternative geometry-indexing design is required for this baseline.
- `SLICE_POOL` bounds the sliced-half pool at twelve geometries (six simultaneous cuts), as registered in [11](11-rendering-blocks-and-destruction.md#constants-required). Use fixed-capacity attributes and `setDrawRange`; degenerate cuts fall back without allocating or changing judgement. `MAX_FRAGMENTS` bounds all active shatter pieces including armour, independently of allocated shatter slots.
- Two particle systems, two ribbons, up to two beams, silhouette and grid complete the scene. Count transparency overdraw and postprocessing, not only draw calls.
- No shadow maps. Low quality preserves readable glyphs. Test overlapping transparency/depth flags; bloom is not a substitute for anti-aliasing.
- Persistent mask texture: `MASK_W × MASK_H`, single-channel unsigned bytes, linear filtering, no mipmaps. Update fixed storage; profile the pinned Three.js build rather than promising which GL upload call `needsUpdate` issues.
- [18 — Asset Pipeline](18-blender-mcp-asset-pipeline.md#3-asset-list) is the authority for individual model geometry/payload budgets; do not maintain a second set of triangle ceilings here. Keep the runtime glyph atlas and particle sprite bounded, use the two locally licensed font families in [14](14-ui-ux.md#typography), and record actual bytes/triangles and licences in the asset manifest.
- Texture budget excluding render targets: ≤ 24 MB. Estimate HDR/bloom targets from drawing-buffer size, attachments, formats and mips; GPU memory cannot be described as a fixed 10 MB at “1080p” without those details.

## Post-processing cost

Use one scene `RenderPass` and merged compatible effects through `postprocessing`; bloom's mip passes still count. Probe HDR target completeness and fall back when unsupported.

Initial GPU planning estimates at a 1920×1080 drawing buffer: scene 3–5 ms, half-resolution bloom 1.5–2.5 ms, FXAA about 0.4 ms, merged vignette/aberration about 0.3 ms. **These are unverified estimates, including on Intel Iris Xe.** Record actual valid GPU samples or mark them unavailable. Lower pixel ratio/bloom resolution after confirming GPU pressure; fewer pixels cannot fix a CPU-bound classifier.

## Quality tiers

This is the **single canonical tier preset table**. `render/quality.ts` applies it; [10](10-rendering-silhouette.md), [11](11-rendering-blocks-and-destruction.md), [12](12-rendering-hands-trails.md) and [13](13-rendering-environment-camera-postfx.md) explain implementation without redefining these presets. Tiers are cosmetic: timing windows, gestures, hit volumes and scores stay identical.

| Setting | `high` | `medium` | `low` |
| --- | --- | --- | --- |
| Render scale | 1.0 | 1.0; 0.85 when CSS viewport height exceeds 1440 px | 0.75 |
| Effective pixel ratio | `min(devicePixelRatio, 1) * renderScale` | same formula | same formula |
| Bloom resolution scale | 0.5 | 0.35 | 0.25; off if HDR target unsupported |
| Bloom mip levels | 6 | 5 | 4 |
| Bloom intensity | 1.2 | 1.0 | 0.9 |
| Chromatic aberration | optional `[POLISH]` brief drop accents | off | off |
| Antialiasing | SMAA medium preset | FXAA | off |
| Trail particles per hand | 256 | 160 | 96 |
| Ribbon layers | core + glow | core + glow | core only, widened for readability |
| Ribbon spine samples | 48 | 48 | 32 |
| Tip sparks | on | on | off |
| Beam noise | 2 octaves | 1 octave | off |
| Skeleton | joints + bones | joints + bones | joints only |
| Silhouette mask taps | 9 taps × 2 textures | 9 taps × 2 textures | 5 taps × 1 texture |
| Mask temporal blend | on, subject to lag/contour validation | same | off; newest accepted mask |
| Silhouette halo | on | on | off |
| Hand glow spots | on | on | on |
| Effective fragment cap | 256 | 192 | 128 |
| Smash geometry | complete authored 14-piece body + armour, or complete procedural fallback | same | complete eight-octant fallback + armour |
| Fragment lifetime | `FRAGMENT_LIFETIME_MS` | same | × 0.7 |
| Poof sparks | 24 | 24 | 12 |
| Target-linked aim-assist line | optional `[POLISH]` | optional `[POLISH]` | off |
| Grid | antialiased glow | antialiased | plain |
| Mask upload | every new distinct mask | same | same; never upload repeated mask data from hand-only results |
| Dust points | 600 | 400 | 200 |
| Pylons | 14 | 14 | 8 |

These are defaults, not measured guarantees. `QUALITY_TIER_PRESETS` in `core/constants.ts` exports this complete immutable table alongside the shared registry in [02](02-architecture.md#constants). `QUALITY_DPR_CAP = 1`, `QUALITY_MEDIUM_TALL_HEIGHT_PX = 1440` and `QUALITY_MEDIUM_TALL_RENDER_SCALE = 0.85` name the sizing rules. `resolveQuality` computes requested settings and explicitly reports unsupported renderer features; exporting a preset does not establish that a consumer applies every effect. Renderer integration and probe/adaptation evidence are separate milestones. Scalar values denote baseline/high limits unless their registry states otherwise; the table supplies explicit tier overrides. Do not copy preset literals into render modules.

Apply effective pixel ratio to the 3D drawing buffer, not the DOM HUD. Mask cadence is based on unique segmentation timestamps, independent of the worker's separately logged hand/pose/mask inference cadences; low quality must not turn a hand-only result into a redundant upload. Any later upload decimation is a recorded configuration change and must be checked for contour age/lag. Plain low-tier grid lines still need antialiased edges; simplify decoration rather than creating horizon moiré. Fixed-tier benchmarks freeze all these settings; auto tier transitions disclose the resulting workload. Reduced-motion/Calm overrides decoration at every tier and is included in evidence manifests.

### Boot probe

Start at medium on an unknown device. BOOT may run capability/render-only checks, but must reach the camera-free menu and placeholder without opening a stream. Prewarm required effects and validate the full representative tracking-on scene after explicit setup succeeds, with declared notes, shards, mask uploads and bloom for at least two seconds. Procedural input is labelled in diagnostics. Measure interval percentiles, CPU headroom and valid GPU duration; an empty/placeholder scene cannot certify play performance.

Downshift when delivery fails or CPU headroom is inadequate. Test high only in a separate scene pass that meets the same gates with the higher workload; without reliable GPU timing, remain conservative. Persist a probe result with browser/build/viewport/DPR identity and re-probe after relevant changes. Camera-on play validates the choice because a synthetic scene omits inference contention. `?probe=1` reruns; `?tier=low|medium|high` forces a declared QA tier.

### Runtime downgrade

Keep five-second delivery/FPS rings. If delivered FPS stays below `FLOOR_FPS` for three consecutive seconds, or sustained interval p95 exceeds the floor interval, step down on a frame boundary and reset the observation window. Never step up during PLAYING; a new SELECT probe may consider an upgrade. Log old/new tier, song time, reason and drawing-buffer dimensions. Fixed-tier benchmarks disable adaptation and record failure rather than silently reducing workload.

## Measurement tooling

- Preallocated timing rings feed overlay/export. Clear consumed User Timing entries so telemetry does not accumulate for a whole session. Refresh displayed percentiles at HUD cadence rather than sorting arrays every frame.
- Display interval p50/p95/p99, CPU stages, valid GPU durations, tier/dimensions, input age/rates, inference duration, skipped captures, pool counts and draw calls. Label pipeline latency estimates honestly.
- Collect renderer counts for the complete composer frame (`renderer.info.autoReset = false`, one explicit reset after collection); otherwise later passes can overwrite counts. Memory counters are object counts, not GPU bytes.
- Profile a separate 20-second busy section in DevTools for long tasks, allocations, shader compilation, uploads and worker contention. Export with date/SHA. Profiler-on timing is diagnostic, not the release measurement.
- `?stats=1`, tier/replay/record controls and evidence export are planned features. Production diagnostics stay read-only and must not silently enable replay or alter scoring.

## Optimisation priorities

1. Correct timestamps and discard stale work; freshness matters more than processing every camera frame.
2. Identify CPU, GPU, bandwidth or inference contention in the complete scene.
3. Bound allocations/resource ownership; reduce upload volume and overdraw.
4. Adjust cosmetic quality and compare identical input/seed/dimensions.
5. Retain changes with raw before/after evidence and passing correctness/player checks. Follow [24 §8](24-benchmark-and-evidence.md#8-optimisation-loop-and-ablations).

## Acceptance criteria

- [ ] All targets and procedures in [24](24-benchmark-and-evidence.md) are measured on the declared demo configuration; failures are retained.
- [ ] CPU, callback intervals, GPU execution and physical latency are distinct in reports.
- [ ] No logical pool overflow on admitted maps; all hot-path/resource ownership rules are checked.
- [ ] Fixed/adaptive tiers are separate experiments; downgrades never change gameplay.
- [ ] Soak and ten restart/song-change cycles show stable retained counts or an explicit failure.

## Current fixed-tier implementation

The runtime passes `?tier=low|medium|high` and `?contrast=1` to the renderer. Implemented consumers cover effective drawing-buffer DPR/render scale, complete-effect fragment caps/lifetimes, 12/24 poof points, complete eight-octant low-tier smash geometry, 8/14 pylon totals and owned upper-body joints/bones. Contrast changes the real mask threshold/edge uniforms. `renderer.quality` exposes the complete request and unsupported features. Bloom, HDR targets, FXAA/SMAA, the full particle/ribbon subsystem and automatic probing/adaptation remain unimplemented. Their preset entries are not runtime success claims. Fixed tiers never alter judgement or audio clocks; native visual and performance acceptance remain open.
