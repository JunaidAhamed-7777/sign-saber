# 12 — Rendering: Hands & Trails

The hands are the player's weapons and their only cursor. Every frame they must show three things at a glance: *where* the hand is, *which gesture* it holds, and *how fast* it moves. Idle hands wear a cloud of orbiting particles; a fast open hand snaps those particles into a katana-length blade; a pointing hand grows a charging cone; a fist compacts into a dense knot. All of it is driven by `HandCursor` ([02 §HandCursor](02-architecture.md#input-pipeline--game-handcursor-bodystate)) and `BandEnergies`.

Owning files: `render/trails.ts` (particles + indicator), `render/blade.ts` (ribbon), `render/beam.ts` (beam visual), shaders `particles.vert.glsl`, `particles.frag.glsl`, `ribbon.vert.glsl`, `ribbon.frag.glsl`, `beam.frag.glsl`.

## 1. Per-hand colouring

| Hand | Core | Tint | Use |
| --- | --- | --- | --- |
| left | white-hot `#FFFFFF` ×2.2 | cyan `#19F5FF` | particles, blade glow, hand spot |
| right | white-hot `#FFFFFF` ×2.2 | violet `#B36BFF` | same |

The tint is applied at the particle edges and the blade glow layer; the core stays white so both hands bloom the same way and remain readable against cyan/magenta blocks. The HUD gesture indicators ([14](14-ui-ux.md)) use the same tints.

## 2. Particle system (`render/trails.ts`)

One `THREE.Points` per hand with `MAX_TRAIL_PARTICLES_PER_HAND` vertices and a custom `ShaderMaterial`. All motion is computed **on the GPU** from a few uniforms; the CPU uploads nothing per frame except uniforms.

### 2.1 Attributes (static, filled once)

| Attribute | Type | Meaning |
| --- | --- | --- |
| `aSeed` | float | random 0..1 — picks ring/cloud membership and jitter |
| `aPhase` | float | random 0..2π — orbital phase |
| `aSize` | float | 0.012–0.035 m base sprite size |
| `aSpine` | float | 0..1 — position along the blade when elongated |

Membership by seed: `seed < 0.4` ring A, `0.4 ≤ seed < 0.8` ring B, else sparse cloud.

### 2.2 Uniforms (per frame)

```glsl
uniform vec3  uPalm;        // HandCursor.pos (world)
uniform vec3  uTip;         // HandCursor.tip
uniform vec2  uPointDir;    // HandCursor.pointDir (play-plane)
uniform float uTime;
uniform float uSpeed;       // HandCursor.speed
uniform float uGesture;     // 0 none, 1 open, 2 fist, 3 point
uniform float uCharge;      // HandCursor.charge
uniform float uBladeMix;    // 0 orbit .. 1 blade (CPU eased, see §4.4)
uniform float uBand;        // 0.5*mid + 0.5*high from BandEnergies
uniform vec3  uTint, uCore;
uniform float uPresence;    // 0..1 eased on present flag
uniform sampler2D uSpine;   // 1 × 64 RGBA32F: blade spine samples (xyz) + width (w), see §4
```

### 2.3 Idle orbit (vertex shader)

```glsl
vec3 orbit(float seed, float phase) {
  float ring = step(0.4, seed) + step(0.8, seed);        // 0,1,2
  float r = mix(0.12, 0.22, fract(seed * 7.13));         // orbit radius
  float speed = (1.2 + uBand * 2.0) * (ring < 1.5 ? 1.0 : 0.6) * (ring == 1.0 ? -1.0 : 1.0);
  float a = phase + uTime * speed;
  // Two tilted rings (ring 0 tilted +35° about x, ring 1 −35° about z) and a cloud
  vec3 p = vec3(cos(a), 0.0, sin(a)) * r;
  if (ring == 0.0) p = rotX(0.61) * p;
  else if (ring == 1.0) p = rotZ(-0.61) * p;
  else p = vec3(sin(a*0.7+seed), cos(a*0.9), sin(a*1.3+seed*3.0)) * r * 1.4;   // loose cloud
  // Gesture shaping
  if (uGesture == 2.0) p *= 0.45;                                           // fist: compact knot
  if (uGesture == 3.0) {                                                     // point: forward cone along pointDir
    vec3 dir = normalize(vec3(uPointDir, 0.0));
    float along = fract(seed * 3.7 + uTime * 0.8) * 0.5;                    // 0..0.5 m ahead of the tip
    p = (uTip - uPalm) + dir * along + p * (0.25 + along * 0.6);
  }
  return uPalm + p;
}
```

