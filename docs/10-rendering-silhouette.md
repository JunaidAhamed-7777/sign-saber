# 10 — Rendering: Silhouette

The central person is the visual anchor: before camera setup/calibration it is a clearly illustrative placeholder; after successful setup it becomes the player's live neon reflection. The tracked silhouette is a dark translucent body with a glowing rim whose colour follows the music, drawn from the segmentation mask on a camera-aligned plane, with a 2.5D glowing skeleton behind it for depth. **No raw webcam pixels are drawn in the production scene or DOM.** The renderer receives only the single-channel `MaskFrame` and landmark arrays; the tracking worker may use camera textures internally for inference. The explicit developer diagnostic in [05](05-tracking-pipeline.md) is separate and opt-in. This is a rendering specification; all performance figures below are targets until measured under [16](16-performance-budget.md).

Owning files: `render/silhouette.ts` (plane, textures, material), `render/skeleton.ts` (joints and bones), `render/shaders/silhouette.vert.glsl`, `render/shaders/silhouette.frag.glsl`.

## 0. Placeholder, setup preview and live body

Follow [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md) and [04 — Camera setup](04-state-machine.md#camera-setup-within-select). In the browse menu, camera state `not-set-up`/`setting-up`/`error` or invalid calibration shows a static neutral human outline centred in the reserved person stage, with the clear action **Set up camera** and honest status beside it. Use lightweight app-owned vector/procedural geometry so a missing model, webcam or network cannot remove the onboarding figure. It is illustration, not a fake tracked person: no invented pose/mask, reactive hand motion, TRACKING OK indicator, replay badge, kinetic energy or tracking/latency samples.

During the explicit setup subflow, the same reserved stage may show the labelled **Live tracking preview** from actual mask/pose data plus a static target outline. The preview assists framing and comfortable calibration without claiming readiness. Only confirmed live camera/crop/player/mapping calibration lets the browse screen replace the placeholder with the live body. A stale stored calibration or the first frame alone is insufficient.

If a configured camera is temporarily occluded, hide stale body data and show a static framing guide with **Step into frame**; do not turn an ordinary occlusion into a new permission request. Permission revocation, camera-off or changed mapping invalidates calibration and restores **Set up camera**. A valid pose with a failed segmentation mask may use the labelled skeleton fallback; that fallback is actual input, unlike the placeholder.

Menus may fit the body/placeholder composition to their central stage while preserving its full intended outline; this is a presentation transform independent of the calibrated play plane. Restore the gameplay projection below before pre-roll/play. The [25](25-menu-and-hand-navigation.md) palm pointer maps directly to menu coordinates and must not be derived from a shaking camera or from this fitted body's screen projection.

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
2. On each accepted new mask under [16 §Quality tiers](16-performance-budget.md#quality-tiers): validate the dimensions and byte length, then copy into the *older* texture's preallocated backing array (`texture.image.data.set(mask.data)`; `texture.needsUpdate = true`). Keep `colorSpace = NoColorSpace`: mask confidence is data, not sRGB colour. Never construct a new texture or backing array for a tracking update. [Three.js DataTexture](https://threejs.org/docs/pages/DataTexture.html) documents the buffer-backed texture interface; the upload cost must be profiled on the pinned renderer and target GPU.
3. Record `maskSwapTime = performance.now()` and swap roles: the just-written texture becomes `uMaskCurr`, the other `uMaskPrev`. On the first valid mask or after a stream reset, seed both retained arrays with that mask so blending cannot reveal an uninitialised or previous-player image.
4. If no mask has arrived for > `TRACKING_LOST_PAUSE_MS`, set `uPresence` toward 0 over 400 ms so the silhouette dissolves instead of freezing.

This single bounded copy is intentional: it gives each texture stable storage while the tracking transport recycles transferred buffers. No canvas conversion, RGBA expansion, or camera-image readback is allowed here. Return transport buffers only after their consumers finish; never retain a transferred `MaskFrame` as a permanent highlight. A new segmentation mask may arrive less often than hand landmarks; update the texture only when the mask timestamp changes.

## 2. Plane placement

From [02 §Silhouette plane](02-architecture.md#silhouette-plane): the plane sits at `z = SILHOUETTE_Z` and is the perspective projection of the play plane from the camera's **default** position `CAM_POS` (not the shaken rig position, so camera shake moves the silhouette and the blocks together).

```ts
const k = (SILHOUETTE_Z - CAM_POS.z) / (0 - CAM_POS.z);           // 1.304 with defaults
const corner = (px: number, py: number) => CAM_POS.clone().add(new Vector3(px, py, 0).sub(CAM_POS).multiplyScalar(k));
// Plane corners: corner(±PLAY_W/2, PLAY_CENTER_Y ± PLAY_H/2); all four have z === SILHOUETTE_Z.
```

Build a `PlaneGeometry(1, 1)` and set `mesh.scale.set(PLAY_W * k, PLAY_H * k, 1)`, `mesh.position.copy(corner(0, PLAY_CENTER_Y))`. UV `(0,0)` is the bottom-left corner of the plane. With the base camera position, a point tracked at mirrored-image `(u′, v)` lands on the same screen ray on the play plane and silhouette plane. Camera translation introduces parallax between these planes; test baseline alignment with camera kinetics disabled and measure its error again at maximum enabled motion. Do not promise pixel alignment under arbitrary camera translation. The example above is initialization code; do not call its allocation-heavy `corner` helper every frame.

The plane is `renderOrder = -10`, `material.transparent = true`, `depthWrite = false`, `depthTest = true`. The body is a backdrop: gameplay targets and hazards remain readable over it. A transparent plane that does not write depth does not physically occlude distant notes. Keep this deliberate compositing order consistent with [13 §6.4](13-rendering-environment-camera-postfx.md#64-render-order-and-transparency); do not add an invisible depth-only body that hides incoming targets.

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

This derivative expression is a cheap starting approximation; it scales edge intensity and does not guarantee a six-pixel-wide contour. Measure the contour at each output scale and tune against reference screenshots. A robust contour may require mask-space dilation or additional samples; profile that alternative rather than adding a costly Sobel-of-blur path to the low tier. `uRimPx` starts from `SIL_RIM_PX`.

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
fillCol += rimCol * 0.10 * (1.0 - smoothstep(0.35, 0.65, m)) * body;
float fillA = uFillAlpha * body;
```

`vPlanePos` is the plane-local position in metres passed from the vertex shader (so the pattern does not swim when the plane scales with quality). Shader fragments are design excerpts: declare matching varyings, helpers and uniforms in the full shader; compute `rimCol` before using it. Convert CSS palette colours to linear RGB on the CPU; the example fill values are illustrative, not a substitute for colour conversion. Use increasing `smoothstep` edges throughout, because reversed edges have undefined results under [GLSL smoothstep](https://registry.khronos.org/OpenGL-Refpages/gl4/html/smoothstep.xhtml).

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

`uKick` is set to `intensity` of a `music:event` with `kind === 'kick'` and decays on the CPU using `KICK_DECAY_MS`; `uDrop` uses `DROP_DECAY_MS`. Use the same elapsed-time units and decay parameters across [13](13-rendering-environment-camera-postfx.md). The CPU also widens `uRimPx` by `+3 * uKick` so the rim visibly thickens on a kick. Calm mode suppresses the transient widening and white flash.

### 3.6 Halo and composition

A soft outer halo makes bloom read as an aura rather than a thin line:

```glsl
// Halo: band just OUTSIDE the body, from the blurred field's tail
float halo = (1.0 - smoothstep(0.05, 0.35, m)) * smoothstep(0.0, 0.05, m); // 0.05 < m < 0.35
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
3. The shader samples both and `mix`es (§3.2). This is a linear cross-fade, not motion interpolation. It introduces up to one mask interval of visual lag and may show double edges during fast motion. Compare it against the latest-mask path in the same replay; retain blending only where it improves appearance without harming hand/body alignment. Use frame reception time for this visual blend, and preserve capture time separately for latency metrics.
4. [STRETCH] Motion-compensated blend is a separate experiment after the P4 benchmark gate in [the roadmap](../ROADMAP.md). Hand velocity alone does not describe whole-body optical flow; it must not become a required dependency.

Cost: one extra texture fetch per tap (18 instead of 9); measure GPU cost instead of inferring milliseconds from fetch counts. Low tier sets `uMaskBlend = 1` and skips the previous fetch via a shader define.

## 5. The 2.5D skeleton (`render/skeleton.ts`)

Behind the plane, glowing joints and bones give the "3D" quality the flat mask lacks and keep the player readable when the mask is poor (backlight, dark clothes).

### 5.1 Joint set (13)

Retained rendered joints (9): nose 0, shoulders 11/12, elbows 13/14, wrists 15/16 and hips 23/24. Upper-body bones: 11–12, 11–13, 13–15, 12–14, 14–16, 11–23, 12–24, 23–24, with head-to-shoulder connections 0–11/0–12 in the simple fallback. Knees, ankles and feet are excluded. Masks end at the hip line; the illustrative placeholder also ends at the hips. The head is a larger sphere at the nose with radius 0.11 m.

### 5.2 Placement

For each joint `i` with mirrored-image `(u′, v)` and `worldLandmarks[i].z` (metres, hip-centred, negative = toward the camera):

```ts
P_play = (( u′ − 0.5) · PLAY_W,  PLAY_CENTER_Y + (0.5 − v) · PLAY_H, 0)
P_sil  = CAM_POS + (P_play − CAM_POS) · k                 // on the silhouette plane
P      = P_sil + (0, 0, min(0, SIL_SKELETON_Z_OFFSET − SIL_SKELETON_DEPTH_SCALE · worldZ_i))
```

MediaPipe world depth is negative toward the camera, while game-world +Z points toward it; negate that depth before applying the decorative scale. Clamp at the silhouette plane so the background skeleton cannot cover targets. This produces approximate parallax, not measured metric reconstruction. Visibility < 0.5 → joint and its bones fade out over 150 ms (per-instance alpha attribute).

Positions are One-Euro filtered **separately** from the game cursors (lower cutoff, `0.8 Hz`) because the skeleton is decorative and should look calm.

### 5.3 Geometry

- Joints: one `InstancedMesh(SphereGeometry(1, 12, 8), jointMat, 13)`, per-instance scale 0.035–0.05 m (head 0.11), per-instance colour attribute = current `rimCol` (CPU evaluates the same mixing formula once per frame and writes it into the uniform shared by all silhouette materials).
- Bones: one `InstancedMesh(CylinderGeometry(1, 1, 1, 8), boneMat, 12)`; per instance, position = midpoint, quaternion = `setFromUnitVectors(+Y, dir)`, scale `(0.018, len, 0.018)`. The unit-height cylinder spans exactly between joint centres; joint spheres conceal its end caps. A capsule's total height includes its hemispheres, so scaling a `CapsuleGeometry(1,1)` by `len/2` would not match the intended length.
- Material (both): `MeshBasicMaterial`-like `ShaderMaterial`, additive blending (`AdditiveBlending`), `depthWrite: false`, emissive intensity 1.3 so it blooms softly, a fresnel-ish falloff (`pow(1 − dot(n, v), 1.5)`) so spheres read as orbs, not discs.
- Hand glow spots: two `Sprite`s (soft radial texture, 0.28 m) at `HandCursor.pos` projected to the silhouette plane (same `k`), additive, colour = that hand's tint from [12](12-rendering-hands-trails.md), alpha pulsing with `speed`. These sit **behind** the hand particle systems and visually anchor the hands into the body.

### 5.4 Depth cue

Joint brightness `= 1.0 + clamp(−worldZ, 0, 0.6)`: limbs thrust toward the camera glow brighter. Bone thickness is constant.

Render order: skeleton `renderOrder = -11` (before the plane), plane `-10`. Because the plane's fill alpha is 0.78, the skeleton shows through as a dimmed glow inside the body and at full strength wherever the mask misses (e.g. an arm the segmenter lost). This is the "the mask dropped my arm but the game still sees me" safety net.

## 6. Attract-scene variant

For a genuinely tracked, validly calibrated body in `SELECT`/`RESULTS`, use the restrained attract treatment: `uFillAlpha = 0.55`, `uScanSpeed = 0.35`, `uRimPx = 4`, skeleton joint brightness ×0.6. Explicit track previews may drive its colour from actual band energies. A slow decorative colour LFO is allowed when no song plays; it never moves joints, creates masks or supplies presence. Calm keeps the body treatment steady.

The placeholder is a separate static illustration and does not run this live-body pipeline or pretend to react to a camera. Keep it in the same centre stage until setup completes. On RESULTS, an owned captured highlight ([13 §Highlight](13-rendering-environment-camera-postfx.md#8-highlight-capture-renderhighlightts)) is labelled as a saved moment and composed without obscuring the centre or controls; it is never a replacement for current tracking status.

## 7. Quality tiers

Use the canonical [16 §Quality tiers](16-performance-budget.md#quality-tiers) preset for mask taps/textures, blending, skeleton, halo, spots and upload cadence. Compile the no-previous-mask branch for the single-texture variant (`uMaskBlend = 1`); do not leave its previous-texture fetch active behind a uniform that merely hides the result. Retain allocated storage across tier changes and update the active shader/material only on a deliberate transition.

The plane renders at the tier's drawing-buffer resolution; the DOM stays at native CSS resolution. Its large screen coverage can make it fill-rate limited, so compare shader variants at identical viewports and mask inputs.

## 8. Performance notes

- Texture payload: `MASK_W × MASK_H` bytes per mask (57,600 bytes at 320×180). Count actual uploads and dropped masks. Do not create a new `DataTexture` per frame.
- No readback, no canvas 2D, no `ImageData` conversions on the main thread.
- The plane is a single draw call; skeleton 2 draw calls; hand spots 2. Total 5.
- Shader derivatives (`dFdx`) require WebGL2 or `OES_standard_derivatives`; WebGL2 is already a hard requirement.
- Avoid `discard` in the fragment shader (breaks early-z on some tile GPUs); use alpha = 0 instead.
- Provisional budget: ≤ 0.8 ms GPU for plane + skeleton + spots at the declared 1080p test configuration. Report measured p50/p95 and timer-query availability under [16](16-performance-budget.md); no result is recorded yet.

### Resource lifetime and repeatability

Allocate textures, mesh buffers, shader variants and joint scratch objects before play; the shell's placeholder resources are independent of lazy camera/model setup. Hide the live body when camera permission is revoked and restore the setup illustration/action; a decorative LFO must not fabricate a tracked player. Missing masks with valid pose show the explicit skeleton fallback. Dispose owned textures, geometries and materials on renderer shutdown/context recovery; changing tier reuses or disposes the old variant rather than leaking it. Replay uses fixture mask bytes, capture timestamps and a fixed song/visual clock so the same frame can be compared across tiers. The synthetic attract LFO and placeholder are decoration and must never be included as live tracking evidence.

## 9. Debug view (`D` key, dev builds)

- Toggle `uDebug = 1`: outputs `vec4(m, body, rim, 1)` so mask, threshold and rim are visible as R/G/B.
- Draws the raw landmark points as 4 px squares in a DOM canvas overlay for alignment checking against the hand cursors.
- Prints `maskIntervalMs`, `uMaskBlend`, and mask age in the debug HUD.

## 10. Acceptance criteria

- [ ] At no production state, tier or failure mode are raw camera pixels visible in the scene or DOM. Camera frames are used only for tracking; rendering receives mask/landmark data. Inspect all texture inputs, screenshots and the hidden video element; any developer raw-frame diagnostic is explicitly opted into and excluded from the shipped flow.
- [ ] With no permission, failed models or invalid calibration, a static illustrative person and **Set up camera** remain visible at the menu centre. A labelled real setup preview replaces the illustration only within setup; the browse view switches to a live figure only after confirmed matching calibration. No placeholder data enters tracking, scoring or benchmark samples.
- [ ] The rim colour visibly shifts between magenta, cyan and gold across a track with a strong bass/treble contrast, and flashes on kicks.
- [ ] With the debug overlay on, the mask edge at the wrist and the hand-cursor position coincide within 2 % of the frame width across the whole play plane (both corners and centre).
- [ ] Compare latest-mask and cross-fade variants on the same fast/slow-motion replay; record added mask age and choose the variant with acceptable lag and contour stability.
- [ ] Once mask age crosses `TRACKING_LOST_PAUSE_MS`, the silhouette dissolves over ≤ 400 ms; valid pose may continue as the skeleton fallback. Returning data fades it back without a stale-mask flash.
- [ ] Distant and near targets remain readable over the silhouette; no depth-only body hides incoming notes.
- [ ] Plane + skeleton + spots use ≤ 5 draw calls. Where valid GPU timer samples exist, compare them against the provisional 0.8 ms subsystem budget and investigate overruns; if unavailable, record that limitation. Full release timing gates come from [24](24-benchmark-and-evidence.md#6-initial-acceptance-targets), not an unmeasurable subsystem threshold.
- [ ] Capture rim screenshots at 720p/1080p and each render scale; the intended ~6 px reference contour remains legible without erasing fingers. Record any approximation limits.
- [ ] Ten scene/tier/retry cycles leave texture and geometry counts bounded after warm-up; the stored highlight survives tracking-buffer recycling.

## 11. Rigged avatar

**Status: implemented; browser-checked in the menu idle and the synthetic-performer trial; no live-webcam evidence.** The illustrative placeholder, setup preview, live body, dataset/synthetic trials, frozen pause and saved results now render a Blender-authored skinned upper-body person (`avatar.glb`, [18 §11](18-blender-mcp-asset-pipeline.md#11-rigged-avatar)) instead of the SVG outline and thin line skeleton. It has a head with brow, eyes, nose, mouth, jaw and ears, neck, torso ending at a closed hip finish, arms and five-digit hands. There are no legs anywhere. The line skeleton (§5) remains the fallback when the GLB fails or `AVATAR_TIER_FIGURE` requests it (low tier); the SVG remains the menu fallback.

Owning files: `render/avatarRetarget.ts` (pure retargeting, unit-tested), `render/avatar.ts` (loading, materials, placement, performer API) and the figure section of `render/renderer.ts`.

- **Retargeting.** Tracked landmarks become play-space joint targets: image x/y map onto the play plane exactly like cursors; depth uses world landmarks (`AVATAR_DEPTH_GAIN`, clamped) or, for 2D-only sources (COCO dataset, synthetic performer without body depth), forward foreshortening from the rig's own limb proportions. Each target is then moved along the camera ray through its play-plane point, so its screen position is unchanged. The solver computes torso (shoulder/hip lines + up), head (ears + nose), clavicle aim, two-bone arm IK with bounded stretch (`AVATAR_STRETCH_MAX`) and hinge/twist sharing, hand frames from 21-point hand landmarks (or pose index/pinky), and finger flexion/spread per joint from hand landmarks with anatomical limits (`AVATAR_LIMITS_DEG`). Missing joints hold for `AVATAR_HOLD_MS` and then ease toward a relaxed neutral pose; rotations are slerp-smoothed (`AVATAR_SMOOTH_MS`). Mirror mode maps the player's left landmarks onto the avatar's right side so the figure reads as a reflection.
- **Placement.** Scale comes from the 3D shoulder span (or torso length if larger) and is heavily smoothed; the root is placed so the avatar's shoulders coincide with the tracked shoulders. Hands therefore line up with the cursor mapping without the avatar changing any input coordinate.
- **Look.** A dark glassy body with a cyan→violet fresnel rim, a soft key light for form, glowing accent seams, an additive outline hull and subtle scanlines; music energy and kicks raise the rim/seam intensity (static in Calm). A `natural` skin/fabric PBR variant exists for virtual-camera rendering.
- **Compositing.** The avatar draws after arena-only objects and is followed by a depth-clear sentinel, so every gameplay target and effect draws over it, matching the backdrop rule in §2. When the avatar is shown, the mask silhouette and line skeleton are hidden.
- **States.** Menu placeholder: a gently breathing illustrative figure (static in Calm), captioned as illustrative and never fed into tracking. Setup preview, live play and trials: driven by their actual input. Paused: frozen pose. Results: the saved highlight pose.

## Constants required

Rendering defaults below form the silhouette sub-registry linked by [02](02-architecture.md#constants). Implemented defaults are exported centrally from `core/constants.ts`; exported values alone do not establish visual, live-camera or GPU acceptance. Shader literals are illustrative defaults, not permission to scatter tunables through runtime code.

| Name | Value | Meaning |
| --- | --- | --- |
| `SIL_RIM_PX` | 6 | Rim width in pixels at 1080p |
| `SIL_JOINT_RADIUS_M` / `SIL_HEAD_RADIUS_M` | 0.045 / 0.11 m | Upper-body joint spheres / actual-nose head marker radius |
| `SIL_FILL_ALPHA` | 0.78 | In-game fill alpha (attract 0.55) |
| `SIL_MASK_LOW` / `SIL_MASK_HIGH` | 0.35 / 0.65 | Soft threshold band |
| `SIL_SKELETON_Z_OFFSET` | −0.06 m | Skeleton depth behind the plane |
| `SIL_SKELETON_DEPTH_SCALE` | 0.5 | Multiplier on `worldLandmarks.z` |
| `KICK_DECAY_MS` / `DROP_DECAY_MS` | 180 / 900 | Uniform decay times |
