# 13 — Rendering: Environment, Camera & Post FX

The environment is a dark infinite void with a pulsing grid floor tilted along the lane; the camera is a rig that breathes, kicks and punches with the music; the post stack turns emissive colours into glow. Together they are the "kinetic energy" the brief asks for. Everything is driven by `BandEnergies`, `music:event`, `BodyState.leanX`, and game events — the environment never reads tracking data directly.

Owning files: `render/environment.ts` (grid, pylons, dust, horizon), `render/cameraRig.ts`, `render/postfx.ts`, `render/highlight.ts`, shaders `grid.frag.glsl`, `horizon.frag.glsl`, `glitch.frag.glsl`.

The signature is a readable silhouette and gesture payoff on a quiet stage. P3 adds music-driven spectacle after the P2 core gate; P4 proves what the demo laptop can sustain ([roadmap](../ROADMAP.md)). Every millisecond figure in this document is a provisional budget, not a benchmark result.

The menu uses that stage before a camera exists. Reserve the central person area and side controls from [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md): show the static illustrative person and **Set up camera** until actual camera setup and matching body calibration are complete. The explicit setup panel can show a labelled live mask/pose preview; no camera failure blocks the mouse/keyboard catalog. The decorative environment may still render, but must not imply input or sensor readiness.

## 1. The void

- `scene.background = new Color('#05060D')`; the composer's clear colour is the same.
- Fog: `scene.fog = new FogExp2('#05060D', FOG_DENSITY)`. Target: a note at `SPAWN_DISTANCE` (48 m from the hit plane, ≈ 52.6 m from the camera) is ~15 % visible → `exp(−d² · ρ²)` with `d = 52.6` and 0.15 → `ρ = sqrt(−ln 0.15) / 52.6 ≈ 0.0262`. Set `FOG_DENSITY = 0.026`. At the hit plane (4.6 m) visibility is 98.6 %; at `BEAM_HOVER_Z` (18.6 m) ≈ 79 %, so beam targets read as distant but clear.
- Colour management: use linear RGB for scene shading and data textures with `NoColorSpace`; convert palette colours once when building uniforms. Set renderer tone mapping to `NoToneMapping` when `ToneMappingEffect` owns the display transform. Bloom sees HDR linear values before tone mapping, and output conversion to sRGB happens exactly once. Verify with a grey ramp and known emissive patches so duplicated tone mapping/gamma cannot silently alter thresholds.

## 2. Infinite grid (`grid.frag.glsl`)

