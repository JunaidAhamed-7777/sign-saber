/**
 * Sign Saber — render/environment.ts
 *
 * Responsibility: Arena atmosphere around the authored Blender environment: antialiased shader floor
 * grid with lane guides, horizon glow, drifting dust, and band-reactive neon (bass → floor and stage,
 * mids → pylons/towers/truss, highs → skyline windows and dust sparkle).
 * Spec: docs/13-rendering-environment-camera-postfx.md §1–§4
 * Inputs: Smoothed BandEnergies, lane scroll speed, Calm flag, the authored arena group.
 * Outputs: Layer-0 environment meshes and per-frame material intensities.
 *
 * Music response is a decorative accent: levels are slew-limited (ARENA_EMISSION_SLEW_PER_S) so no
 * large area can strobe, and Calm holds steady base emission with no scroll, twinkle or pulse.
 */
import * as THREE from 'three';
import type { BandEnergies } from '../core/types';
import type { QualityPreset } from './quality';
import {
  ARENA_BAND_BASE,
  ARENA_BAND_GAIN,
  ARENA_EMISSION_SLEW_PER_S,
  ARENA_NEON_BASE,
  ARENA_TRANSIENT_GAIN,
  ARENA_TRANSIENT_WINDOW_S,
  DUST_ALPHA,
  DUST_BOX_D_M,
  DUST_BOX_H_M,
  DUST_BOX_W_M,
  DUST_SIZE_MAX_M,
  DUST_SIZE_MIN_M,
  DUST_SPEED_FRACTION,
  GRID_FADE_END_M,
  GRID_FADE_START_M,
  GRID_LINE_COLOR,
  GRID_MAJOR_M,
  GRID_MINOR_M,
  GRID_Y,
  HORIZON_GLOW_H_M,
  HORIZON_GLOW_W_M,
  HORIZON_GLOW_Y,
  HORIZON_GLOW_Z,
  LANE_X,
  QUALITY_TIER_PRESETS,
} from '../core/constants';

export type ArenaBand = 'low' | 'mid' | 'high';
/** Authored material name → reactive band. Unlisted authored materials are lit structure. */
export const ARENA_NEON_BANDS: Readonly<Record<string, ArenaBand>> = Object.freeze({
  arena_neon_cyan: 'low',
  arena_neon_blue: 'low',
  arena_neon_stage: 'low',
  arena_neon_magenta: 'mid',
  arena_neon_gold: 'mid',
  pylon_strip: 'mid',
  arena_sky_window: 'high',
  arena_sky_halo: 'low',
});
/** Distant silhouettes sit beyond the fog's useful range; they are drawn unfogged against the glow. */
const UNFOGGED = /^arena_sky_/;
const BANDS: readonly ArenaBand[] = ['low', 'mid', 'high'];

interface NeonBinding {
  material: THREE.MeshBasicMaterial;
  base: THREE.Color;
  band: ArenaBand;
}

/** Pure, testable response: steady base plus a bounded level/transient accent, slew-limited. */
export function bandResponse(
  previous: number,
  level: number,
  slow: number,
  dt: number,
  calm: boolean,
): number {
  const target = calm
    ? 0
    : Math.min(1, ARENA_BAND_BASE * level + ARENA_TRANSIENT_GAIN * Math.max(0, level - slow));
  const step = ARENA_EMISSION_SLEW_PER_S * Math.max(0, dt);
  return previous + Math.max(-step, Math.min(step, target - previous));
}

/**
 * Supplemental instanced pylons: dark lit body, emissive recessed strip/crown from the authored `aTrim`
 * mask. `uStrip` carries the mid-band response (HDR multiplier on the strip colour).
 */
