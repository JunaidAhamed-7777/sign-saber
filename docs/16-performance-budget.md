# 16 — Performance Budget

Pillar P5: *60 FPS or it did not happen.* `TARGET_FPS = 60`, `FLOOR_FPS = 40`. This document is the contract every rendering and logic feature is measured against on the **demo laptop** (the exact machine that will sit on the judges' table). A feature that cannot meet its line in the budget is tiered down or cut before the feature freeze ([19](19-build-plan.md)).

## Main-thread frame budget

At 60 FPS a frame is 16.67 ms; the compositor and browser overhead take ≈ 2 ms, leaving **≈ 14 ms** of our own work (CPU) with GPU work overlapping. At the 40 FPS floor the frame is 25 ms.

| Stage (per [02 §Frame loop](02-architecture.md#frame-loop)) | `performance.measure` name | Budget @60 | Hard cap @40 |
| --- | --- | --- | --- |
| Drain tracking + input pipeline (filters, classifier, cursors, body) | `ss:input` | ≤ 1.5 ms | 2.5 ms |
| Spawner + simulate + hit detection + judge + score | `ss:game` | ≤ 1.5 ms | 2.5 ms |
| Scene update (instance matrices, uniforms, particles, ribbon, fragments, camera rig) | `ss:scene` | ≤ 2.0 ms | 3.5 ms |
| Render submit (Three.js `render` + composer, CPU side) | `ss:render` | ≤ 4.0 ms | 6.0 ms |
| UI store update (throttled) + React commit | `ss:ui` | ≤ 0.5 ms avg | 2.0 ms |
| **CPU total** | `ss:frame` | **≤ 9.5 ms** | **≤ 16.5 ms** |
| GPU (measured with `EXT_disjoint_timer_query_webgl2` when available, else inferred from frame time with CPU idle) | — | ≤ 9 ms | ≤ 18 ms |

Mask texture upload (`texSubImage2D` of 320×180 R8) happens inside `ss:scene` and is counted there (≈ 0.1–0.3 ms).

Frame pacing: `ss:frame` 95th percentile MUST be ≤ 14 ms and no more than 2 frames per minute may exceed 33 ms (visible hitch). Hitches are almost always GC or synchronous texture/geometry creation; see §GC avoidance.

## Tracking worker budget

| Item | Budget |
| --- | --- |
| `HandLandmarker.detectForVideo` (640×360, 2 hands, GPU) | ≤ 18 ms |
| Downscale to 320×180 in worker (`drawImage` to `OffscreenCanvas`) | ≤ 1 ms |
| `PoseLandmarker.detectForVideo` lite + segmentation (320×180, GPU) | ≤ 16 ms |
| `MPMask.getAsUint8Array()` readback + horizontal flip | ≤ 3 ms |
| Pack landmarks + `postMessage` (transfer) | ≤ 1 ms |
| **Total per frame** | **≤ 40 ms → ≥ 24 Hz** (target `TRACK_TARGET_HZ = 30`) |

Main-thread capture cost (`requestVideoFrameCallback` → `createImageBitmap(video, { resizeWidth: INFER_W, resizeHeight: INFER_H })` → transfer): ≤ 1.5 ms, and it only runs when the worker reports idle (keep-latest policy, never a queue).

If the worker total exceeds 40 ms for 2 s, the worker alternates pose every other frame (hands stay at full rate; pose/mask at 15 Hz) — the silhouette tolerates 15 Hz, the hands do not.

## Memory and allocation

The hot path (everything inside `ss:frame`) MUST NOT allocate per frame once warmed up:

- **Pools**: live notes (`MAX_LIVE_NOTES`), obstacles (8), fragments (`MAX_FRAGMENTS`), sliced halves (32), poof emitters (16), judgement pops (16), trail particles (`MAX_TRAIL_PARTICLES_PER_HAND` × 2). Each pool is pre-allocated at scene creation and never grows during `PLAYING`; exhaustion recycles the oldest item (never a `new`).
- **Vectors**: `Vec3`/`Quat` scratch instances are module-level (`const _v = new Vector3()`), never created inside update functions. Cursor `history` is a ring buffer over a `Float32Array(TRAIL_HISTORY * 3)`.
- **Typed arrays** for all per-frame bulk data: instance matrices (`InstancedMesh.instanceMatrix.array`), particle attributes, ribbon vertices, mask pixels.
- **Events**: event payload objects are allowed (≤ 10 per frame) because they are small and short-lived; destruction effects read them synchronously and do not retain them.
- **Strings**: HUD text is produced only on the throttled UI path (≤ 20 Hz) and only when the value changed.
- **Closures**: no `array.forEach(cb)`/`map` in hot loops; plain `for` loops.

Heap ceiling: steady-state JS heap during `PLAYING` ≤ 150 MB; GPU memory ≤ 300 MB. Detached `ImageBitmap`s MUST be `close()`d by the worker after inference.

## Draw-call budget (≤ 120 per frame)

| Object | Draw calls | Notes |
| --- | --- | --- |
| Environment grid plane (shader) | 1 | — |
| Fog/void backdrop (skydome or clear colour) | 0–1 | prefer clear colour + fog |
| Side pylons (instanced) | 1 | ≤ 40 instances |
| Silhouette plane | 1 | custom shader, mask texture |
| Skeleton joints (instanced spheres) + bones (instanced capsules) | 2 | tier high/medium only |
| Blocks: glass shell (instanced) | 1 | `MAX_LIVE_NOTES` instances, per-instance colour + glow attribute |
| Blocks: core glyph quads (instanced, atlas) | 1 | — |
| Armour plates (instanced) | 1 | smash blocks only |
| Beam targets (instanced ring + core) | 2 | — |
| Obstacles (instanced boxes, translucent) | 1 | — |
| Sliced halves | ≤ 32 | one draw per half (unique geometry) — the only non-instanced objects; pooled geometries with fixed max vertex count, updated via `BufferAttribute.needsUpdate` |
| Fragments (instanced shard set) | 1 | `MAX_FRAGMENTS` instances across 14 shard geometries → use one merged shard geometry with per-instance shard index into a vertex-range table; or 14 instanced meshes (14 draws). Choose 14 draws (simpler) and budget them |
| Hand particles | 2 | one `Points` per hand |
| Blade ribbons | 2 | one ribbon mesh per hand |
| Beam ray | ≤ 2 | — |
| Poof sparks (instanced quads) | 1 | — |
| Judgement pops (instanced quads, atlas) | 1 | — |
| Post FX composer | 4–6 | bloom mips + combine; FXAA on medium+ |
| **Typical total** | **≈ 40–75** | hard cap 120 |

No shadows. No per-object transparency sorting beyond Three.js default (blocks render after opaque; `depthWrite = false` on glass and particles).

## Texture and geometry budget

| Asset | Size | Notes |
| --- | --- | --- |
| Mask `DataTexture` | 320×180, `RedFormat`, `UnsignedByteType` | Allocated once; updated with `texSubImage2D` via `texture.needsUpdate` on a fixed-size array (never re-created). Linear filtering, no mips. |
| Glyph atlas | 1024², RGBA, mipmapped | 3 glyphs + judgement text + ring sprites; one texture bound for glyphs and pops |
| Particle sprite | 128², R | — |
| Fractured block GLB | 14 shards, ≤ 2 000 triangles total | from Blender MCP ([18](18-blender-mcp-asset-pipeline.md)) |
| Glyph meshes (optional 3D glyphs) | ≤ 600 triangles each | only if the atlas quads look flat on the demo laptop |
| Environment pylon | ≤ 200 triangles | — |
| Fonts | 2 woff2 | DOM only |

Total GPU texture memory ≤ 24 MB; the bloom render targets dominate (half-res HDR mips ≈ 10 MB at 1080p).

## Post-processing cost

Composer (`postprocessing` library): one `RenderPass` + one `EffectPass` merging `BloomEffect`, `VignetteEffect`, `ChromaticAberrationEffect` (tier high), `FXAAEffect` (medium+). Measured targets on an Intel Iris Xe at 1920×1080:

| Effect | GPU ms |
| --- | --- |
| Scene render | 3–5 |
| Bloom at `BLOOM_RESOLUTION_SCALE = 0.5` (mipmap blur, 5 levels) | 1.5–2.5 |
| FXAA | 0.4 |
| Vignette + CA (merged) | 0.3 |
| **Total** | **≈ 5.5–8.5** |

Render targets use `HalfFloatType`. MSAA is off (bloom hides edges; FXAA on medium+). Rule: if GPU total > 9 ms, lower `renderer.setPixelRatio` before touching any effect.

## Quality tiers

Three presets. `render/quality.ts` exports `applyTier(tier)` which sets every value below in one place; nothing else reads `devicePixelRatio` directly.

| Setting | `high` | `medium` | `low` |
| --- | --- | --- | --- |
| Pixel ratio | `min(devicePixelRatio, 2)` | `min(devicePixelRatio, 1.25)` | 1.0 |
| Bloom resolution scale | 0.5 | 0.35 | 0.25, single mip level |
| Bloom intensity | 1.2 | 1.0 | 0.9 |
| Chromatic aberration | on (drops only) | off | off |
| FXAA | on | on | off |
| Trail particles per hand | 256 | 128 | 64 |
| Skeleton (joints + bones) | on | on | off |
| `MAX_FRAGMENTS` effective | 256 | 192 | 128 |
| Fragment lifetime | `FRAGMENT_LIFETIME_MS` | same | × 0.7 |
| Silhouette blur taps | 9 | 5 | 5 |
| Grid shader | anti-aliased lines + glow | anti-aliased | plain lines |
| Mask upload rate | every tracking frame | every tracking frame | every 2nd |

### Boot probe

Runs in `BOOT` after assets load, before the camera prompt, on the attract scene (grid, fog, silhouette plane with a procedural test mask, bloom on, `high` tier):

```
render 10 warm-up frames (discard)
record frameTime for 30 frames via requestAnimationFrame deltas
median = sort(frameTimes)[15]
tier = median ≤ 10 ms ? 'high' : median ≤ 14 ms ? 'medium' : 'low'
```

The result is stored in `localStorage` (`ss:tier`) so later boots skip the probe unless `?probe=1`. A URL parameter `?tier=low|medium|high` forces a tier (for QA). Debug key `Q` cycles tiers in development builds.

### Runtime downgrade

During `PLAYING`, keep a 5-second rolling average FPS (`ss:fpsAvg5`). If it is `< FLOOR_FPS` for 3 consecutive seconds → step down one tier (apply at the next frame; pool sizes shrink by recycling, no allocation). **Never step up during `PLAYING`**; a step up is considered only on entering `SELECT` if the previous song's 95th percentile frame time was ≤ 11 ms for the whole song, and at most one tier per session. Tier changes are logged to the debug overlay and to `console.info` so QA can see them.

## Measurement tooling

- `performance.mark`/`measure` with the names in the budget table; `ss:frame` wraps the whole loop. A `PerfRing` (120-frame ring per measure) computes avg / p95 / max, displayed in the debug overlay (`D`).
- `renderer.info.render.calls`, `.triangles`, `renderer.info.memory.textures/geometries` shown every frame in the overlay (reset each frame).
- Debug overlay fields: FPS (instant, avg5), `ss:*` avg/p95, draw calls, triangles, tier, tracking Hz, worker `inferenceMs`, motion-to-photon estimate (`tInferDone − tCapture` + frame time), live notes / fragments / particles in use, JS heap (`performance.memory` when available).
- Chrome tracing checklist (do this once at H10 on the demo laptop): DevTools → Performance → record 20 s of `PLAYING` on the busiest section (a drop) → check: no task > 16 ms on main; GC pauses (yellow "Minor GC") < 2 ms and < 1 per second; "Image Decode"/"Texture upload" rows only at the mask upload cadence; worker thread shows ≤ 40 ms tasks; GPU track not saturated (gaps between frames). Export the trace to `docs/perf/trace-<date>.json` (gitignored) and note the numbers in `CHANGELOG.md`.
- `?stats=1` shows the overlay in production builds for judges who ask.

## Known hot spots and mitigations

| Hot spot | Mitigation |
| --- | --- |
| Mask upload | R8 `DataTexture` allocated once; worker posts a `Uint8Array` that is copied into the texture's backing array (or the texture's array *is* the transferred buffer, swapped each frame); `needsUpdate = true` → Three.js issues `texSubImage2D`. Never create a `CanvasTexture` from `ImageData`. |
| Mask readback in worker | `getAsUint8Array()` at 320×180 (57 KB) only; never full camera resolution. Flip horizontally in a tight loop into a preallocated buffer. |
| Bloom | Half-res or lower, 5 mips; skip CA/FXAA on lower tiers; `HalfFloatType` targets. |
| Shadows | None, anywhere. |
| Anti-aliasing | No MSAA; FXAA on medium+; bloom masks aliasing on glowing edges. |
| Sliced halves | Pre-allocated `BufferGeometry` with max 64 vertices per half; write positions/normals into existing arrays; `setDrawRange`. No `BufferGeometry` construction at hit time. |
| Fragments | 14 instanced meshes updated with closed-form ballistic positions; `instanceMatrix.needsUpdate` once per frame per mesh. |
| Particles | Single `Points` per hand with position/size/alpha attributes updated in a loop; `usage = DynamicDrawUsage`. |
| Trail ribbon | Fixed `TRAIL_HISTORY × 2` vertices; update positions only. |
| Silhouette shader | Blur taps capped per tier; `discard` for pixels below threshold to save blend bandwidth. |
| Text | DOM only; `will-change: transform` on animated HUD elements; no layout thrash (transform/opacity only). |
| React | Zustand selectors per HUD field; `ss:ui` updates ≤ 20 Hz; no state updates for unchanged values. |
| Audio analyser | `getByteFrequencyData` into a preallocated `Uint8Array` once per frame; band sums in a loop. |

## GC avoidance checklist

1. No object literals, arrays or arrow functions created inside `update(dt)` functions. Lint rule: `no-restricted-syntax` is too blunt; instead review `ss:*` functions during the H10 perf pass and use the DevTools allocation sampler for 10 s of `PLAYING` — the hot path MUST show zero allocations from `game/`, `gestures/`, `render/`.
2. `TrackingFrame` typed arrays are transferred back to the worker after consumption (two-slot ring), so neither side allocates.
3. Event payloads are the single sanctioned per-event allocation.
4. Text/number formatting only in `ss:ui`.

## Worker tips

- `ImageBitmap.close()` immediately after `detectForVideo` calls complete.
- Pass `{ canvas: new OffscreenCanvas(1, 1) }` to both task constructors so MediaPipe uses the worker's GPU context; create tasks once.
- Never structured-clone landmarks as arrays of objects; pack into `Float32Array` and transfer.
- Keep-latest: if a frame arrives while inference is running, replace the pending bitmap (closing the old one); never queue.
- Call `detectForVideo` with a strictly increasing timestamp (`tCapture` rounded to integer ms); MediaPipe throws on equal timestamps.

## Acceptance criteria (measured on the demo laptop, 1080p, quality tier as auto-selected)

- [ ] Average FPS ≥ 60 on the busiest 20 s of each bundled track at normal; 1 % low ≥ `FLOOR_FPS`.
- [ ] `ss:frame` p95 ≤ 14 ms; no more than 2 frames > 33 ms per minute.
- [ ] Tracking rate ≥ 24 Hz sustained with both hands and body in frame; worker `inferenceMs` p95 ≤ 40 ms.
- [ ] Draw calls ≤ 120 at any moment (overlay max).
- [ ] Zero allocations attributed to `game/`, `gestures/`, `render/` in a 10 s allocation sample during `PLAYING`.
- [ ] Runtime downgrade triggers correctly when forced (`?tier=high` on a machine that cannot hold it) and never steps up mid-song.
- [ ] Boot probe completes in < 1 s and the chosen tier is shown in the overlay.
