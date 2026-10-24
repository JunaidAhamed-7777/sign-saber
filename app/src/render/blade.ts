/**
 * Sign Saber — render/blade.ts
 *
 * Responsibility: Per-hand blade ribbon: a white-hot core and a tinted additive glow that trail the
 * measured palm path when the hand moves fast (HandCursor.bladeActive / bladeLength).
 * Spec: docs/12-rendering-hands-trails.md §4 Blade ribbon
 * Inputs: HandCursor.history/pos/bladeLength, camera position, quality preset (samples, layers).
 * Outputs: Two camera-facing triangle strips per hand, rebuilt into preallocated buffers.
 *
 * Purely cosmetic: it reads the measured history and never changes collision, scoring or the cursor.
 * The drawn length eases with a critically damped spring so the blade grows and retracts smoothly.
 */
import * as THREE from 'three';
import type { HandCursor, Vec3 } from '../core/types';
import {
  BLADE_CORE_W,
  BLADE_GLOW_W,
  BLADE_LENGTH_SPRING_RAD_S,
  BLADE_SPINE_SAMPLES,
} from '../core/constants';
import type { QualityPreset } from './quality';

const RIBBON_VERTEX = /* glsl */ `
  attribute float aS; attribute float aSide;
  varying float vS; varying float vSide;
  void main() {
    vS = aS; vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

function ribbonMaterial(core: boolean, tint: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: core ? 'blade_core' : 'blade_glow',
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: core ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: { uTint: { value: tint }, uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: RIBBON_VERTEX,
    fragmentShader: core
      ? /* glsl */ `
        uniform vec3 uTint; uniform float uOpacity; varying float vS; varying float vSide;
        void main() {
          float a = (1.0 - pow(abs(vSide), 3.0)) * smoothstep(0.0, 0.18, vS) * uOpacity;
          gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.75) * 2.2, a);
          #include <colorspace_fragment>
        }`
      : /* glsl */ `
        uniform vec3 uTint; uniform float uTime; uniform float uOpacity; varying float vS; varying float vSide;
        void main() {
          float fall = pow(1.0 - abs(vSide), 2.0) * smoothstep(0.0, 0.25, vS);
          float flow = 0.85 + 0.15 * sin(vS * 40.0 - uTime * 30.0);
          gl_FragColor = vec4(uTint * 1.2 * fall * flow * uOpacity, 1.0);
          #include <colorspace_fragment>
        }`,
  });
}

/** One hand's ribbon: preallocated spine, CPU-built strips, spring-eased drawn length. */
export class BladeRibbon {
  readonly group = new THREE.Group();
  /** Resampled spine (tail → hilt), BLADE_SPINE_SAMPLES × xyz; shared with the particle system. */
  readonly spine = new Float32Array(BLADE_SPINE_SAMPLES * 3);
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly cumulative = new Float32Array(64);
  private samples = BLADE_SPINE_SAMPLES;
  private layers = 2;
  private widen = 1;
  private length = 0;
  private velocity = 0;
  /** Eased drawn length in metres (0 when the blade is fully retracted). */
  get drawnLength(): number {
    return this.length;
  }

  constructor(tint: THREE.Color) {
    const make = (core: boolean): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> => {
      const geometry = new THREE.BufferGeometry(),
        count = BLADE_SPINE_SAMPLES * 2,
        s = new Float32Array(count),
        side = new Float32Array(count),
        index: number[] = [];
      for (let i = 0; i < BLADE_SPINE_SAMPLES; i++) {
        s[i * 2] = s[i * 2 + 1] = i / (BLADE_SPINE_SAMPLES - 1);
        side[i * 2] = -1;
        side[i * 2 + 1] = 1;
        if (i < BLADE_SPINE_SAMPLES - 1) {
          const a = i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      geometry.setIndex(index);
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute('aS', new THREE.BufferAttribute(s, 1));
      geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      const mesh = new THREE.Mesh(geometry, ribbonMaterial(core, tint));
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = core ? 21 : 20;
      mesh.name = core ? 'blade_core' : 'blade_glow';
      return mesh;
    };
    this.glow = make(false);
    this.core = make(true);
    this.group.add(this.glow, this.core);
  }

  applyPreset(preset: QualityPreset): void {
    this.samples = Math.min(BLADE_SPINE_SAMPLES, preset.ribbonSpineSamples);
    this.layers = preset.ribbonLayers;
    this.widen = preset.ribbonCoreWidened ? 1.8 : 1;
    for (const mesh of [this.core, this.glow]) {
      const along = mesh.geometry.getAttribute('aS') as THREE.BufferAttribute;
      for (let i = 0; i < this.samples; i++)
        along.setX(i * 2, i / (this.samples - 1)).setX(i * 2 + 1, i / (this.samples - 1));
      along.needsUpdate = true;
    }
    const indices = (this.samples - 1) * 6;
    this.core.geometry.setDrawRange(0, indices);
    this.glow.geometry.setDrawRange(0, indices);
  }

  /** Clears the eased length so a reacquired hand never bridges the previous path. */
  reset(): void {
    this.length = this.velocity = 0;
    this.core.visible = this.glow.visible = false;
  }

  /**
   * Rebuilds the strips from the measured history. `dt` in seconds; `presence` 0..1 fades the whole blade.
   * Returns true when a ribbon is drawn.
   */
  update(
    hand: HandCursor | undefined,
    dt: number,
    camera: THREE.Vector3,
    time: number,
    presence: number,
  ): boolean {
    const target = hand?.present && hand.bladeActive ? hand.bladeLength : 0;
    // Critically damped spring toward the requested length (ω = BLADE_LENGTH_SPRING_RAD_S).
    const w = BLADE_LENGTH_SPRING_RAD_S,
      step = Math.min(dt, 0.05);
    this.velocity += (w * w * (target - this.length) - 2 * w * this.velocity) * step;
    this.length = Math.max(0, this.length + this.velocity * step);
    const history = hand?.present ? hand.history : null;
    if (!history || history.length < 2 || this.length < 0.03 || presence <= 0) {
      this.core.visible = this.glow.visible = false;
      return false;
    }
    // Walk back from the newest point, accumulating arc length until the drawn length is covered.
    const newest = history.length - 1;
    let total = 0,
      used = 0;
    this.cumulative[0] = 0;
    for (let i = newest; i > 0 && used < this.cumulative.length - 1; i--) {
      const a = history[i]!,
        b = history[i - 1]!,
        d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (!Number.isFinite(d)) break;
      total += d;
      this.cumulative[++used] = total;
      if (total >= this.length) break;
    }
    const span = Math.min(total, this.length);
    if (used === 0 || span < 0.02) {
      this.core.visible = this.glow.visible = false;
      return false;
    }
    // Uniform arc-length resampling: sample 0 is the tail (oldest), the last is the hilt (palm).
    const n = this.samples;
    let segment = 0;
    for (let k = 0; k < n; k++) {
      const along = span * (1 - k / (n - 1));
      while (segment < used - 1 && this.cumulative[segment + 1]! < along) segment++;
      const a = history[newest - segment]!,
        b = history[newest - segment - 1] ?? a,
        len = this.cumulative[segment + 1]! - this.cumulative[segment]!,
        t = len > 1e-6 ? Math.min(1, (along - this.cumulative[segment]!) / len) : 0;
      this.spine[k * 3] = a.x + (b.x - a.x) * t;
      this.spine[k * 3 + 1] = a.y + (b.y - a.y) * t;
      this.spine[k * 3 + 2] = a.z + (b.z - a.z) * t;
    }
    this.write(this.core, BLADE_CORE_W * this.widen, camera);
    this.write(this.glow, BLADE_GLOW_W, camera);
    this.core.material.uniforms.uOpacity!.value = presence;
    this.glow.material.uniforms.uOpacity!.value = presence;
    this.glow.material.uniforms.uTime!.value = time;
    this.core.visible = true;
    this.glow.visible = this.layers > 1;
    return true;
  }

  /** The current hilt-to-tail sample (index 0 is the tail); used by the particles. */
  sample(index: number, out: Vec3): Vec3 {
    const k = Math.max(0, Math.min(this.samples - 1, index)) * 3;
    out.x = this.spine[k]!;
    out.y = this.spine[k + 1]!;
    out.z = this.spine[k + 2]!;
    return out;
  }

  get sampleCount(): number {
    return this.samples;
  }

  private write(
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
    width: number,
    camera: THREE.Vector3,
  ): void {
    const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      p = positions.array as Float32Array,
      n = this.samples;
    let sx = 1,
      sy = 0,
      sz = 0;
    for (let k = 0; k < n; k++) {
      const prev = Math.max(0, k - 1) * 3,
        next = Math.min(n - 1, k + 1) * 3,
        x = this.spine[k * 3]!,
        y = this.spine[k * 3 + 1]!,
        z = this.spine[k * 3 + 2]!,
        tx = this.spine[next]! - this.spine[prev]!,
        ty = this.spine[next + 1]! - this.spine[prev + 1]!,
        tz = this.spine[next + 2]! - this.spine[prev + 2]!,
        cx = camera.x - x,
        cy = camera.y - y,
        cz = camera.z - z;
      // side = tangent × toCamera, guarded against degenerate (near-parallel or zero) tangents.
      let ox = ty * cz - tz * cy,
        oy = tz * cx - tx * cz,
        oz = tx * cy - ty * cx;
      const length = Math.hypot(ox, oy, oz);
      if (length > 1e-6) {
        ox /= length;
        oy /= length;
        oz /= length;
        sx = ox;
        sy = oy;
        sz = oz;
      }
      const s = k / (n - 1),
        w = width * (0.35 + 0.65 * s) * Math.min(1, s / 0.08) * 0.5;
      p[k * 6] = x - sx * w;
      p[k * 6 + 1] = y - sy * w;
      p[k * 6 + 2] = z - sz * w;
      p[k * 6 + 3] = x + sx * w;
      p[k * 6 + 4] = y + sy * w;
      p[k * 6 + 5] = z + sz * w;
    }
    positions.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.core, this.glow]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