export function createPylonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'supplemental_pylon',
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uStrip: { value: ARENA_NEON_BASE },
      uBody: { value: new THREE.Color(0x19283e) },
      uStripColor: { value: new THREE.Color(0x19f5ff) },
    },
    vertexShader: /* glsl */ `
      attribute float aTrim;
      varying vec3 vNormalW; varying float vTrim;
      #include <fog_pars_vertex>
      void main() {
        #ifdef USE_INSTANCING
          mat4 instanceModel = modelMatrix * instanceMatrix;
        #else
          mat4 instanceModel = modelMatrix;
        #endif
        vNormalW = normalize(mat3(instanceModel) * normal);
        vTrim = aTrim;
        vec4 mvPosition = viewMatrix * instanceModel * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrip; uniform vec3 uBody; uniform vec3 uStripColor;
      varying vec3 vNormalW; varying float vTrim;
      #include <fog_pars_fragment>
      void main() {
        float light = 0.35 + 0.65 * max(dot(normalize(vNormalW), normalize(vec3(0.3, 0.6, 0.75))), 0.0);
        gl_FragColor = vec4(mix(uBody * light, uStripColor * uStrip, vTrim), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export class ArenaAtmosphere {
  readonly group = new THREE.Group();
  readonly pylonMaterial = createPylonMaterial();
  private readonly gridMaterial: THREE.ShaderMaterial;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly dustMaterial: THREE.ShaderMaterial;
  private readonly dust: THREE.Points;
  private readonly neon: NeonBinding[] = [];
  private readonly replaced: THREE.Material[] = [];
  private readonly slow = { low: 0, mid: 0, high: 0 };
  readonly response = { low: 0, mid: 0, high: 0 };
  private scroll = 0;
  private time = 0;

  constructor(private preset: QualityPreset) {
    this.group.name = 'arena_atmosphere';
    const lineColor = new THREE.Color(GRID_LINE_COLOR);
    this.gridMaterial = new THREE.ShaderMaterial({
      name: 'arena_grid',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      defines: {
        LANES: `vec4(${LANE_X.map((x) => x.toFixed(3)).join(', ')})`,
        MINOR: GRID_MINOR_M.toFixed(3),
        MAJOR: GRID_MAJOR_M.toFixed(3),
        FADE_START: GRID_FADE_START_M.toFixed(3),
        FADE_END: GRID_FADE_END_M.toFixed(3),
      },
      uniforms: {
        uScroll: { value: 0 },
        uLow: { value: 0 },
        uGlow: { value: preset.grid === 'antialiased-glow' ? 1 : 0 },
        uLine: { value: lineColor },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uScroll; uniform float uLow; uniform float uGlow; uniform vec3 uLine;
        varying vec3 vWorld;
        float gridLine(vec2 p, float cell, float thick) {
          vec2 q = p / cell;
          vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
          return 1.0 - smoothstep(thick, thick + 1.0, min(g.x, g.y));
        }
        void main() {
          vec2 p = vec2(vWorld.x, vWorld.z + uScroll);
          float minor = gridLine(p, MINOR, 0.4) * 0.22;
          float major = gridLine(p, MAJOR, 0.9);
          float lines = max(minor, major) * (0.45 + 0.75 * uLow);
          float guide = 0.0;
          for (int i = 0; i < 4; i++) {
            float d = abs(vWorld.x - LANES[i]);
            guide += (1.0 - smoothstep(0.0, 0.03 + fwidth(vWorld.x), d)) * smoothstep(-16.0, -2.0, vWorld.z);
          }
          float pool = exp(-dot(vWorld.xz - vec2(0.0, -1.4), vWorld.xz - vec2(0.0, -1.4)) * 0.03) * uLow * uGlow;
          float dist = length(vWorld.xz - cameraPosition.xz);
          float horizon = 1.0 - smoothstep(FADE_START, FADE_END, dist);
          vec3 color = uLine * lines * 0.42 + vec3(0.05, 0.55, 0.65) * guide * 0.5 + vec3(0.08, 0.25, 0.55) * pool * 0.35;
          gl_FragColor = vec4(color * horizon, 1.0);
        }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.gridMaterial);
    grid.position.y = GRID_Y;
    grid.renderOrder = -20;
    grid.frustumCulled = false;
    grid.name = 'arena_grid_shader';
    this.glowMaterial = new THREE.ShaderMaterial({
      name: 'arena_horizon_glow',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x3a2a9a) }, uIntensity: { value: 0.8 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uIntensity; varying vec2 vUv;
        void main() {
          vec2 d = (vUv - vec2(0.5, 0.18)) * vec2(1.0, 2.2);
          float g = exp(-dot(d, d) * 7.0) + 0.35 * exp(-abs(vUv.y - 0.18) * 14.0) * (1.0 - abs(vUv.x - 0.5) * 1.6);
          gl_FragColor = vec4(uColor * max(g, 0.0) * uIntensity, 1.0);
        }`,
    });
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(HORIZON_GLOW_W_M, HORIZON_GLOW_H_M),
      this.glowMaterial,
    );
    glow.position.set(0, HORIZON_GLOW_Y, HORIZON_GLOW_Z);
    glow.renderOrder = -30;
    glow.name = 'arena_horizon_glow';
    const maxDust = QUALITY_TIER_PRESETS.high.dustPoints,
      seeds = new Float32Array(maxDust * 4);
    let state = 0x5eed;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < maxDust; i++) {
      seeds[i * 4] = (random() - 0.5) * DUST_BOX_W_M;
      seeds[i * 4 + 1] = random() * DUST_BOX_H_M;
      seeds[i * 4 + 2] = random();
      seeds[i * 4 + 3] = random();
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxDust * 3), 3));
    dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.dustMaterial = new THREE.ShaderMaterial({
      name: 'arena_dust',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      defines: {
        BOX_D: DUST_BOX_D_M.toFixed(3),
        SIZE_MIN: DUST_SIZE_MIN_M.toFixed(4),
        SIZE_MAX: DUST_SIZE_MAX_M.toFixed(4),
        ALPHA: DUST_ALPHA.toFixed(3),
      },
      uniforms: {
        uTime: { value: 0 },
        uTravel: { value: 0 },
        uHigh: { value: 0 },
        uScale: { value: 1 },
        uPixels: { value: 865 },
        uColor: { value: lineColor.clone().lerp(new THREE.Color(0x9fe8ff), 0.6) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uTravel; uniform float uScale; uniform float uHigh; uniform float uPixels;
        varying float vAlpha;
        void main() {
          float z = -mod(aSeed.z * BOX_D - uTravel, BOX_D) - 2.0;
          vec3 p = vec3(aSeed.x + sin(uTime * 0.3 + aSeed.w * 6.28) * 0.25, aSeed.y - 0.3, z);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.z * 40.0);
          float edge = smoothstep(0.0, 6.0, -z) * (1.0 - smoothstep(BOX_D * 0.7, BOX_D, -z));
          vAlpha = ALPHA * edge * mix(1.0, twinkle * (0.6 + 1.6 * uHigh), step(0.5, uScale));
          gl_PointSize = mix(SIZE_MIN, SIZE_MAX, aSeed.w) * uScale * uPixels / max(-mv.z, 0.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float soft = exp(-dot(d, d) * 18.0);
          gl_FragColor = vec4(uColor * soft * vAlpha * 2.0, 1.0);
        }`,
    });
    this.dust = new THREE.Points(dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = -19;
    this.dust.name = 'arena_dust';
    this.group.add(glow, grid, this.dust);
    this.applyPreset(preset);
  }

  applyPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.dust.geometry.setDrawRange(0, preset.dustPoints);
    this.gridMaterial.uniforms.uGlow!.value = preset.grid === 'antialiased-glow' ? 1 : 0;
  }

  /** Re-material the authored arena once: neon → unlit HDR basic, sky → unfogged, pylon masks preserved. */
  bind(environment: THREE.Object3D): void {
    const swapped = new Map<THREE.Material, THREE.Material>();
    environment.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const next = list.map((material: THREE.Material) => {
        const prior = swapped.get(material);
        if (prior) return prior;
        let replacement: THREE.Material = material;
        const band = ARENA_NEON_BANDS[material.name];
        const source = material as THREE.MeshStandardMaterial;
        if (band && source.color) {
          const basic = new THREE.MeshBasicMaterial({
            color: source.color.clone(),
            fog: !UNFOGGED.test(material.name),
          });
          basic.name = material.name;
          this.neon.push({ material: basic, base: source.color.clone(), band });
          replacement = basic;
        } else if (source.isMeshStandardMaterial) {
          source.vertexColors = false;
          source.metalness = 0.6;
          source.roughness = 0.55;
          source.fog = !UNFOGGED.test(material.name);
          source.needsUpdate = true;
        }
        if (replacement !== material) this.replaced.push(material);
        swapped.set(material, replacement);
        return replacement;
      });
      object.material = Array.isArray(object.material) ? next : next[0]!;
    });
    for (const material of this.replaced) material.dispose();
    this.replaced.length = 0;
  }

  /** Called once per rendered frame. `travelMps` is lane speed while playing, 0 elsewhere. */
  update(dtMs: number, bands: BandEnergies, calm: boolean, travelMps: number): void {
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    this.time += calm ? 0 : dt;
    const k = 1 - Math.exp(-dt / ARENA_TRANSIENT_WINDOW_S);
    for (const band of BANDS) {
      const level = bands[band];
      this.slow[band] += (level - this.slow[band]) * k;
      this.response[band] = bandResponse(this.response[band], level, this.slow[band], dt, calm);
    }
    if (!calm) this.scroll += travelMps * dt;
    const grid = this.gridMaterial.uniforms;
    grid.uScroll!.value = this.scroll % 400;
    grid.uLow!.value = this.response.low;
    this.glowMaterial.uniforms.uIntensity!.value = 0.8 + 0.6 * this.response.low;
    const dust = this.dustMaterial.uniforms;
    dust.uTime!.value = this.time;
    dust.uTravel!.value = (this.scroll * DUST_SPEED_FRACTION) % DUST_BOX_D_M;
    dust.uHigh!.value = this.response.high;
    dust.uScale!.value = calm ? 0.4 : 1;
    this.pylonMaterial.uniforms.uStrip!.value = ARENA_NEON_BASE + ARENA_BAND_GAIN * this.response.mid;
    for (const binding of this.neon) {
      const gain = ARENA_NEON_BASE + ARENA_BAND_GAIN * this.response[binding.band];
      binding.material.color.copy(binding.base).multiplyScalar(gain);
    }
  }

  /** Perspective point-size factor for the dust: drawing-buffer height / (2·tan(fov/2)). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.dustMaterial.uniforms.uPixels!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  get neonCount(): number {
    return this.neon.length;
  }

  dispose(): void {
    for (const object of this.group.children)
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) object.geometry.dispose();
    this.gridMaterial.dispose();
    this.glowMaterial.dispose();
    this.dustMaterial.dispose();
    this.pylonMaterial.dispose();
    for (const binding of this.neon) binding.material.dispose();
    this.neon.length = 0;
  }
}