`rotX/rotZ` are inline mat3 helpers. The open gesture adds a thin indicator ring (§3) rather than reshaping particles, so the orbit stays calm and readable.

### 2.4 Fragment shader

Soft additive sprite with a white core and tinted edge:

```glsl
in float vAlpha; in float vHeat;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d);
  if (r2 > 0.25) { gl_FragColor = vec4(0.0); return; }   // outside the disc (alpha 0, no discard on low tier)
  float soft = exp(-r2 * 14.0);
  vec3 col = mix(uTint, uCore, smoothstep(0.08, 0.0, r2) * 0.8 + vHeat);
  gl_FragColor = vec4(col * soft * vAlpha * (1.6 + vHeat), soft * vAlpha);
}
```

`gl_PointSize = aSize * uResolution.y / (−mvPosition.z) * sizeScale` (perspective size attenuation). `vHeat` increases with `uSpeed` (`clamp(uSpeed / BLADE_FULL_SPEED, 0, 1)`), so a fast hand's particles glow whiter even before the blade forms. Blending `AdditiveBlending`, `depthWrite: false`, `depthTest: true`. `vAlpha = uPresence × (0.5 + 0.5 · fract(seed × 11.0 + uTime × 0.3))` for twinkle.

## 3. Gesture indicator (`render/trails.ts`, part 2)

A single `Mesh` per hand: a flat ring (`RingGeometry(0.11, 0.125, 48)`) at `HandCursor.pos`, facing the camera, additive, with a `uArc` uniform.

| Gesture | Indicator |
| --- | --- |
| `none` | hidden (fades out over 120 ms) |
| `open` | thin full ring in the hand tint, alpha 0.6, slow 20°/s spin of a subtle 8-notch pattern |
| `fist` | ring shrinks to radius 0.07, thickness ×2, alpha 0.9; the particle knot (§2.3) does the rest |
| `point` | ring moves to `HandCursor.tip`; **charge arc**: `uArc = charge` fills the ring clockwise from 12 o'clock over `BEAM_CHARGE_MS` (`alpha = step(angle, uArc × 2π)`), gold `#FFC32B`; at `charge == 1` the ring pops to radius 0.16 for 90 ms and stays gold-bright with a 6 Hz pulse until fired or the gesture ends |

Arc shader: `float ang = atan(vLocal.y, vLocal.x) + π/2; ang = mod(ang, 2π); alpha *= step(ang, uArc * 2π);` plus a bright leading dot at the arc end.

## 4. Blade ribbon (`render/blade.ts`)

### 4.1 Spine construction

From `HandCursor.history` (`TRAIL_HISTORY` = 24 positions, newest last, play-plane world coords, ~33 ms apart):

1. Take the newest `N` positions whose cumulative path length ≤ `bladeLength` (`HandCursor.bladeLength`, 0 when inactive). Always include at least 4 points; if the history is shorter, extrapolate backward along `−vel`.
2. Resample the polyline to exactly **48 spine samples** using Catmull–Rom (centripetal, α = 0.5) with the first/last points duplicated as phantom controls. Spine sample 0 is the oldest (tail), sample 47 is at `HandCursor.pos` (hilt).
3. Width profile per sample `s ∈ [0,1]` (0 tail → 1 hilt). The blade is widest near the hilt and tapers toward the tip: `core(s) = BLADE_CORE_W · (0.35 + 0.65 · s) · smoothstep(0, 0.08, s)`, `glow(s) = BLADE_GLOW_W · (0.4 + 0.6 · s) · smoothstep(0, 0.08, s)`. The tail fades to zero width over the first 8 %; the hilt is full width.
4. Write the spine into a `1 × 64` `RGBA32F` `DataTexture` (`xyz` = position, `w` = `s`) — the particle shader reads it to elongate (§4.4). Only 48 texels are used.

Note on direction: because history is oldest→newest, the *visual* blade extends **behind** the hand along the swing path, like a light trail that has snapped rigid. That is the intended read — a katana you see as a streak. The tip spark (§4.5) sits at the oldest sample.

### 4.2 Ribbon mesh

Two `Mesh`es per hand sharing one `BufferGeometry` of `48 × 2` vertices, indexed as a triangle strip (94 triangles): a **core** layer and a **glow** layer (same geometry, different material and width uniform). Vertex attributes: `aS` (0..1 along the spine) and `aSide` (−1/+1). Positions are not stored per vertex; the vertex shader builds them:

