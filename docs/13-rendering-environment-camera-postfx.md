# 13 — Rendering: Environment, Camera & Post FX

The environment is a dark infinite void with a pulsing grid floor tilted along the lane; the camera is a rig that breathes, kicks and punches with the music; the post stack turns emissive colours into glow. Together they are the "kinetic energy" the brief asks for. Everything is driven by `BandEnergies`, `music:event`, `BodyState.leanX`, and game events — the environment never reads tracking data directly.

Owning files: `render/environment.ts` (grid, pylons, dust, horizon), `render/cameraRig.ts`, `render/postfx.ts`, `render/highlight.ts`, shaders `grid.frag.glsl`, `horizon.frag.glsl`, `glitch.frag.glsl`.

## 1. The void

- `scene.background = new Color('#05060D')`; the composer's clear colour is the same.
- Fog: `scene.fog = new FogExp2('#05060D', FOG_DENSITY)`. Target: a note at `SPAWN_DISTANCE` (48 m from the hit plane, ≈ 52.6 m from the camera) is ~15 % visible → `exp(−d² · ρ²)` with `d = 52.6` and 0.15 → `ρ = sqrt(−ln 0.15) / 52.6 ≈ 0.0262`. Set `FOG_DENSITY = 0.026`. At the hit plane (4.6 m) visibility is 98.6 %; at `BEAM_HOVER_Z` (18.6 m) ≈ 79 %, so beam targets read as distant but clear.
- Colour management: `renderer.outputColorSpace = SRGBColorSpace`, tone mapping `ACESFilmic` with exposure 1.0 applied **inside** the composer's final pass (the `postprocessing` library's `ToneMappingEffect`), so emissive values > 1 survive into bloom.

## 2. Infinite grid (`grid.frag.glsl`)

A single `PlaneGeometry(400, 400, 1, 1)` placed at `y = 0`, rotated by `−LANE_PITCH_DEG` about x so it is coplanar with the lane (the lane rises into the distance, so the grid rises with it), centred at `z = −150`. One draw call.

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
    vec3 gc = mix(uLineCol * 2.0, vec3(1.0, 0.12, 0.24) * 2.5, uColumnRed[i]);
    guide += gl * near; lines += gl * near * 0.8;
    // colour accumulated below
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
- `uBeatPhase = fract((songTime − beatOffsetMs) / (60000 / bpm))`; `uBeatPulse` is set to 1 whenever the beat index increments, decays `exp(−dt / 120 ms)`. In the attract scene a 110 BPM virtual grid is used.
- Grid pulses also fire from `music:event` `kick` (brighter lines) — the beat band and the kick flash are different cues and both are kept.

## 3. Pylons, dust, horizon glow

- **Pylons** (`pylon.glb`, [18](18-blender-mcp-asset-pipeline.md)): one `InstancedMesh` of 14 pylons (7 per side) at `x = ±5.5`, spaced 8 m along the lane from `z = +4` to `z = −52`, recycled when they pass `z > +6` (`z −= 56`). Positions advance by `speed · dt` like the grid. Material: `MeshStandardMaterial` dark (`#0D1020`) with an emissive strip (vertex colour mask from the GLB → `emissive = uLineCol × (1.2 + uBeatPulse)`), fogged. 1 draw call.
- **Dust**: 600 `Points` in a 12 × 8 × 60 m box ahead of the camera, drifting toward the player at `speed × 0.3` with slow sine jitter, size 0.02–0.05 m, alpha 0.25, additive, colour = palette line colour. Wraps on z. 1 draw call. Gives parallax and sells speed.
- **Horizon glow**: a 60 × 14 m additive quad standing at `z = −140`, `y = 4` facing the camera with a radial gradient fragment shader (`horizon.frag.glsl`) in the current palette's accent colour, intensity 0.8 + 0.6 · `uBandLow`, +1.5 on drops decaying. It sits beyond the grid fade so the grid appears to dissolve into light. 1 draw call.

## 4. Palette states

The environment line colour and the horizon accent are a function of the most recent section `music:event` (`calm`/`build`/`drop`) plus transient flashes. `render/palette.ts` exposes `getPalette(state, t)` returning `{ line, accent, fogTint }`; all environment materials read it once per frame.

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
| `music:event kick` | `0.25 × intensity` | typical kicks keep trauma ≈ 0.2–0.35 → 3–8 cm shake |
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

Sum: `position = basePos + a + b + c_dolly + e`; `lookAt(baseLook + e_look)`; then apply `roll`; `fov = baseFov + c_fov`. **Frame-safety cap:** after summing, the projection of the four play-plane corners MUST stay inside the viewport with a 2 % margin; if not, scale `b` and `e` down until it does (a cheap iterative clamp, at most 2 iterations). Blocks at the hit plane never leave the frame.

### 5.4 Hit-stop (optional, [POLISH])

