# 10 — Rendering: Silhouette

The silhouette is the first thing anyone sees and the thing judges remember. It is a Tron-style ghost of the player: a dark translucent body with a glowing rim whose colour follows the music, drawn from the segmentation mask on a camera-aligned plane, with a 2.5D glowing skeleton behind it for depth. **No raw webcam pixels are ever drawn.** The only camera-derived data that reaches the GPU is the single-channel `MaskFrame` and the landmark arrays.

Owning files: `render/silhouette.ts` (plane, textures, material), `render/skeleton.ts` (joints and bones), `render/shaders/silhouette.vert.glsl`, `render/shaders/silhouette.frag.glsl`.

Inputs (read every render frame, never mutated):

| Input | From | Rate |
| --- | --- | --- |
| `MaskFrame` (`MASK_W × MASK_H`, `Uint8Array`, mirrored) | `TrackingFrame.mask` | ≤ `TRACK_TARGET_HZ` |
| `PoseRaw.landmarks` / `worldLandmarks` | `TrackingFrame.pose` | ≤ `TRACK_TARGET_HZ` |
| `HandCursor[2].pos` | input pipeline | every frame |
| `BandEnergies` | `audio/analyser.ts` | every frame |
| `music:event` (`kick`, `drop`) | event bus | sporadic |

## 1. Mask upload: `MaskFrame` → `THREE.DataTexture`

1. Allocate **two** `DataTexture`s `maskA`, `maskB` of size `MASK_W × MASK_H`, format `RedFormat`, type `UnsignedByteType`, internal format `R8`. `minFilter = magFilter = LinearFilter`, `wrapS = wrapT = ClampToEdgeWrapping`, `generateMipmaps = false`, `flipY = false` (the worker already produces top-left origin; the shader flips `v` once, see §3.1). `unpackAlignment = 1` (width 320 is a multiple of 4 anyway, but set it so a future resolution change does not corrupt rows).
2. On each new `TrackingFrame` with `mask !== null`: write into the *older* of the two textures (`texture.image.data.set(mask.data)`; `texture.needsUpdate = true`). Three.js r15x+ uploads a `DataTexture` with `texSubImage2D` when the size is unchanged, so this is a ~0.1 ms upload at 320×180.
3. Record `maskSwapTime = performance.now()` and swap roles: the just-written texture becomes `uMaskCurr`, the other `uMaskPrev`.
4. If no mask has arrived for > `TRACKING_LOST_PAUSE_MS`, set `uPresence` toward 0 over 400 ms so the silhouette dissolves instead of freezing.

The main thread MUST NOT copy or convert the mask; the worker's `Uint8Array` is used as-is (it is transferred, so the renderer owns it until the next frame).

## 2. Plane placement