```glsl
uniform sampler2D uSpine; uniform float uWidthScale; uniform vec3 uCamPos;
in float aS; in float aSide;
out float vS; out float vSide;
void main() {
  vec3 p  = texture(uSpine, vec2((aS * 47.0 + 0.5) / 64.0, 0.5)).xyz;
  vec3 p1 = texture(uSpine, vec2((min(aS + 1.0/47.0, 1.0) * 47.0 + 0.5) / 64.0, 0.5)).xyz;
  vec3 p0 = texture(uSpine, vec2((max(aS - 1.0/47.0, 0.0) * 47.0 + 0.5) / 64.0, 0.5)).xyz;
  vec3 tangent = normalize(p1 - p0);
  vec3 toCam   = normalize(uCamPos - p);
  vec3 side    = normalize(cross(tangent, toCam));      // ribbon normal faces the camera
  float w = width(aS) * uWidthScale;                     // core: 0.04 profile; glow: 0.14 profile
  vS = aS; vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aSide * w, 1.0);
}
```

Fragment: core layer = `uCore × 2.6` at alpha `1 − |vSide|^3`, `depthWrite: false`, normal blending (reads as solid white-hot); glow layer = `uTint × 1.4 × (1 − |vSide|)²`, additive. Both fade with `vS` toward the tail: `alpha *= smoothstep(0, 0.12, vS)`. A subtle lengthwise energy flow: `alpha *= 0.85 + 0.15 · sin(vS · 40 − uTime · 30)`.

### 4.3 Blade length

`bladeLength` comes from the input pipeline: `lerp(BLADE_LEN_MIN, BLADE_LEN_MAX, clamp((speed − BLADE_ON_SPEED) / (BLADE_FULL_SPEED − BLADE_ON_SPEED), 0, 1))`, and 0 when `bladeActive` is false. The renderer eases the *drawn* length with a critically damped spring (ω = 22 rad/s) so the blade grows and retracts smoothly rather than popping.

### 4.4 Particles elongate into the blade

`uBladeMix` is eased on the CPU: toward 1 with time constant 120 ms when `bladeActive` becomes true, toward 0 with 250 ms when it becomes false. In the particle vertex shader:

```glsl
vec3 pOrbit = orbit(aSeed, aPhase);
vec3 pSpine = texture(uSpine, vec2((aSpine * 47.0 + 0.5) / 64.0, 0.5)).xyz
            + jitter(aSeed) * 0.02 * (1.0 - aSpine);        // tighter near the hilt
vec3 p = mix(pOrbit, pSpine, uBladeMix);
float heat = max(vHeat, uBladeMix);                          // blade particles burn white
```

At `uBladeMix = 1` the cloud *is* the blade's sparkle: particles sit along the spine, so the blade looks made of the same light that was orbiting the palm. On release they relax back to orbit along a straight line over 250 ms, which reads as the blade "dissolving".

### 4.5 Tip spark and SFX hooks

