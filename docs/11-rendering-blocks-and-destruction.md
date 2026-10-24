# 11 — Rendering: Blocks & Destruction

Blocks are the targets; their destruction is the kinetic payoff. This document specifies the intact block look, the three destruction effects (slice, shatter, poof), the two failure looks (bad cut, miss), and obstacles. Everything here is driven by game events ([02 §events](02-architecture.md#game--renderer--ui-events)); the renderer never decides outcomes.

Owning files: `render/blocks.ts` (intact instancing), `render/slicer.ts` (plane cut), `render/shatter.ts`, `render/poof.ts`, `render/obstacles.ts`, shaders `block.vert.glsl`, `block.frag.glsl`, `fragment.vert.glsl`, `fragment.frag.glsl`, `obstacle.frag.glsl`.

Build the readable target, hit flash and procedural destruction in P1/P2 before the exact swing-plane cut in P3 ([roadmap](../ROADMAP.md)). Pools, draw counts and GPU costs below are design budgets, not measured results. A simpler effect that stays readable and within budget is an acceptable recorded quality fallback; a false claim of exact slicing is not.

## 1. Palette

| Thing | Colour | Notes |
| --- | --- | --- |
| Slash block | `#19F5FF` electric cyan | glyph: open palm |
| Smash block | `#FF2BD6` hot magenta | glyph: fist; armour plates |
| Beam target | `#FFC32B` solar gold | glyph: pointing finger; gold ring |
| Obstacle | `#FF1E3C` at 35 % alpha | hazard stripes |
| Cut cap / shard flash | white-hot `#FFFFFF` × intensity 2.5 | blooms |
| Bad-cut flash | `#FF1E3C` | 120 ms |

Colours are stored in linear space in `render/palette.ts` and shared with [12](12-rendering-hands-trails.md) and [13](13-rendering-environment-camera-postfx.md).

## 2. Intact blocks

### 2.1 Instancing and pools

- One `InstancedMesh(BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE), blockMat, MAX_LIVE_NOTES)` for all cubes of all three types. Type, colour, glyph and animation state are per-instance attributes, so **one draw call** covers every live block.
- A second `InstancedMesh` for armour plates (`armor.glb`, 4 plates merged into one geometry, `MAX_LIVE_NOTES` capacity) that is positioned only for `smash` notes; unused instances have scale 0.
- A third `InstancedMesh` for beam rings (`beam_ring.glb` torus), only for `beam` notes.
- A free-list pool maps `note.id → instanceIndex`. On `note:spawn` acquire; on destruction/despawn release and set the instance matrix scale to 0 (cheaper than resizing `count`, keeps indices stable).

Per-instance attributes (all `InstancedBufferAttribute`, updated only for the instances that changed, `setUsage(DynamicDrawUsage)`):

| Attribute | Type | Meaning |
| --- | --- | --- |
| `iColor` | vec3 | linear palette colour |
| `iGlyph` | float | 0 palm, 1 fist, 2 finger → atlas column |
| `iState` | vec4 | `(spawnFade 0..1, hitZoneGlow 0..1, dim 0..1, flash 0..1)` |
| `iStrength` | float | `note.strength` |

### 2.2 Material: custom glass `ShaderMaterial`

Transmission materials require an additional scene capture and must earn their cost in a measured comparison. The baseline uses three cheaper terms:

```glsl
// block.frag.glsl (core)
in vec3 vNormalW; in vec3 vViewDirW; in vec2 vUv; in vec3 vLocal;
in vec3 vColor; in vec4 vState; in float vGlyph; in float vStrength;
uniform sampler2D uGlyphAtlas;   // 3 glyphs side by side, 256 px each, white on transparent
uniform float uTime;

void main() {
  vec3 n = normalize(vNormalW), v = normalize(vViewDirW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.2);            // rim
  // 1) translucent fill: dark tinted glass
  vec3 fill = vColor * 0.10 + vec3(0.02, 0.025, 0.04);
  float fillA = 0.45;
  // 2) fresnel rim in the block colour, emissive so it blooms a little
  vec3 rim = vColor * fres * (1.4 + 0.6 * vStrength + vState.y * 1.2);
  // 3) inner core glyph: sample the atlas on the face facing the player (+z local) and on ±x faces, faded on others
  vec2 guv = vec2((vUv.x + vGlyph) / 3.0, vUv.y);
  float glyph = texture(uGlyphAtlas, guv).a;
  float facing = smoothstep(0.3, 0.9, abs(n.z));              // front/back faces carry the glyph strongest
  vec3 core = vColor * glyph * facing * (2.2 + 0.8 * vStrength + 0.6 * vState.y) * (0.9 + 0.1 * sin(uTime * 6.0));
  // soft inner glow around the glyph (the "core" reads as a light source inside)
  float d = length(vLocal.xy) / BLOCK_HALF;                   // 0 centre .. 1 face-edge midpoint
  core += vColor * (1.0 - smoothstep(0.1, 0.7, d)) * 0.35 * facing;
  // edge lines: thin bright lines along the cube edges
  vec3 e = abs(vLocal) / BLOCK_HALF;                           // 0..1
  vec3 faceDist = 1.0 - e;
  // Two coordinates must be close to a box boundary; the smallest is zero
  // everywhere on a face and cannot distinguish an edge from its centre.
  float secondSmallest = max(min(faceDist.x, faceDist.y), min(max(faceDist.x, faceDist.y), faceDist.z));
  float edge = 1.0 - smoothstep(0.0, 0.06, secondSmallest);
  edge = clamp(edge, 0.0, 1.0);
  vec3 edgeCol = vColor * edge * 1.1;

  vec3 rgb = fill * fillA + rim + core + edgeCol;
  rgb = mix(rgb, rgb * 0.25, vState.z);                        // dim (miss)
  rgb = mix(rgb, vec3(1.0, 0.12, 0.24) * 2.0, vState.w);       // red flash (bad cut)
  float a = clamp(fillA + fres + glyph * facing + edge, 0.0, 1.0) * vState.x;
  gl_FragColor = vec4(rgb * vState.x, a);
}
```

`BLOCK_HALF` is a shader define injected as `BLOCK_SIZE / 2`. The vertex shader applies the instance matrix, writes `vLocal = position` (local space), and the per-instance attributes. These are shader excerpts, not standalone compilable files; include complete fog varyings and declarations in both stages. Baseline material: `transparent: true`, `depthWrite: true`, `side: FrontSide`, premultiplied-style blending as in [10 §3.6](10-rendering-silhouette.md#36-halo-and-composition). Instanced transparent cubes are not individually sorted by Three.js, so this is stylised glass rather than physically correct transmission. Test overlapping notes and the silhouette at every tier; prefer an opaque tinted shell/glyph if sorting compromises the required gesture.

The glyph atlas is a 768×256 RGBA texture generated at boot by drawing three SVG paths (palm, fist, pointing finger) to a canvas; the GLB glyph meshes from [18](18-blender-mcp-asset-pipeline.md) are an alternative for the Results podium, not for in-lane blocks (an extra draw call per block type is not worth it).

### 2.3 Animation states

| State | Driver | Visual |
| --- | --- | --- |
| Spawn fade-in | `spawnFade = smoothstep(0, 1, progressSinceSpawn / 0.25)` over the first 250 ms | alpha and emissive ramp up; scale from 0.6 → 1 |
| Approach | fog + size | nothing extra; the lane and fog do the work |
| Hit-zone glow | `hitZoneGlow = 1 − clamp(|timingError| / WINDOW_GOOD_MS, 0, 1)` | rim + core brighten as the block enters the window — the "hit now" cue |
| Rotation | slow decorative yaw for slash; none for smash (armour reads as heavy); beam ornament may rotate around the fixed aim centre | Keep the required glyph legible and the visual target centred on its authoritative collision/aim position. |
| Scale | collision-sized outer shell | Keep the gameplay silhouette at `BLOCK_SIZE`; strength may change the inner glyph, emissive pulse and decorative halo, never imply a larger hit volume. |

Instance matrices are rebuilt only for live instances each frame (≤ `MAX_LIVE_NOTES` `compose()` calls). Profile CPU update cost; reuse scratch transforms and attribute buffers.

### 2.4 Armour plates (smash)

Four bevelled plates (from `armor.glb`, merged) sit 0.02 m proud of the ±x and ±y faces. Material: dark metallic (`MeshStandardMaterial`, metalness 0.9, roughness 0.35, colour `#2A2238`) with magenta emissive edges via an `onBeforeCompile` injection of the same edge-line term. They do not spin. On shatter they fly off as four extra fragments (see §4).

### 2.5 Beam rings

A torus (`beam_ring.glb`, major 0.42 m, minor 0.03 m) surrounds the fixed beam target at `BEAM_HOVER_Z`, with a smaller counter-rotating ornament. Its required glyph and aim centre stay steady; Calm removes ring rotation. Use [07](07-hit-detection-and-scoring.md)'s baseline-camera projection of that world centre onto the play plane for a target reticle and candidate check against the measured fingertip position. `pointDir` shapes the decorative hand cone but does not choose a hit target. Optional aim assistance must reuse the authoritative eligibility/radius rule, not a separate raycast that promises a different target.

## 3. Slice (slash blocks)

The signature effect: the cube is cut along the exact plane of the swing. Triggered by `note:hit` with `note.type === 'slash'`; the payload's `cutPlane` (point = `impactPos`, normal = `normalize(cross(impactVel, lane d))` — computed by `game/hit.ts`, see [07](07-hit-detection-and-scoring.md)) is expressed in the block's local frame by the renderer.

### 3.1 Convex plane-cut algorithm (`render/slicer.ts`)

Input: plane `(n, d)` in block-local space (`n` unit, plane `n·p = d`, |d| < `BLOCK_HALF·√3`), the unit cube's 6 quads (each 4 vertices CCW with outward normal and UVs). Output: two `BufferGeometry` halves `A` (`n·p ≥ d`) and `B` (`n·p < d`).

1. For each of the 6 face quads, run **Sutherland–Hodgman** against the plane twice: once keeping the positive side (into `A`), once the negative side (into `B`). For each edge `(p_i, p_j)` with signed distances `s_i = n·p_i − d`, `s_j`:
   - if `s_i ≥ 0` emit `p_i` (for `A`);
   - if `sign(s_i) ≠ sign(s_j)` emit the intersection `p_i + (p_j − p_i) · s_i / (s_i − s_j)`, interpolating UVs the same way; record this point in `capPoints`.
   - Treat `|s| < 1e-6` as on-plane: emit the vertex to both sides and to `capPoints`.
2. Each clipped polygon (3–5 vertices) is triangulated as a fan from its first vertex, keeping the original face normal and UVs. A polygon with < 3 vertices is dropped.
3. **Cap polygon.** Deduplicate `capPoints` (distance < 1e-5). Compute their centroid `c`. Build an orthonormal basis `(t, b)` on the plane (`t = normalize(any axis not parallel to n) × n`, `b = n × t`). Sort points by `atan2((p−c)·b, (p−c)·t)`. Because the cube is convex, the sorted points form a convex polygon (3–6 vertices).
4. Triangulate the cap as a fan from `c` (adding `c` as a vertex gives a nicer UV centre). For `A` the cap normal is `−n` (facing into the removed half), for `B` it is `+n`. Cap UVs: `(0.5 + (p−c)·t / BLOCK_SIZE, 0.5 + (p−c)·b / BLOCK_SIZE)`. Cap vertices carry attribute `aCap = 1`; body vertices `aCap = 0`.
5. Write non-indexed `position`, `normal`, `uv`, `aCap` arrays into two pre-allocated `BufferGeometry` objects from the slice pool (capacity: 6 faces × 5 verts max → 3 tris × 3 verts = ≤ 90 body verts + ≤ 18 cap verts; allocate 128 vertices each). Set `drawRange` to the actual count.
6. Compute each half's centroid (average of its face-polygon centroids weighted by area, or simply the signed-volume centroid via the divergence theorem — the unit test needs volumes anyway, see §9) and store it; the half's mesh pivot is moved to that centroid so rotation looks natural.

Transform the plane with the inverse-transpose rule for normals, including the block's visual rotation and scale; transforming only its point gives a visibly wrong cut. Reject a zero or non-finite normal before normalisation. Degenerate planes (plane misses the cube, or is tangent and produces a zero-volume sliver) fall back to a centre cut with a valid normal. The small geometric tolerances above are numerical guards, not gameplay hit windows. Use the signed-volume centroid for pivots; an area-weighted surface centroid is not a volume centroid.

### 3.2 Half material

The body of each half reuses the block shader (same colour/glyph attributes, copied from the instance). The cap uses a second material via geometry groups, or more simply the same shader with the `aCap` attribute: `if (aCap > 0.5) rgb = vec3(1.0) * 2.5 * vColor_tinted; a = 1.0;` — a white-hot cross-section that blooms and cools to the block colour over 300 ms (`uCapHeat` uniform per half, decays on CPU).

### 3.3 Motion

Each half `h` with separation sign `s = ±1` (A gets `+n`, B gets `−n`):

```
v0    = impactVel · 0.35 + n · s · 1.2 + (0, 0.6, 0)          // m/s; a little upward lift so halves arc
ω     = (2 + 3·rand()) rad/s about axis normalize(n · 0.7 + randomUnit() · 0.3) · s
p(t)  = p0 + v0 · t + ½ · g · t²,  g = (0, −9.8, 0)
R(t)  = R0 · axisAngle(axis, |ω| · t)
alpha = 1 − smoothstep(0.6, 1.0, t / HALF_LIFETIME_MS)       // fade in the last 40 %
```

`p0` = the half's centroid in world at the moment of the hit, `t` = seconds since the hit. Closed-form, so pausing is exact and no integration state exists. Halves also inherit the lane velocity component `d · speed × 0.15` so they keep drifting toward the player briefly, then fall below the grid (y < −1 → release early).

Slice pool: 12 halves (6 simultaneous slices); the oldest is recycled if exhausted.

### 3.4 Fallback (if the exact slicer fails the P3 correctness gate)

Pre-cut halves at 4 canonical angles (vertical, horizontal, two diagonals) built once at boot from independent hand-made geometry; pick the one whose normal is closest to `cutPlane.normal`. Everything else in §3.3 is unchanged. Do not generate the fallback through a slicer that has failed correctness tests. Label this mode canonical-cut in benchmark metadata and the demo capability record; reserve “exact swing-plane cut” for the tested runtime slicer.

## 4. Shatter (smash blocks)

Triggered by `note:hit` with `note.type === 'smash'`.

### 4.1 Asset

`block_fractured.glb` ([18](18-blender-mcp-asset-pipeline.md)) contains 14 shards `shard_00..shard_13` of a 1 m cube, each with its origin at its centroid. At boot load once, retain each centroid offset `o_i`, and merge centroid-local shard geometry with a per-vertex `aShard` id. Apply `BLOCK_SIZE` exactly once to vertices and offsets. The initial implementation uses one pooled `Mesh` per active shatter, one merged geometry and one owned `uShard[14]` transform array per pool slot: one draw call per active shatter. Check the device's vertex-uniform limit before choosing this path; if unavailable, use an atlas of transforms or the simpler eight-piece fallback, not shader compile failure during play. Shared shader programs are fine; uniforms must not leak from one shatter to another.

`SHATTER_POOL` bounds allocated slots, while `MAX_FRAGMENTS` bounds active individual pieces including armour. A full shatter reserves 18 pieces (14 body + 4 armour), so active shatters are at most `min(SHATTER_POOL, floor(MAX_FRAGMENTS / 18))`. On exhaustion recycle the oldest decorative effect deterministically; never drop a judgement or delay input. Measure the typical and saturation cases separately.

### 4.2 Shard motion

For shard `i` with cube-space centroid `o_i` and the impact point `q` (block-local):

```
radial = normalize(o_i − q + randomUnit() · 0.15)
speed  = 2 + 4 · rand()                               // 2–6 m/s burst
v0_i   = impactVel · 0.5 + radial · speed + randomUnit() · 0.5
ω_i    = (4 + 8 · rand()) rad/s about randomUnit()
p_i(t) = p0_i + v0_i · t + ½ g t²
s_i(t) = 1 − smoothstep(0.7, 1.0, t / FRAGMENT_LIFETIME_MS)   // shrink in the last 30 %
flash  = 1 − smoothstep(0, 80 ms, t)                           // white-hot for 80 ms
```

Shards farther from the impact point get slightly lower speed (`× (1 − 0.3 · |o_i − q| / BLOCK_SIZE)`) so the explosion visibly originates at the fist.

The four armour plates are added as 4 more "shards" (their own small pool) with `speed × 1.3` and heavier spin.

### 4.3 Material

`fragment.frag.glsl`: block fill + rim as in §2.2, plus `rgb = mix(rgb, vec3(1.0) * 2.5, flash)` and emissive edges. Depth write on. A pooled additive sprite provides a brief magenta impact glow rather than a dynamic `PointLight`; its lifetime is expressed in milliseconds so it is independent of frame rate (see [12](12-rendering-hands-trails.md) for the sprite material). Calm mode uses a steady tint without a white flash.

### 4.4 Fallback

If the GLB is unavailable, build 8 procedural octants at boot from ordinary box geometry. The baseline slicer accepts a cube, not arbitrary recursively clipped polyhedra, so recursive fracture is not a valid fallback until that broader algorithm is implemented and tested. Optional irregular procedural pieces may be generated offline with a tested convex-polyhedron clipper. A missing Blender asset must never block play or depend on an unverified slicer.

## 5. Poof (beam targets)

Triggered exactly once by `note:hit` with `note.type === 'beam'`. `beam:fire` owns the ray visual only and may represent a whiff with `note === null`; it must never independently despawn a target or launch a second poof. The look is "the lights go out": the block stops being a light source, then collapses.

Timeline (`POOF_LIFETIME_MS` = 700):

| t | Effect |
| --- | --- |
| 0–150 ms | Emissive (rim, core, edges) eases monotonically to 0; fill goes to near-black glass; rings stop spinning and fade. Convey power loss with the collapsing ring, not rapid flashing. |
| 120 ms | Impact flash sprite at the target (gold, 0.7 m, 100 ms) and a thin expanding ring (torus scale 0.3 → 1.6 m, alpha 1 → 0 over 300 ms) |
| 150–700 ms | Scale → 0 with ease-in-cubic; 24 sparks (GPU `Points`, additive, gold → dim red, speed 1.5–3 m/s radial, gravity ×0.4, size 0.03 → 0) |
| 700 ms | Release |

Fragments or halves are **not** spawned; the whole point is the contrast with slice and shatter. SFX hook: `sfx.play('poof')` at t = 0 ([15](15-audio-playback-sync.md)).

## 6. Bad cut

`note:badcut`: the block is **not** destroyed visually. Over `BADCUT_MS` it deflects by `BADCUT_PUSHBACK_M` using a single smooth spring arc; the glyph and a brief red tint explain the required gesture. It then dims and continues to despawn. A bad cut is one terminal judgement: the renderer must not fabricate a later Miss or reset combo again. The game owns this lifecycle and emits the eventual despawn ([07](07-hit-detection-and-scoring.md)). A short clang SFX accompanies it; Calm mode removes wobble and camera shake.

## 7. Miss

`note:miss`: `iState.z` (dim) ramps 0 → 1 over 150 ms; rotation stops; the block continues along the lane to `DESPAWN_Z`, where the instance is released. No sound beyond the UI miss tick.

## 8. Obstacles (`render/obstacles.ts`)

### 8.1 Geometry

| Kind | x extent | y extent | z extent (depth) |
| --- | --- | --- | --- |
| `wallLeft` | `LANE_X[0] − BLOCK_SIZE/2 … LANE_X[1] + BLOCK_SIZE/2` (−2.1 … −0.3) | 0 … 3.0 | `durationMs/1000 × speed` where `speed = SPAWN_DISTANCE / approachMs × 1000` |
| `wallRight` | `LANE_X[2] − BLOCK_SIZE/2 … LANE_X[3] + BLOCK_SIZE/2` (0.3 … 2.1) | 0 … 3.0 | same |
| `bar` [STRETCH] | −2.1 … 2.1 | `LANE_Y[1] − BLOCK_SIZE/2 … 3.0` | same |

The obstacle's **leading face** reaches `z = 0` at `obstacle.t`; the slab extends behind it along `−d`. Use a unit `BoxGeometry` with a pivot at the leading face centre, scaled per obstacle; an `InstancedMesh` of 8 is plenty.

### 8.2 Material

`obstacle.frag.glsl`: fill `#FF1E3C` at alpha 0.35 (`depthWrite: false`, `side: DoubleSide` so the player sees the inside when "in" it), scrolling diagonal hazard stripes (`stripe = step(0.5, fract((vLocal.x + vLocal.z) / 0.4 + uTime · 0.8))`, alpha +0.15 on stripes), glowing edge lines (same edge term as blocks, intensity 1.6, so edges bloom), fresnel rim, fog. An optional bevelled frame from `obstacle_frame.glb` [POLISH] is drawn with the same shader.

### 8.3 Feedback

- Approaching (leading face within 2 s): the lane guide lines under the covered columns turn red ([13 §grid](13-rendering-environment-camera-postfx.md)).
- `obstacle:hit`: the post-FX glitch (120 ms RGB split + scanline tear) and red vignette for 400 ms ([13 §Post FX](13-rendering-environment-camera-postfx.md)); the slab's alpha pulses to 0.6; combo-break SFX.
- `obstacle:dodged`: the slab's edges flash white for 80 ms as it passes and a `+50` pops on the HUD.

## 9. Tests

`tests/unit/slicer.test.ts`:

1. **Volume conservation.** For 200 random planes through the cube, `volume(A) + volume(B) = BLOCK_SIZE³` within 1e-6 (signed volume via Σ over triangles of `(a · (b × c)) / 6`).
2. **Closedness.** Weld vertex positions within the documented geometric tolerance before counting edges, because face normals and UV seams deliberately duplicate vertices in the non-indexed buffer. Every welded edge must occur exactly twice with opposite winding. Check cap normals and outward winding independently.
3. **Degenerate planes** (missing the cube) fall back to the centre cut and still conserve volume.
4. **Axis-aligned plane at d = 0** yields two `BLOCK_SIZE × BLOCK_SIZE × BLOCK_SIZE/2` boxes. Assert bounding boxes and volumes, not seam-dependent vertex counts. Include planes through an edge/vertex, nearly tangent planes and rotated blocks with fixed seeds.

`tests/unit/fragments.test.ts`: ballistic `p(t)` matches `p0 + v0 t + ½ g t²` to 1e-9; lifetime release occurs exactly at `FRAGMENT_LIFETIME_MS`.

## 10. Draw calls and pools

| Thing | Pool | Draw calls (typical / worst) |
| --- | --- | --- |
| Intact cubes | `MAX_LIVE_NOTES` | 1 / 1 |
| Armour plates | `MAX_LIVE_NOTES` | 1 / 1 |
| Beam rings | 8 | 1 / 1 |
| Sliced halves | 12 | 0–4 / 12 |
| Shatters | 18 meshes + 18 × 4 plates (instanced, 1 call) | 1–3 / 19 |
| Poof sparks | 6 `Points` | 0–1 / 6 |
| Flash sprites | 8 | 0–2 / 8 |
| Obstacles | 8 instanced | 1 / 1 |
| **Total** | | **~8 / 49** |

The total above is a draw-call estimate before culling and tier policy, not proof that this fits the whole-scene budget. Use [16 §Quality tiers](16-performance-budget.md#quality-tiers) for the effective fragment cap and lifetime; `MAX_FRAGMENTS` also caps the shatter/armour combination (§4.1). Quality tiers must preserve the intact object at the destruction boundary: low tier uses eight complete octants rather than dropping alternating shards and leaving holes, reduces active effects and poof sparks, and disables the aim-assist line. Reduce glow intensity rather than freezing a white flash. All tiers retain the same judgement events and target timing.

### Repeatable effects and lifetime

Derive effect randomness from the beatmap seed, note/obstacle ID and effect kind; never call unseeded `Math.random()` in play. Store each effect's start time in the session visual clock and evaluate the closed-form motion from that time. Pausing freezes effects and resuming does not advance their age by the paused duration. Replaying the same events at a fixed tier must choose the same variants, trajectories and pool eviction order. GPU screenshots may differ across drivers; event counts and CPU geometry invariants must not.

Allocate geometry, index/attribute buffers, shard uniforms, sprite textures and scratch vectors before play. Reset free lists on retry and unsubscribe event handlers once on teardown. Dispose owned resources when the renderer closes or replaces them; do not dispose shared geometry when returning one slot to its pool. Capture pool high-water marks, overflow/recycle counts, draw calls and p50/p95 GPU time for the same saturation replay under [16](16-performance-budget.md).

## 11. Acceptance criteria

- [ ] All intact blocks of all three types render in ≤ 3 draw calls regardless of count.
- [ ] A slash block cut by a vertical swing splits left/right; a horizontal swing splits top/bottom; a diagonal swing produces a visibly diagonal cut — the cap faces the player white-hot and cools to the block colour.
- [ ] High/medium smash effects show the complete 14-piece body plus armour; the declared low/procedural fallback shows eight complete pieces. Pieces tumble from the impact without unexplained holes or freezes.
- [ ] A beam target visibly powers down monotonically (lights out) before collapsing; it never breaks into pieces.
- [ ] A bad cut deflects/dims the block and counts exactly once; subsequent despawn produces no additional Miss judgement.
- [ ] Obstacles are clearly red and translucent; the player can see blocks through them; being inside one triggers the glitch within one frame of `obstacle:hit`.
- [ ] Slicer unit tests pass (volume conservation and manifold check on 200 random planes).
- [ ] Six simultaneous slices + three shatters + one poof stay within the renderer's GPU budget on the medium tier ([16](16-performance-budget.md)).
- [ ] A deliberately saturated pool recycles decorative effects deterministically without changing score, hit latency or live-note counts; all owned resources remain bounded across ten retries.

## Constants required

This is the rendering destruction sub-registry linked from [02](02-architecture.md#constants). Implemented values are exported from `app/src/core/constants.ts`; their existence is not GPU or human acceptance evidence.

| Name | Value | Meaning |
| --- | --- | --- |
| `SLICE_POOL` | 12 | Half geometries pooled |
| `SHATTER_POOL` | 18 | Simultaneous shatters |
| `POOF_POOL` / `POOF_SPARKS` | 6 / 24 | Whole beam effects / sparks per effect |
| `POOF_LIFETIME_MS` / `POOF_POWERDOWN_MS` | 700 / 150 ms | Inclusive release boundary / power loss |
| `POOF_FLASH_DELAY_MS` / `POOF_FLASH_MS` / `POOF_RING_MS` | 120 / 100 / 300 ms | Flash start / flash duration / ring duration |
| `POOF_FLASH_SIZE_M` | 0.7 m | Soft impact sprite size |
| `POOF_RING_START_M` / `POOF_RING_END_M` | 0.3 / 1.6 m | Expanding ring scale |
| `POOF_SPARK_SPEED_MIN` / `POOF_SPARK_SPEED_MAX` | 1.5 / 3 m/s | Seeded radial spark speed |
| `POOF_SPARK_SIZE_M` / `POOF_GRAVITY_SCALE` | 0.03 m / 0.4 | Initial point size / gravity fraction |
| `POOF_TARGET_SCALE` | 1.6 | Decorative distant beam target scale; aim radius is unchanged |
| `SLICE_SEPARATION_SPEED` | 1.2 m/s | Along the cut normal |
| `SLICE_INHERIT` / `SHATTER_INHERIT` | 0.35 / 0.5 | Fraction of `impactVel` inherited |
| `SHATTER_BURST_MIN` / `MAX` | 2 / 6 m/s | Radial burst |
| `BADCUT_PUSHBACK_M` / `BADCUT_MS` | 0.8 / 220 | Deflect |
| `MISS_DIM_MS` / `TERMINAL_DIM_FACTOR` | 150 ms / 0.25 | Terminal visual dim duration / remaining colour |
| `BADCUT_TINT` | `0xff1e3c` | Failure feedback red |
| `BEAM_ESCAPE_RISE_M` / `BEAM_ESCAPE_VISUAL_MS` | 3 m / 600 ms | Renderer-only upward escaped-beam motion / duration |
| `OBSTACLE_ALPHA` | 0.35 | |
| `SPAWN_FADE_MS` | 250 | |

## Current implementation evidence

The runtime uses complete eight-octant Blender-authored shatters plus armour and tested exact capped cuts. Beam hits use a separate six-slot whole-target power-down/collapse pool, a soft impact sprite, ring and 24 seeded GPU points per effect. Calm suppresses the flash and ring expansion. Each whole effect reserves all its sparks against `MAX_FRAGMENTS`; saturation recycles the oldest whole effect deterministically. `beam:fire` owns only the ray, and no beam hit creates cube debris. Automated lifetime/geometry assertions are separate from unmeasured GPU and visual acceptance gates above.

Terminal failure feedback re-evaluates the note's exact trajectory using its chart's `approachMs`; the renderer does not move scored samples or emit judgements. Bad cuts retain their glyph and receive one spring deflection, red tint then dim; Calm omits deflection. Miss dimming applies only while the target remains before `DESPAWN_Z`. With the documented Normal speed, capture-time miss finalization can occur after that visual plane, so an already-culled target does not reappear for a fabricated fade. Escaped beams follow the documented upward renderer-only escape, with a fixed-position fade in Calm.