From [02 §Silhouette plane](02-architecture.md#silhouette-plane): the plane sits at `z = SILHOUETTE_Z` and is the perspective projection of the play plane from the camera's **default** position `CAM_POS` (not the shaken rig position, so camera shake moves the silhouette and the blocks together).

```ts
const k = (SILHOUETTE_Z - CAM_POS.z) / (0 - CAM_POS.z);           // 1.304 with defaults
const corner = (px: number, py: number) => CAM_POS.clone().add(new Vector3(px, py, 0).sub(CAM_POS).multiplyScalar(k));
// Plane corners: corner(±PLAY_W/2, PLAY_CENTER_Y ± PLAY_H/2); all four have z === SILHOUETTE_Z.
```

Build a `PlaneGeometry(1, 1)` and set `mesh.scale.set(PLAY_W * k, PLAY_H * k, 1)`, `mesh.position.copy(corner(0, PLAY_CENTER_Y))`. UV `(0,0)` is the bottom-left corner of the plane. Because the mapping is a pure projection, a point tracked at mirrored-image `(u′, v)` lands on the same screen pixel whether drawn on the play plane (hand cursors) or the silhouette plane (mask). This is the alignment guarantee tested in §10.

The plane is `renderOrder = -10`, `material.transparent = true`, `depthWrite = false`, `depthTest = true`. Blocks (z from −48 to +3.5) pass in front of it when their z > `SILHOUETTE_Z`; notes still far away (z < −1.4) are correctly occluded by the body, which reads as the player standing in the lane.

## 3. Fragment shader design

### 3.1 Uniforms

```glsl
uniform sampler2D uMaskCurr;    // newest mask
uniform sampler2D uMaskPrev;    // previous mask
uniform float uMaskBlend;       // 0..1, see §4 temporal smoothing
uniform vec2  uMaskTexel;       // (1/MASK_W, 1/MASK_H)
uniform vec2  uResolution;      // drawing buffer size in pixels
uniform float uTime;            // seconds
uniform float uBandLow, uBandMid, uBandHigh; // BandEnergies 0..1
uniform float uKick;            // 1 on a kick event, decays to 0 over 180 ms (CPU side)
uniform float uDrop;            // 1 on a drop, decays over 900 ms
uniform float uPresence;        // 1 = tracked, 0 = lost (CPU eased)
uniform vec3  uColLow, uColMid, uColHigh;    // #FF2BD6, #19F5FF, #FFC32B (linear space)
uniform float uFillAlpha;       // 0.78 in game, 0.55 in attract
uniform float uScanSpeed;       // 1.0 in game, 0.35 in attract
uniform float uRimPx;           // rim width in output pixels at 1080p; scaled by uResolution.y/1080
```

The mask is stored top-left origin while plane UVs are bottom-left; the shader samples `vec2(vUv.x, 1.0 - vUv.y)`. Mirroring is already applied by the worker; the shader does not flip `x`.

### 3.2 Mask smoothing (9-tap)

The 320×180 mask has staircase edges when stretched to ~1200 px tall. Blur in mask-texel space, then threshold, so the threshold acts on a smooth field:

```glsl
float sampleMask(vec2 uv) {
  return mix(texture(uMaskPrev, uv).r, texture(uMaskCurr, uv).r, uMaskBlend);
}
float blurredMask(vec2 uv) {
  // 3x3 tent, weights 1-2-1 / 16
  vec2 t = uMaskTexel;
  float m  = sampleMask(uv) * 4.0;
  m += (sampleMask(uv + vec2( t.x, 0.0)) + sampleMask(uv + vec2(-t.x, 0.0))
      + sampleMask(uv + vec2(0.0,  t.y)) + sampleMask(uv + vec2(0.0, -t.y))) * 2.0;
  m += sampleMask(uv + t) + sampleMask(uv - t)
     + sampleMask(uv + vec2(t.x, -t.y)) + sampleMask(uv + vec2(-t.x, t.y));
  return m / 16.0;
}
```

Low tier uses a 5-tap cross (centre ×4 + four neighbours ×2, / 12).

### 3.3 Soft threshold and edge detection

```glsl
float m      = blurredMask(uvMask);
float body   = smoothstep(0.35, 0.65, m);           // 0 outside, 1 inside, soft 0.3-wide band
// Gradient magnitude of the thresholded field via screen-space derivatives
float gx = dFdx(body), gy = dFdy(body);
float grad = length(vec2(gx, gy));                   // ~ change per pixel
// Rim band: want ~uRimPx pixels wide regardless of resolution
float rimPx = uRimPx * (uResolution.y / 1080.0);
float rim   = clamp(grad * rimPx, 0.0, 1.0);        // 1 at the edge, falls off within rimPx
rim *= smoothstep(0.02, 0.2, body) * smoothstep(0.02, 0.2, 1.0 - body); // only where the edge actually is
```

`dFdx/dFdy` cost nothing extra and automatically give a rim of constant screen width. `uRimPx = 6`. The alternative Sobel on the raw mask (3×3) is kept behind a `#define SOBEL_RIM` for the low tier where derivatives on a near-binary field can flicker: Sobel on `blurredMask` with the kernel in texel space, `rim = clamp(length(sobel) * 2.2, 0, 1)`.

### 3.4 Interior fill

```glsl
vec3  fillCol = vec3(0.043, 0.059, 0.102);           // #0B0F1A linear-ish
// vertical gradient: slightly lighter at the top (shoulders), darker toward the feet
fillCol *= mix(0.75, 1.25, vUv.y);
// animated scanlines: 1.5 px period at 1080p, drifting downward
float scan = 0.5 + 0.5 * sin((gl_FragCoord.y - uTime * 40.0 * uScanSpeed) * 3.14159 / 1.5);
fillCol += vec3(0.02, 0.05, 0.08) * scan;
// subtle hex/grid pattern in plane space, 0.06 m cells, 6 % strength
vec2 cell = fract(vPlanePos.xy / 0.06) - 0.5;
float gridLine = 1.0 - smoothstep(0.0, 0.08, min(abs(cell.x), abs(cell.y)));
fillCol += vec3(0.03, 0.08, 0.10) * gridLine * 0.6;
// faint inner glow of the rim colour, 10 % at the edge fading inward
fillCol += rimCol * 0.10 * smoothstep(0.65, 0.35, m) * body;
float fillA = uFillAlpha * body;
```

`vPlanePos` is the plane-local position in metres passed from the vertex shader (so the pattern does not swim when the plane scales with quality).

### 3.5 Rim colour from band energies

```glsl
// Weight the three palette colours by band energy; bias so a quiet song still has colour
float wL = 0.15 + uBandLow  * 1.0;
float wM = 0.25 + uBandMid  * 0.8;
float wH = 0.05 + uBandHigh * 1.2;
vec3 rimCol = (uColLow * wL + uColMid * wM + uColHigh * wH) / (wL + wM + wH);
// Kick pulse: flash toward white-magenta and widen the rim briefly
rimCol = mix(rimCol, vec3(1.0, 0.6, 0.95), uKick * 0.6);
// Drop: push toward solar gold for the first part of the decay
rimCol = mix(rimCol, uColHigh, uDrop * 0.5);
// Emissive intensity: must exceed the bloom luminance threshold (0.6, see [13]) on the rim only
float rimIntensity = 1.6 + uBandLow * 1.2 + uKick * 2.0 + uDrop * 1.5;
vec3  rimEmissive  = rimCol * rimIntensity * rim;
```

`uKick` is set to `intensity` of a `music:event` with `kind === 'kick'` and decays on the CPU (`uKick *= exp(-dt / 60ms)`). The CPU also widens `uRimPx` by `+3 * uKick` so the rim visibly thickens on every kick.

### 3.6 Halo and composition

A soft outer halo makes bloom read as an aura rather than a thin line:

```glsl
// Halo: band just OUTSIDE the body, from the blurred field's tail
float halo = smoothstep(0.35, 0.05, m) * smoothstep(0.0, 0.05, m);   // 0.05 < m < 0.35
vec3  haloCol = rimCol * 0.45 * halo * (0.6 + 0.4 * uBandMid);

vec3  rgb = fillCol * fillA + rimEmissive + haloCol;
float a   = max(fillA, max(rim, halo * 0.6)) * uPresence;
// Premultiplied-style output; blending set to CustomBlending (ONE, ONE_MINUS_SRC_ALPHA)
gl_FragColor = vec4(rgb * uPresence, a);
```

Material: `ShaderMaterial` with `transparent: true`, `depthWrite: false`, `blending: CustomBlending`, `blendSrc: OneFactor`, `blendDst: OneMinusSrcAlphaFactor`. Emissive rim values > 1 are preserved because the composer renders to a half-float target ([13](13-rendering-environment-camera-postfx.md)); the bloom pass picks up the rim and halo only, never the fill (fill luminance ≈ 0.08 < threshold 0.6).

### 3.7 Vertex shader

```glsl
out vec2 vUv;
out vec2 vPlanePos;      // metres, plane-local
uniform vec2 uPlaneSize; // (PLAY_W*k, PLAY_H*k)
void main() {
  vUv = uv;
  vPlanePos = (uv - 0.5) * uPlaneSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

## 4. Temporal smoothing

Tracking arrives at ≤ 30 Hz; rendering at 60. Without smoothing, the mask steps every other frame, which the eye reads as "laggy video". Fix:

1. Keep `uMaskPrev` / `uMaskCurr` (§1).
2. Each render frame: `uMaskBlend = clamp((performance.now() - maskSwapTime) / expectedMaskIntervalMs, 0, 1)` where `expectedMaskIntervalMs` is the exponential moving average of the last 8 inter-mask intervals (≈ 33 ms at 30 Hz, 42 ms at 24 Hz).
3. The shader samples both and `mix`es (§3.2). This is a linear cross-fade, not motion interpolation; fast arm sweeps show a faint double edge for one frame, which the rim glow hides. It is strictly better than stepping.
4. [POLISH] Motion-compensated blend: shift `uMaskPrev` sampling by the hand-cursor velocity near the hand positions. Not planned for the hackathon.

Cost: one extra texture fetch per tap (18 instead of 9 at 1080p ≈ 0.25 ms on Iris Xe). Low tier sets `uMaskBlend = 1` and skips the prev fetch via a `#define`.

## 5. The 2.5D skeleton (`render/skeleton.ts`)

Behind the plane, glowing joints and bones give the "3D" quality the flat mask lacks and keep the player readable when the mask is poor (backlight, dark clothes).

### 5.1 Joint set (13)

Pose landmark indices: nose 0, shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28. Bones (12): 11–12, 11–13, 13–15, 12–14, 14–16, 11–23, 12–24, 23–24, 23–25, 25–27, 24–26, 26–28. The head is a larger sphere at the nose with radius 0.11 m.

### 5.2 Placement

For each joint `i` with mirrored-image `(u′, v)` and `worldLandmarks[i].z` (metres, hip-centred, negative = toward the camera):

```ts
P_play = (( u′ − 0.5) · PLAY_W,  PLAY_CENTER_Y + (0.5 − v) · PLAY_H, 0)
P_sil  = CAM_POS + (P_play − CAM_POS) · k                 // on the silhouette plane
P      = P_sil + (0, 0, −0.06 + 0.5 · worldZ_i)           // just behind the plane, pushed by depth
```

The `−0.06 m` keeps every joint behind the plane so the fill tints it; the `0.5 · worldZ` term gives real parallax when the player twists (a forward punch pulls the wrist sphere toward the camera and it brightens, see 5.4). Visibility < 0.5 → joint and its bones fade out over 150 ms (per-instance alpha attribute).

Positions are One-Euro filtered **separately** from the game cursors (lower cutoff, `0.8 Hz`) because the skeleton is decorative and should look calm.

### 5.3 Geometry

- Joints: one `InstancedMesh(SphereGeometry(1, 12, 8), jointMat, 13)`, per-instance scale 0.035–0.05 m (head 0.11), per-instance colour attribute = current `rimCol` (CPU evaluates the same mixing formula once per frame and writes it into the uniform shared by all silhouette materials).
- Bones: one `InstancedMesh(CapsuleGeometry(1, 1, 4, 8), boneMat, 12)`; per instance, position = midpoint, quaternion = `setFromUnitVectors(+Y, dir)`, scale `(0.018, len/2, 0.018)`.
- Material (both): `MeshBasicMaterial`-like `ShaderMaterial`, additive blending (`AdditiveBlending`), `depthWrite: false`, emissive intensity 1.3 so it blooms softly, a fresnel-ish falloff (`pow(1 − dot(n, v), 1.5)`) so spheres read as orbs, not discs.
- Hand glow spots: two `Sprite`s (soft radial texture, 0.28 m) at `HandCursor.pos` projected to the silhouette plane (same `k`), additive, colour = that hand's tint from [12](12-rendering-hands-trails.md), alpha pulsing with `speed`. These sit **behind** the hand particle systems and visually anchor the hands into the body.

### 5.4 Depth cue

Joint brightness `= 1.0 + clamp(−worldZ, 0, 0.6)`: limbs thrust toward the camera glow brighter. Bone thickness is constant.

Render order: skeleton `renderOrder = -11` (before the plane), plane `-10`. Because the plane's fill alpha is 0.78, the skeleton shows through as a dimmed glow inside the body and at full strength wherever the mask misses (e.g. an arm the segmenter lost). This is the "the mask dropped my arm but the game still sees me" safety net.

## 6. Attract-scene variant

Used in `SELECT` and `RESULTS` background: `uFillAlpha = 0.55`, `uScanSpeed = 0.35`, `uRimPx = 4`, band uniforms driven by a slow synthetic LFO (`low = 0.3 + 0.2 sin(0.4t)`, etc.) when no song plays, skeleton joint brightness ×0.6. On `RESULTS`, the highlight capture ([13 §Highlight](13-rendering-environment-camera-postfx.md)) replaces the live silhouette on the right of the screen while the live one stays faint on the left.

## 7. Quality tiers

| Tier | Mask taps | Temporal blend | Skeleton | Halo | Hand spots |
| --- | --- | --- | --- | --- | --- |
| high | 9 × 2 textures | yes | joints + bones | yes | yes |
| medium | 9 × 2 | yes | joints + bones | yes | yes |
| low | 5 × 1 | no (`uMaskBlend = 1`) | joints only | no | yes |

The plane always renders at full output resolution: it covers ~60 % of the screen and is the cheapest large thing on screen (≤ 18 texture fetches + ~40 ALU per fragment).

## 8. Performance notes

- Texture upload: 57.6 KB per mask, ≤ 30 times/s → negligible. Do not create a new `DataTexture` per frame.
- No readback, no canvas 2D, no `ImageData` conversions on the main thread.
- The plane is a single draw call; skeleton 2 draw calls; hand spots 2. Total 5.
- Shader derivatives (`dFdx`) require WebGL2 or `OES_standard_derivatives`; WebGL2 is already a hard requirement.
- Avoid `discard` in the fragment shader (breaks early-z on some tile GPUs); use alpha = 0 instead.
- Measured target: ≤ 0.6 ms GPU at 1080p on Iris Xe for plane + skeleton.

## 9. Debug view (`D` key, dev builds)

- Toggle `uDebug = 1`: outputs `vec4(m, body, rim, 1)` so mask, threshold and rim are visible as R/G/B.
- Draws the raw landmark points as 4 px squares in a DOM canvas overlay for alignment checking against the hand cursors.
- Prints `maskIntervalMs`, `uMaskBlend`, and mask age in the debug HUD.

## 10. Acceptance criteria

- [ ] At no state, tier, or failure mode is any colour from the webcam frame visible. The GPU receives only `MaskFrame` and landmark arrays (verifiable: the `<video>` element has `display: none` and no `drawImage` of it exists outside the worker frame producer).
- [ ] The rim colour visibly shifts between magenta, cyan and gold across a track with a strong bass/treble contrast, and flashes on kicks.
- [ ] With the debug overlay on, the mask edge at the wrist and the hand-cursor position coincide within 2 % of the frame width across the whole play plane (both corners and centre).
- [ ] No visible 30 Hz stepping of the silhouette at 60 FPS render (temporal blend on, medium tier or above).
- [ ] Losing tracking dissolves the silhouette in ≤ 400 ms; regaining it fades it back.
- [ ] Blocks that have passed `SILHOUETTE_Z` render in front of the body; blocks still far away are occluded by it.
- [ ] Plane + skeleton + spots ≤ 5 draw calls and ≤ 0.8 ms GPU on the demo laptop.
- [ ] Rim stays ~6 px wide at 1080p and ~4 px at 720p (constant screen width).

## Constants required

Proposed additions to the [constants table](02-architecture.md#constants) (rendering section):

| Name | Value | Meaning |
| --- | --- | --- |
| `SIL_RIM_PX` | 6 | Rim width in pixels at 1080p |
| `SIL_FILL_ALPHA` | 0.78 | In-game fill alpha (attract 0.55) |
| `SIL_MASK_LOW` / `SIL_MASK_HIGH` | 0.35 / 0.65 | Soft threshold band |
| `SIL_SKELETON_Z_OFFSET` | −0.06 m | Skeleton depth behind the plane |
| `SIL_SKELETON_DEPTH_SCALE` | 0.5 | Multiplier on `worldLandmarks.z` |
| `KICK_DECAY_MS` / `DROP_DECAY_MS` | 180 / 900 | Uniform decay times |