- Tip spark: a 0.12 m additive sprite at spine sample 0 (tail/tip) with `alpha = uBladeMix × (0.6 + 0.4 · sin(uTime · 50))` and 6 short-lived spark particles emitted from it every 60 ms while active (reuse the poof spark `Points` pool from [11 §5](11-rendering-blocks-and-destruction.md#5-poof-beam-targets)).
- `sfx.play('whoosh', { rate: 0.9 + speed/BLADE_FULL_SPEED × 0.4, gain: clamp(speed/BLADE_FULL_SPEED, 0.3, 1) })` on the rising edge of `bladeActive`; re-trigger when `speed` crosses `BLADE_FULL_SPEED × 0.75` upward after having dropped below `0.4 × BLADE_FULL_SPEED` (prevents machine-gun whooshes). Defined in [15](15-audio-playback-sync.md).

## 5. Beam visual (`render/beam.ts`)

### 5.1 Charging

While `gesture === 'point'` and `0 < charge < 1`: the indicator arc (§3) fills; particles form the forward cone (§2.3); a faint gold line (`Line2`-free: a thin additive ribbon using the same ribbon shader with a 2-sample spine) extends from `HandCursor.tip` toward the aimed target's position when a beam target is within `2 × BEAM_AIM_RADIUS` of the fingertip ray (the game exposes the *candidate target* via `HandCursor`'s sibling data in the game's live-object list; the renderer finds the nearest beam target in play-plane distance to `tip` itself — read-only, so no contract change).

### 5.2 Firing (`beam:fire` → `{ hand, from, to, note }`)

| t | Effect |
| --- | --- |
| 0 | Flash sprite at `from` (0.3 m, white → gold, 60 ms) |
| 0–120 ms | Beam cylinder: `CylinderGeometry(0.035, 0.035, 1, 12, 1, true)` oriented from `from` to `to`, scaled to the distance (~14 m), additive. Fragment: core white `× 3`, edge gold, two scrolling noise bands (`fbm(vUv.y · 6 − uTime · 18)`) for energy, radial falloff `pow(1 − |vUv.x·2−1|, 2)`. Width: 0 → 0.07 m in 25 ms, hold, → 0 by 120 ms |
| 40 ms | Impact flash at `to` (0.7 m, gold) and the target's poof begins ([11 §5](11-rendering-blocks-and-destruction.md#5-poof-beam-targets)) |
| 0–200 ms | Indicator ring at the fingertip blinks white twice |

One cylinder mesh per hand (pooled, reused). The beam is straight in world space — it does **not** follow the lane pitch; it aims where the finger points, which is what makes it feel like a laser.

## 6. Debug drawing (`D` key)

- The swept contact segment (`prevPos → pos`, radius `HAND_HIT_RADIUS`) drawn as a capsule wireframe, green when a hit registered this frame, red on a bad cut.
- Blade spine samples as 48 small points; `bladeLength`, `speed`, `charge`, `gesture` as text next to each hand.
- `uBladeMix` and the eased drawn blade length printed in the debug HUD.

## 7. Quality tiers

| Tier | Particles per hand | Ribbon layers | Spine samples | Tip sparks | Beam noise |
| --- | --- | --- | --- | --- | --- |
| high | 256 | core + glow | 48 | yes | 2 octaves |
| medium | 160 | core + glow | 48 | yes | 1 octave |
| low | 96 | core only (wider) | 32 | no | none |

## 8. Performance

Per hand: 1 `Points` draw, 2 ribbon draws, 1 indicator ring, 1 tip sprite, occasionally 1 beam cylinder → ≤ 6 draw calls per hand, 12 total. CPU per frame: Catmull–Rom resample of ≤ 24 points to 48 (≈ 15 µs), one 64-texel texture upload per hand, uniform sets. GPU: particles are 256 tiny sprites — < 0.1 ms. The ribbon vertex shader does 3 texture fetches per vertex × 96 vertices — negligible. No per-frame geometry allocation anywhere; all typed arrays are preallocated.

## 9. Acceptance criteria

- [ ] An idle open hand shows a calm, two-ring orbit of particles whose speed audibly follows the music's mids/highs.
- [ ] A fast open-hand swing (≥ `BLADE_ON_SPEED`) grows a visibly solid white-hot blade with a tinted glow along the swing path within 120 ms; it retracts smoothly within 250 ms when the hand slows below `BLADE_OFF_SPEED`.
- [ ] Blade length is visibly longer for faster swings (≈ 0.4 m at threshold, ≈ 1.6 m at a hard swing).
- [ ] A fist compacts the particles into a dense knot and shrinks the ring; a point forms a forward cone from the fingertip in the pointing direction and the gold arc fills over exactly `BEAM_CHARGE_MS` (verifiable in the debug HUD).
- [ ] Left and right hands are distinguishable by tint (cyan vs violet) at all times.
- [ ] The beam fires as a straight gold-white cylinder from fingertip to target with a flash at both ends and is gone within 120 ms.
- [ ] Nothing in this document allocates geometry or typed arrays after boot (verify with the allocation sampler in Chrome DevTools: zero `Float32Array` allocations per frame from `render/trails.ts` / `render/blade.ts`).
- [ ] ≤ 12 draw calls for both hands combined on the high tier.

## Constants required

| Name | Value | Meaning |
| --- | --- | --- |
| `HAND_TINT_LEFT` / `HAND_TINT_RIGHT` | `#19F5FF` / `#B36BFF` | Hand tints |
| `BLADE_SPINE_SAMPLES` | 48 | Ribbon resolution |
| `BLADE_CORE_W` / `BLADE_GLOW_W` | 0.04 / 0.14 m | Ribbon widths at the hilt |
| `BLADE_MIX_ON_MS` / `BLADE_MIX_OFF_MS` | 120 / 250 | Particle elongation easing |
| `ORBIT_R_MIN` / `ORBIT_R_MAX` | 0.12 / 0.22 m | Idle orbit radii |
| `BEAM_VISUAL_MS` | 120 | Beam cylinder lifetime |
| `INDICATOR_R` | 0.12 m | Gesture ring radius |