On a `perfect` judgement, the renderer's *visual* time for destruction fragments runs at 0.3× for 40 ms (fragments only — the song and spawner never slow down). Gives weight without touching gameplay timing.

## 6. Post FX (`render/postfx.ts`)

Library: `postprocessing` (pmndrs). Half-float render target (`HalfFloatType`) so HDR emissive values survive to bloom.

```ts
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.6, luminanceSmoothing: 0.3, intensity: 1.2, radius: 0.7, levels: 6 });
const chroma = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
const vignette = new VignetteEffect({ darkness: 0.45, offset: 0.35 });
const glitch = new GlitchLiteEffect();           // custom Effect subclass, §6.3
const aa = tier === 'high' ? new SMAAEffect({ preset: SMAAPreset.MEDIUM }) : new FXAAEffect();
const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
composer.addPass(new EffectPass(camera, bloom, chroma, glitch, vignette, aa, tone));
```

All effects in **one** `EffectPass` so the library merges them into a single full-screen shader (plus bloom's internal mip chain). Bloom resolution: `bloom.resolution.scale = BLOOM_RESOLUTION_SCALE` (0.5).

### 6.1 Per-frame drivers

| Uniform | Driver |
| --- | --- |
| `bloom.intensity` | `1.2 + 0.8 · uDrop + 0.3 · uKick` |
| `bloom.luminanceThreshold` | 0.6 constant (lower tiers 0.7 to cut bloom cost) |
| `chroma.offset` | `(0.004, 0.004) · uDrop` (medium+ tiers; 0 on low) |
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

Strength 0 → the effect is a no-op (the library skips nothing, but the cost is one extra texture fetch pair; acceptable).

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

`renderer.sortObjects = true` (default) handles back-to-front among transparent objects with the same `renderOrder`; explicit orders remove the classic "particles behind glass" flicker. Additive objects never write depth.

### 6.5 Frame-time costs (1080p, Iris Xe, measured targets)

| Pass | high | medium | low |
| --- | --- | --- | --- |
| Scene render | 4.5 ms | 3.5 ms | 2.5 ms |
| Bloom (half-res, 6 levels / 5 / 4) | 2.0 ms | 1.6 ms | 1.1 ms |
| Merged effect pass (chroma + glitch + vignette + tone) | 0.6 ms | 0.5 ms | 0.4 ms |
| AA (SMAA / FXAA / none) | 1.1 ms | 0.5 ms | 0 |
| **Total GPU** | **8.2 ms** | **6.1 ms** | **4.0 ms** |

Budgets are inputs to [16](16-performance-budget.md); if a measurement exceeds its target by > 20 % the tier drops.

## 7. Quality tiers

| Tier | Render scale | Bloom levels | Chroma | AA | Dust | Pylons |
| --- | --- | --- | --- | --- | --- | --- |
| high | 1.0 | 6 | yes | SMAA | 600 | 14 |
| medium | 1.0 (0.85 above 1440p) | 5 | yes | FXAA | 400 | 14 |
| low | 0.75 | 4 | no | none | 200 | 8 |

Render scale is applied via `renderer.setPixelRatio(min(devicePixelRatio, 1) × scale)`; the DOM HUD is unaffected.

## 8. Highlight capture (`render/highlight.ts`)

On `highlight:capture { songTimeMs }` (new peak combo), render the silhouette plane + skeleton + hand particles **only** (layer mask) into a 768 × 768 `WebGLRenderTarget` with a transparent clear, from a camera 30° off-axis to show depth; also snapshot the 13 skeleton joint positions and `MaskFrame` reference. Keep the most recent capture (overwrite). On `RESULTS`, the capture texture is shown as a sprite on the right and the stored joint positions drive a slow turntable (±25° yaw at 0.1 Hz) of a skeleton-only replica. Cost: one extra ≤ 1 ms render at most once every few seconds — never more than once per 2 s (debounce).

## 9. Acceptance criteria

- [ ] The grid floor is anti-aliased at all distances (no moiré at the horizon), scrolls at the notes' speed, and shows a visible bright band on every beat of the tracked grid.
- [ ] Notes at spawn are faint but visible (~15 %), fully clear at the hit plane.
- [ ] Kicks produce a short, smooth camera shake (no jitter); a drop produces a clear FOV punch and dolly within 80 ms that settles within ~700 ms; blocks at the hit plane never leave the viewport during any shake.
- [ ] Leaning left/right moves the camera subtly in the lean direction.
- [ ] Palette visibly changes between calm, build and drop sections of a test track with a clear drop.
- [ ] An obstacle hit shows an RGB-split tear and a red vignette for ~120–400 ms.
- [ ] Emissive surfaces bloom; the silhouette fill, glass fill and obstacle fill do not (bloom mask debug view).
- [ ] Measured GPU time per tier is within 20 % of the table in §6.5 on the demo laptop.
- [ ] The highlight capture appears on Results showing the player's pose at the peak-combo moment.

## Constants required

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