A single `PlaneGeometry(400, 400, 1, 1)` whose local +X is world +X and local +Y follows the lane direction `d` from [02](02-architecture.md#lane-geometry). Build its basis explicitly: `xAxis = (1,0,0)`, `yAxis = d`, `zAxis = cross(xAxis, yAxis)`; its centre lies at `-d * 150` from the floor origin. Local plane `y = 0` therefore passes through the hit-plane floor. Simply rotating an XY plane by the lane pitch would leave it almost vertical. This is one draw call.

```glsl
uniform float uTime;        // s
uniform float uScroll;      // metres scrolled along the lane = ∫ speed dt (CPU), see 2.1
uniform float uBeatPhase;   // 0..1 within the current beat from the beat grid
uniform float uBeatPulse;   // 1 on each beat, exp decay 120 ms
uniform float uKick, uDrop; // from music:event, decays as in [10]
uniform vec3  uLineCol;     // palette-dependent, base #1A2BFF
uniform vec4  uColumnRed;   // per-column red tint 0..1 (obstacle approaching)
in vec3 vWorld; in vec3 vLocal;

float gridLine(vec2 p, float cell, float thick) {
  vec2 g = abs(fract(p / cell - 0.5) - 0.5) / fwidth(p / cell);  // distance to nearest line in pixels
  float l = min(g.x, g.y);
  return 1.0 - smoothstep(thick, thick + 1.0, l);                 // anti-aliased
}
void main() {
  vec2 p = vec2(vLocal.x, vLocal.y + uScroll);                    // vLocal.y is the lane axis in plane space
  float minor = gridLine(p, 1.0, 0.6) * 0.35;
  float major = gridLine(p, 4.0, 1.0) * 1.0;
  // beat pulse: a bright band travels from the horizon toward the player every beat
  float band = exp(-abs(fract((p.y) / 16.0 - uBeatPhase)) * 24.0) * uBeatPulse;
  float lines = max(minor, major) * (0.7 + 0.5 * uBeatPulse) + band * 0.6;
  // lane guide lines under the 4 columns, fade in within 12 m of the hit plane
  float guide = 0.0; vec4 cols = vec4(-1.8, -0.6, 0.6, 1.8);
  for (int i = 0; i < 4; i++) {
    float gl = 1.0 - smoothstep(0.0, 0.025, abs(vLocal.x - cols[i]));
    float near = smoothstep(-12.0, -1.0, vWorld.z);
    guide += gl * near; lines += gl * near * 0.8;
    // Accumulate each guide's red-tinted colour separately in the full shader;
    // computing a local `gc` and discarding it would never display a warning.
  }
  // horizon fade: distance from camera (world z) → 0 alpha near the far edge
  float horizon = 1.0 - smoothstep(60.0, 160.0, -vWorld.z);
  vec3 col = uLineCol * (1.8 + 2.5 * uKick + 2.0 * uDrop) * lines;
  gl_FragColor = vec4(col * horizon, lines * horizon);
}
```

The constants `cols` MUST be injected from `LANE_X` as a `#define`, not hard-coded (the snippet shows values for readability). Material: additive, `depthWrite: false`, fog **off** (horizon fade replaces it so the grid can extend beyond the fog).

### 2.1 Scroll and pulse

- `uScroll += speed · dt` where `speed = SPAWN_DISTANCE / approachMs × 1000` of the current difficulty — the floor moves at exactly the notes' speed so blocks appear to ride the grid. In `SELECT`/`RESULTS` scroll at 6 m/s.
- Drive `uBeatPhase` and beat increments from the authoritative beat grid in [09](09-beatmap-format.md), using the simple offset/BPM formula only for a uniform grid. An onset-fallback map must not display a supposedly detected pulse grid; use its validated onsets as impulses. `uBeatPulse` decays with elapsed visual time. In the attract scene a decorative virtual grid is allowed and is never presented as analysed song data.
- Grid pulses also fire from `music:event` `kick` (brighter lines) — the beat band and the kick flash are different cues and both are kept.

## 3. Pylons, dust, horizon glow

- **Pylons** (`pylon.glb`, [18](18-blender-mcp-asset-pipeline.md)): one `InstancedMesh`, with active count from [16 §Quality tiers](16-performance-budget.md#quality-tiers), split equally between `x = ±PYLON_X`. Space them by `PYLON_SPACING_M` along the lane; recycle beyond the camera using the active per-side count times spacing, rather than a wrap distance copied from a different preset. Positions advance by `speed · dt` like the grid. Material: `MeshStandardMaterial` dark (`#0D1020`) with an emissive strip (vertex colour mask from the GLB → `emissive = uLineCol × (1.2 + uBeatPulse)`), fogged. 1 draw call.
- **Dust**: one `Points` geometry sized for the maximum canonical preset, with draw range set to the active tier's count. Use a 12 × 8 × 60 m box ahead of the camera, drift toward the player at `speed × 0.3` with slow sine jitter, size 0.02–0.05 m, alpha 0.25, additive, colour = palette line colour. Wrap on z. 1 draw call. Gives parallax and sells speed.
- **Horizon glow**: a 60 × 14 m additive quad standing at `z = −140`, `y = 4` facing the camera with a radial gradient fragment shader (`horizon.frag.glsl`) in the current palette's accent colour, intensity 0.8 + 0.6 · `uBandLow`, +1.5 on drops decaying. It sits beyond the grid fade so the grid appears to dissolve into light. 1 draw call.

## 4. Palette states

The environment line colour and horizon accent follow the most recent section `music:event` (`calm`/`build`/`drop`) plus transient accents. `render/palette.ts` writes the palette into a retained output record; it must not allocate `{ line, accent, fogTint }` every frame. The scene consumes this record once per frame.

| State | `line` | `accent` (horizon) | Transition |
| --- | --- | --- | --- |
| calm | `#1A2BFF` blue | `#163A8A` deep blue | 1.5 s ease |
| build | ramps `#1A2BFF` → `#19F5FF` cyan over the build's duration (estimated from the next `drop` time if known, else 8 s) | `#0E7C8A` teal | continuous |
| drop | flash `#FF2BD6` magenta + `#FFC32B` gold for 0.9 s (lerp weight = `uDrop`), then settles to `#2A48FF` electric blue | `#7A1E6A` magenta-dark | flash then 2 s ease |
| obstacle active | `line` tinted toward `#FF1E3C` by 0.35 while any obstacle's leading face is within 2 s of the hit plane; `uColumnRed` set for covered columns | unchanged | 300 ms |

Fog colour stays `#05060D` in all states (tinting fog washes out bloom).

## 5. Camera rig (`render/cameraRig.ts`)

A `PerspectiveCamera(CAM_FOV_DEG, aspect, 0.1, 400)`. The rig owns the camera and writes `position`, `quaternion`, `fov` every frame from a sum of layers. Nothing else in the codebase touches the camera.

### 5.1 Base pose

`basePos = CAM_POS`, `baseLook = CAM_LOOK_AT`, `baseFov = CAM_FOV_DEG`. The silhouette plane projection uses these base values (not the rigged ones), see [10 §2](10-rendering-silhouette.md#2-plane-placement).

In `SELECT`, camera setup, `CALIBRATION` controls/countdown, PAUSED menu interaction and RESULTS, keep menu framing fixed while a hand target can be armed. Suppress camera breathing, shake, lean parallax and preview-triggered drop/FOV impulses there so a stable target does not drift under the pointer. Fit the placeholder/live-body composition to the reserved centre stage independently of gameplay collision geometry. Restore the documented game camera before pre-roll; the menu pointer uses 2D viewport coordinates rather than this camera projection. Background grid colour may respond to an explicitly started preview without moving the controls/person stage.

### 5.2 Trauma model

```ts
trauma = clamp(trauma − dt / TRAUMA_DECAY_S, 0, 1);      // linear decay, TRAUMA_DECAY_S = 0.6
shake  = trauma * trauma;                                 // perceptual curve
offset = vec3(noise1(t·12, 0), noise1(t·12, 7), noise1(t·12, 13)·0.5) * SHAKE_MAX_M * shake;   // SHAKE_MAX_M = 0.08
roll   = noise1(t·12, 21) * SHAKE_MAX_ROLL_DEG * shake;   // 1.5°
```

`noise1` is 1-D Perlin/simplex at ~12 Hz (smooth, not white noise — white noise reads as jitter). Trauma adds per event:

| Event | Trauma add | Notes |
| --- | --- | --- |
| `music:event kick` | `0.25 × intensity` | small response; with `shake = trauma²`, trauma 0.2–0.35 yields roughly 0.3–1 cm at the configured 8 cm cap |
| `music:event drop` | `0.7 × intensity` | plus the FOV punch and dolly below |
| `note:hit` | `0.12` (perfect `0.15`) | ≈ 1.5 cm micro-shake, 90 ms perceptible |
| `note:badcut` | `0.18` | |
| `obstacle:hit` | `0.5` | plus the glitch post effect |

### 5.3 Layers

| Layer | Formula | Cap |
| --- | --- | --- |
| (a) Idle breathing | `pos += (0, 0.02 · sin(2π · 0.2 · t), 0.01 · sin(2π · 0.13 · t))` | — |
| (b) Shake | `pos += offset`, `roll` about the view axis | `SHAKE_MAX_M` |
| (c) Drop | FOV: `55 → 62` over 80 ms (ease-out), back to 55 over 600 ms with one 3 % overshoot (damped spring ω = 14, ζ = 0.55); dolly: `pos.z −= 0.3` over 80 ms, return over 600 ms on the same spring | one drop at a time; a new drop restarts the spring from the current value |
| (d) Hit micro-shake | via trauma (above) | — |
| (e) Lean parallax | `pos.x += clamp(BodyState.leanX, −1, 1) · 0.15` with a 150 ms low-pass; `look.x += same × 0.5` | ±0.15 m |

Sum: `position = basePos + a + b + c_dolly + e`; `lookAt(baseLook + e_look)`; then apply `roll`; `fov = baseFov + c_fov`. **Frame-safety cap:** project all four play-plane corners and keep them inside a 2 % viewport margin at the current aspect ratio. Clamp every translating layer, including dolly and breathing, plus rotation/FOV if necessary; two heuristic iterations are not proof that the constraint holds. Fall back to the safe base pose if it fails. Preserve the calibrated input map: camera motion is visual only. Compare silhouette/cursor alignment at maximum translation and reduce that translation if parallax harms play.

### 5.4 Motion preference

Offer Standard and Calm intensity before Start and during Pause, initialised from `prefers-reduced-motion`. Calm disables camera translation/roll/FOV punches, lean parallax, chromatic separation, glitch tears and rapid emissive flashes. It keeps fixed camera framing, gesture cues, obstacle outlines and judgement feedback. This setting is independent of quality tier and must not alter collision, scoring, note timing or the audio clock. Any large-area flash in Standard must pass the flashing-content review in [17](17-testing-and-qa.md); the DOM alone is not the whole output.

### 5.5 Hit-stop (optional, [POLISH])

On a `perfect` judgement, the renderer's *visual* time for destruction fragments runs at 0.3× for 40 ms (fragments only — the song and spawner never slow down). Gives weight without touching gameplay timing.

## 6. Post FX (`render/postfx.ts`)

Library: `postprocessing` (pmndrs). Half-float render target (`HalfFloatType`) so HDR emissive values survive to bloom.

`tierPreset` below is the read-only preset selected from [16 §Quality tiers](16-performance-budget.md#quality-tiers); the snippet illustrates assembly rather than defining another preset.

```ts
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: BLOOM_THRESHOLD, luminanceSmoothing: 0.3, intensity: tierPreset.bloomIntensity, radius: 0.7, levels: tierPreset.bloomLevels });
const chroma = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
const vignette = new VignetteEffect({ darkness: 0.45, offset: 0.35 });
const glitch = new GlitchLiteEffect();           // custom Effect subclass, §6.3
const aa = tier === 'high' ? new SMAAEffect({ preset: SMAAPreset.MEDIUM })
  : tier === 'medium' ? new FXAAEffect() : null;
const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
// Start with the minimal stack; add independently validated optional passes later.
composer.addPass(new EffectPass(camera, bloom));
composer.addPass(new EffectPass(camera, vignette, tone));
if (aa) composer.addPass(new EffectPass(camera, aa));
// `chroma` and `glitch` above are candidates, not enabled in this baseline.
```

The code above is a candidate assembly sketch, not a guarantee that all effects can share one pass. [EffectPass](https://pmndrs.github.io/postprocessing/public/docs/class/src/passes/EffectPass.js~EffectPass.html) combines compatible effects; convolution effects and UV-transforming effects have ordering/resource constraints. Begin with render → bloom → tone mapping and AA, then add chroma/glitch only after validating the pinned library's pass-composition rules. Put a custom input-buffer-sampling glitch in its own pass with appropriate `EffectAttribute` declarations; do not let it sample a pre-bloom buffer while assuming post-bloom input. Keep tone mapping/output conversion single and after HDR effects. Measure the actual pass list, including bloom/SMAA internal passes, rather than claiming one fullscreen draw. `BLOOM_RESOLUTION_SCALE` is the baseline value; apply the active tier's resolution override through the pinned library's supported mipmap-resolution API.

### 6.1 Per-frame drivers

| Uniform | Driver |
| --- | --- |
| `bloom.intensity` | tier preset's base intensity plus bounded drop/kick accents; Calm suppresses transient accents |
| `bloom.luminanceThreshold` | `BLOOM_THRESHOLD`; changing the threshold changes appearance, not the resolution/pass cost. Use resolution and mip count to reduce work. |
| `chroma.offset` | `(CHROMA_DROP_OFFSET, CHROMA_DROP_OFFSET) · uDrop` only when the canonical tier enables this optional `[POLISH]` effect; Calm keeps it zero |
| `vignette.darkness` | `0.45 + 0.25 · obstacleHitFlash`; `vignette` colour tinted red via a custom uniform `uVignetteTint = mix(black, #FF1E3C, obstacleHitFlash)` (subclass `VignetteEffect` or add the tint in the glitch effect's fragment) |
| `glitch.strength` | 1 on `obstacle:hit`, linear → 0 over 120 ms |

`uDrop`, `uKick`, `obstacleHitFlash` are the same CPU-decayed scalars used by [10](10-rendering-silhouette.md) and §2, owned by a tiny `render/reactive.ts` that subscribes to `music:event` and game events once.

### 6.2 Selective bloom without a second pass

Everything that should glow is rendered with values above the luminance threshold (rim intensities 1.4–3, blade core 2.6, grid lines 1.8+); everything that should not (silhouette fill ≈ 0.08, obstacle fill, glass fill) stays below 0.6. There is no layer-based selective bloom pass. Verify with the debug "bloom mask" view (`D` then `B`): renders `luminance > threshold` as white.

### 6.3 `GlitchLiteEffect`

A ~40-line `Effect` subclass (`glitch.frag.glsl`):

```glsl
uniform float strength; uniform float time;
void mainUv(inout vec2 uv) {
  float band = step(0.85, fract(sin(floor(uv.y * 24.0) * 91.7 + time * 13.0) * 437.5));   // random scanline bands
  uv.x += band * strength * 0.03 * (fract(time * 7.0) - 0.5);                            // tear
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float s = strength * 0.006;
  float r = texture(inputBuffer, uv + vec2( s, 0.0)).r;
  float b = texture(inputBuffer, uv - vec2( s, 0.0)).b;
  outputColor = vec4(r, inputColor.g, b, inputColor.a);
}
```

Strength 0 makes the appearance a no-op, not its GPU work. Disable the dedicated pass when inactive if that preserves pipeline state without shader churn; verify the pinned library's effect attribute/input-buffer rules and clamp sampling at screen edges. Drive `time` from the session visual clock and fixed seed so replay is stable. Calm mode never enables this pass.

### 6.4 Render order and transparency

| `renderOrder` | Object | Blend |
| --- | --- | --- |
| −30 | horizon glow | additive |
| −20 | grid, pylons, dust | additive / opaque |
| −11 | skeleton | additive |
| −10 | silhouette plane | custom premultiplied |
| 0 | intact blocks, armour, rings (depth write on) | premultiplied |
| 5 | obstacles (double side, no depth write) | normal |
| 10 | sliced halves, shatter shards (depth write on) | premultiplied |
| 20 | hand particles, indicator rings, blade glow, beam, sparks | additive |
| 21 | blade core | normal, no depth write |
| 30 | flash sprites | additive |

`renderer.sortObjects = true` handles object-level transparent ordering; it cannot sort the instances inside one `InstancedMesh`. Explicit render order is a deliberate visual composition, not physically correct glass. Keep gameplay targets readable over the body and inspect close overlaps with hazards, ribbon and destruction. Additive objects never write depth.

### 6.5 Provisional GPU budgets (1080p reference, unmeasured)

| Pass | high | medium | low |
| --- | --- | --- | --- |
| Scene render | 4.5 ms | 3.5 ms | 2.5 ms |
| Bloom (canonical tier resolution/mips) | 2.0 ms | 1.6 ms | 1.1 ms |
| Merged effect pass (chroma + glitch + vignette + tone) | 0.6 ms | 0.5 ms | 0.4 ms |
| AA (SMAA / FXAA / none) | 1.1 ms | 0.5 ms | 0 |
| **Total GPU** | **8.2 ms** | **6.1 ms** | **4.0 ms** |

These are allocation estimates for design, not hardware results. Additional passes may change them; [16](16-performance-budget.md) owns subsystem planning/adaptation while [24](24-benchmark-and-evidence.md#6-initial-acceptance-targets) owns release thresholds. In P4 export measured p50/p95 GPU samples when timer queries are available, frame intervals, pass count, drawing-buffer size, fixed tier, motion setting and workload seed. If GPU timers are unavailable/disjoint, mark that column unavailable and retain CPU/frame evidence; never equate `requestAnimationFrame` duration with GPU time.

## 7. Quality tiers

Use the canonical [16 §Quality tiers](16-performance-budget.md#quality-tiers) preset for render scale, bloom, chroma eligibility, antialiasing, dust and pylons. Apply its effective pixel ratio to both renderer/composer targets and resize them together; the DOM HUD stays at native CSS resolution. Bloom resolution is relative to the resulting drawing buffer, not the unscaled physical display. Prewarm only supported variants and dispose replaced post-FX resources on deliberate tier changes; no shader compilation belongs in the contact path.

## 8. Highlight capture (`render/highlight.ts`)

On `highlight:capture { songTimeMs }`, store a snapshot owned by the highlight subsystem: copy the current real mask into a dedicated retained byte buffer and the 13 valid joint positions into retained arrays; record pose age, note/hand metadata and the event timestamp. A placeholder/setup guide can never be captured as a player's moment. A transport `MaskFrame` reference is not durable because its buffer can be recycled. Apply `HIGHLIGHT_MIN_COMBO` and `HIGHLIGHT_DEBOUNCE_MS` to capture work, and caption the timestamp actually captured; if throttling skips the absolute peak, say “highlight moment” rather than inventing an exact peak pose.

Render the mask/skeleton/hands to a `HIGHLIGHT_RT_SIZE` target only when capture work is budgeted. The mask is a flat image-derived plane: it does not become a volumetric person when viewed off-axis. Results may show a front-facing 2.5D memory with a small skeleton parallax/turntable, clearly described as a stylised replay. Calm mode presents a still. The render target stays inside the existing renderer, positioned via a viewport/scissor or composite quad; the React UI reserves its rectangle and never reads GPU pixels back into a second canvas every frame. If no valid snapshot exists, omit the viewport and keep the real result stats. Capture and teardown must leave the active camera/layers/clear state intact and release old GPU targets. Profile capture frames separately; no ≤1 ms result is assumed.

## 9. Acceptance criteria

- [ ] The grid floor is anti-aliased at all distances (no moiré at the horizon), scrolls at the notes' speed, and shows a visible bright band on every beat of the tracked grid.
- [ ] Notes at spawn are faint but visible (~15 %), fully clear at the hit plane.
- [ ] In Standard mode, kicks produce smooth camera accents and a drop produces the capped FOV/dolly response; blocks at the hit plane never leave the viewport. Calm keeps the camera fixed.
- [ ] Leaning left/right moves the camera subtly in the lean direction.
- [ ] Palette visibly changes between calm, build and drop sections of a test track with a clear drop.
- [ ] An obstacle hit shows an RGB-split tear and a red vignette for ~120–400 ms.
- [ ] Emissive surfaces bloom; the silhouette fill, glass fill and obstacle fill do not (bloom mask debug view).
- [ ] P4 evidence records actual GPU availability/timings, total pass count and frame percentiles for each tier; release passes the canonical thresholds in [24](24-benchmark-and-evidence.md#6-initial-acceptance-targets).
- [ ] The owned highlight snapshot survives tracking-buffer reuse and displays the pose at its recorded time; Results omits it if no valid moment was captured.
- [ ] Menus keep a stable central placeholder/live-body stage with reachable side controls; camera/preview music cannot move an armed target. No-camera/uncalibrated states show **Set up camera** and do not claim sensor readiness or produce a fake highlight.
- [ ] Calm mode removes camera/UV motion and flashes in both DOM and scene without changing replay score; ten retries/context-recovery cycles leave render-target, texture and listener counts bounded.

## Constants required

This is the environment/post-FX rendering sub-registry linked from [02](02-architecture.md#constants). Export these planned defaults centrally during P0; the runtime constants module is currently a stub.

| Name | Value | Meaning |
| --- | --- | --- |
| `FOG_DENSITY` | 0.026 | `FogExp2` density |
| `BG_COLOR` | `#05060D` | Background / fog colour |
| `GRID_LINE_COLOR` | `#1A2BFF` | Base grid colour |
| `TRAUMA_DECAY_S` | 0.6 | Linear trauma decay |
| `SHAKE_MAX_M` / `SHAKE_MAX_ROLL_DEG` | 0.08 / 1.5 | Shake caps at trauma 1 |
| `TRAUMA_KICK` / `TRAUMA_DROP` / `TRAUMA_HIT` / `TRAUMA_BADCUT` / `TRAUMA_OBSTACLE` | 0.25 / 0.7 / 0.12 / 0.18 / 0.5 | Trauma adds (× intensity for music events) |
| `DROP_FOV_PUNCH_DEG` / `DROP_DOLLY_M` | 7 / 0.3 | Drop camera layer |
| `LEAN_PARALLAX_M` | 0.15 | Camera parallax at leanX = ±1 |
| `BLOOM_THRESHOLD` / `BLOOM_INTENSITY` | 0.6 / 1.2 | Base bloom |
| `CHROMA_DROP_OFFSET` | 0.004 | Chromatic aberration at full drop |
| `GLITCH_MS` | 120 | Obstacle-hit glitch length |
| `PYLON_SPACING_M` / `PYLON_X` | 8 / 5.5 | Pylon layout |
| `HIGHLIGHT_RT_SIZE` / `HIGHLIGHT_DEBOUNCE_MS` | 768 / 2000 | Highlight capture |
