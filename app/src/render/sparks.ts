/**
 * Sign Saber — render/sparks.ts
 *
 * Responsibility: Bounded hit spark bursts for Slash and Smash hits (Beam hits keep their poof sparks).
 * Spec: docs/11-rendering-blocks-and-destruction.md §3–§4 payoff, docs/12 §4.5 spark look
 * Inputs: note:hit position/plane, the session visual clock, Calm, quality preset.
 * Outputs: One additive Points draw; all motion closed-form in the vertex shader.
 *
 * Fixed pool (HIT_SPARK_POOL bursts × HIT_SPARKS sparks); the oldest burst is recycled. Static per-spark
 * directions are seeded once, so the same events replay identically. Pausing freezes the clock.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import {
  GRAVITY_MPS2,
  HIT_SPARK_LIFETIME_MS,
  HIT_SPARK_POOL,
  HIT_SPARK_SIZE_M,
  HIT_SPARK_SPEED_MAX,
  HIT_SPARK_SPEED_MIN,
  HIT_SPARKS,
} from '../core/constants';

export class SparkPool {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly origins = new Float32Array(HIT_SPARK_POOL * 3);
  private readonly normals = new Float32Array(HIT_SPARK_POOL * 3);
  private readonly colors = new Float32Array(HIT_SPARK_POOL * 3);
  private readonly births = new Float32Array(HIT_SPARK_POOL).fill(-1e9);
  private next = 0;
  private readonly color = new THREE.Color();

  constructor(sparksPerBurst: number = HIT_SPARKS) {
    const count = HIT_SPARK_POOL * HIT_SPARKS,
      dirs = new Float32Array(count * 4),
      bursts = new Float32Array(count * 2);
    let state = 0x5a7c;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const u = random() * 2 - 1,
        a = random() * Math.PI * 2,
        r = Math.sqrt(1 - u * u);
      dirs[i * 4] = r * Math.cos(a);
      dirs[i * 4 + 1] = r * Math.sin(a);
      dirs[i * 4 + 2] = u;
      dirs[i * 4 + 3] = HIT_SPARK_SPEED_MIN + random() * (HIT_SPARK_SPEED_MAX - HIT_SPARK_SPEED_MIN);
      bursts[i * 2] = Math.floor(i / HIT_SPARKS);
      bursts[i * 2 + 1] = i % HIT_SPARKS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 4));
    geometry.setAttribute('aBurst', new THREE.BufferAttribute(bursts, 2));
    const material = new THREE.ShaderMaterial({
      name: 'hit_sparks',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      defines: {
        POOL: String(HIT_SPARK_POOL),
        LIFE_S: (HIT_SPARK_LIFETIME_MS / 1000).toFixed(4),
        SIZE: HIT_SPARK_SIZE_M.toFixed(4),
        GRAVITY: (GRAVITY_MPS2 * 0.5).toFixed(3),
      },
      uniforms: {
        uTime: { value: 0 },
        uActive: { value: sparksPerBurst },
        uPixels: { value: 865 },
        uOrigin: { value: this.origins },
        uNormal: { value: this.normals },
        uColor: { value: this.colors },
        uBirth: { value: this.births },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aDir; attribute vec2 aBurst;
        uniform float uTime; uniform float uActive; uniform float uPixels;
        uniform vec3 uOrigin[POOL]; uniform vec3 uNormal[POOL]; uniform vec3 uColor[POOL]; uniform float uBirth[POOL];
        varying vec3 vColor; varying float vLife;
        void main() {
          int b = int(aBurst.x);
          float age = uTime - uBirth[b];
          float t = age / LIFE_S;
          vLife = (aBurst.y < uActive && t >= 0.0 && t < 1.0) ? 1.0 - t : 0.0;
          // Spray mostly within the cut plane (normal n); a zero normal keeps the burst spherical.
          vec3 n = uNormal[b];
          vec3 dir = normalize(aDir.xyz - n * dot(aDir.xyz, n) * 0.8 + vec3(0.0, 0.0, -0.25));
          float s = age * (1.0 - 0.35 * t);
          vec3 p = uOrigin[b] + dir * aDir.w * s - vec3(0.0, GRAVITY * age * age, 0.0);
          vColor = uColor[b];
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = vLife > 0.0 ? SIZE * (0.4 + vLife) * uPixels / max(-mv.z, 0.3) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vLife;
        void main() {
          if (vLife <= 0.0) discard;
          vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d);
          float soft = exp(-r2 * 16.0) * step(r2, 0.25);
          vec3 col = mix(vColor, vec3(1.0), smoothstep(0.6, 1.0, vLife) * 0.7);
          gl_FragColor = vec4(col * soft * vLife * 1.6, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    this.points.name = 'hit_sparks';
  }

  /** Starts a burst; `normal` (unit or zero) flattens the spray into the cut plane. */
  trigger(origin: Vec3, normal: Vec3 | null, hex: number, time: number): void {
    const slot = this.next;
    this.next = (this.next + 1) % HIT_SPARK_POOL;
    this.origins[slot * 3] = origin.x;
    this.origins[slot * 3 + 1] = origin.y;
    this.origins[slot * 3 + 2] = origin.z;
    this.normals[slot * 3] = normal?.x ?? 0;
    this.normals[slot * 3 + 1] = normal?.y ?? 0;
    this.normals[slot * 3 + 2] = normal?.z ?? 0;
    this.color.setHex(hex);
    this.colors[slot * 3] = this.color.r;
    this.colors[slot * 3 + 1] = this.color.g;
    this.colors[slot * 3 + 2] = this.color.b;
    this.births[slot] = time / 1000;
  }

  update(time: number, visible: boolean, sparksPerBurst: number, pixels: number): void {
    const uniforms = this.points.material.uniforms;
    uniforms.uTime!.value = time / 1000;
    uniforms.uActive!.value = sparksPerBurst;
    uniforms.uPixels!.value = pixels;
    this.points.visible = visible;
  }

  get activeBursts(): number {
    const now = this.points.material.uniforms.uTime!.value as number;
    let count = 0;
    for (const birth of this.births) if (now >= birth && now - birth < HIT_SPARK_LIFETIME_MS / 1000) count++;
    return count;
  }

  reset(): void {
    this.births.fill(-1e9);
    this.next = 0;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
