/**
 * Sign Saber — render/trails.ts
 *
 * Responsibility: Per-hand GPU particles (calm two-ring orbit around the palm, compact knot for a fist,
 * forward cone for a point) that elongate onto the blade spine when the hand moves fast, plus the
 * per-hand blade ribbon from render/blade.ts.
 * Spec: docs/12-rendering-hands-trails.md §2, §4.4
 * Inputs: HandCursor (measured), BandEnergies (mids/highs drive orbit speed), Calm, quality preset.
 * Outputs: One Points draw + two ribbon draws per visible hand; uniforms only per frame.
 *
 * Visual only: never mutates HandCursor, history or scoring. Static attributes are seeded once.
 */
import * as THREE from 'three';
import type { BandEnergies, HandCursor } from '../core/types';
import {
  BLADE_MIX_OFF_MS,
  BLADE_MIX_ON_MS,
  HAND_PRESENCE_FADE_MS,
  HAND_TINT_LEFT,
  HAND_TINT_RIGHT,
  MAX_TRAIL_PARTICLES_PER_HAND,
  ORBIT_R_MAX,
  ORBIT_R_MIN,
  TRAIL_PARTICLE_SIZE_MAX_M,
  TRAIL_PARTICLE_SIZE_MIN_M,
} from '../core/constants';
import { BladeRibbon } from './blade';
import type { QualityPreset } from './quality';

/** Spine points uploaded to the particle shader (downsampled from the ribbon spine). */
const SPINE_UNIFORMS = 16;
const GESTURE_CODE = { none: 0, open: 1, fist: 2, point: 3 } as const;

function particleMaterial(tint: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'hand_particles',
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    defines: {
      SPINE_COUNT: String(SPINE_UNIFORMS),
      R_MIN: ORBIT_R_MIN.toFixed(3),
      R_MAX: ORBIT_R_MAX.toFixed(3),
    },
    uniforms: {
      uPalm: { value: new THREE.Vector3() },
      uTip: { value: new THREE.Vector3() },
      uPointDir: { value: new THREE.Vector2(0, 1) },
      uTime: { value: 0 },
      uBand: { value: 0 },
      uGesture: { value: 0 },
      uBladeMix: { value: 0 },
      uHeat: { value: 0 },
      uPresence: { value: 0 },
      uTwinkle: { value: 1 },
      uPixels: { value: 865 },
      uTint: { value: tint },
      uSpine: { value: new Float32Array(SPINE_UNIFORMS * 3) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform vec3 uPalm; uniform vec3 uTip; uniform vec2 uPointDir; uniform float uTime; uniform float uBand;
      uniform float uGesture; uniform float uBladeMix; uniform float uHeat; uniform float uPresence;
      uniform float uTwinkle; uniform float uPixels; uniform vec3 uSpine[SPINE_COUNT];
      varying float vAlpha; varying float vHeat;
      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
      mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
      vec3 orbit(float seed, float phase) {
        float ring = step(0.4, seed) + step(0.8, seed);
        float r = mix(R_MIN, R_MAX, fract(seed * 7.13));
        float speed = (1.2 + uBand * 2.0) * (ring < 1.5 ? 1.0 : 0.6) * (ring == 1.0 ? -1.0 : 1.0);
        float a = phase + uTime * speed;
        vec3 p = vec3(cos(a), 0.0, sin(a)) * r;
        if (ring == 0.0) p = rotX(0.61) * p;
        else if (ring == 1.0) p = rotZ(-0.61) * p;
        else p = vec3(sin(a * 0.7 + seed), cos(a * 0.9), sin(a * 1.3 + seed * 3.0)) * r * 1.4;
        if (uGesture == 2.0) p *= 0.45;
        if (uGesture == 3.0) {
          vec3 dir = normalize(vec3(uPointDir, 0.0));
          float along = fract(seed * 3.7 + uTime * 0.8) * 0.5;
          p = (uTip - uPalm) + dir * along + p * (0.25 + along * 0.6);
        }
        return uPalm + p;
      }
      void main() {
        float f = aSeed.w * float(SPINE_COUNT - 1);
        int i = int(floor(f));
        int j = min(i + 1, SPINE_COUNT - 1);
        vec3 spine = mix(uSpine[i], uSpine[j], fract(f));
        vec3 jitter = (fract(vec3(aSeed.x * 13.1, aSeed.x * 7.7, aSeed.y * 3.3)) - 0.5) * 0.04 * (1.0 - aSeed.w);
        vec3 p = mix(orbit(aSeed.x, aSeed.y), spine + jitter, uBladeMix);
        vHeat = max(uHeat, uBladeMix);
        float twinkle = mix(1.0, 0.5 + 0.5 * fract(aSeed.x * 11.0 + uTime * 0.3), uTwinkle);
        vAlpha = uPresence * twinkle;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSeed.z * uPixels / max(-mv.z, 0.3);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; varying float vAlpha; varying float vHeat;
      void main() {
        vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d);
        float soft = exp(-r2 * 14.0) * step(r2, 0.25);
        vec3 col = mix(uTint, vec3(1.0), clamp((1.0 - smoothstep(0.0, 0.08, r2)) * 0.8 + vHeat * 0.6, 0.0, 1.0));
        gl_FragColor = vec4(col * soft * vAlpha * (1.2 + vHeat), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

interface HandFx {
  ribbon: BladeRibbon;
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  presence: number;
  bladeMix: number;
  wasPresent: boolean;
}

export class HandTrails {
  readonly group = new THREE.Group();
  private readonly hands: HandFx[];
  private readonly sample = { x: 0, y: 0, z: 0 };
  private time = 0;

  constructor(preset: QualityPreset) {
    this.group.name = 'hand_trails';
    this.hands = [HAND_TINT_LEFT, HAND_TINT_RIGHT].map((hex, hand) => {
      const tint = new THREE.Color(hex),
        geometry = new THREE.BufferGeometry(),
        seeds = new Float32Array(MAX_TRAIL_PARTICLES_PER_HAND * 4);
      let state = 0x1234 + hand * 0x9e37;
      const random = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      for (let i = 0; i < MAX_TRAIL_PARTICLES_PER_HAND; i++) {
        seeds[i * 4] = random();
        seeds[i * 4 + 1] = random() * Math.PI * 2;
        seeds[i * 4 + 2] =
          TRAIL_PARTICLE_SIZE_MIN_M + random() * (TRAIL_PARTICLE_SIZE_MAX_M - TRAIL_PARTICLE_SIZE_MIN_M);
        seeds[i * 4 + 3] = random();
      }
      // Positions are computed on the GPU; the attribute only sizes the draw.
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_PARTICLES_PER_HAND * 3), 3),
      );
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const points = new THREE.Points(geometry, particleMaterial(tint));
      points.frustumCulled = false;
      points.visible = false;
      points.renderOrder = 20;
      points.name = `hand_particles_${hand === 0 ? 'left' : 'right'}`;
      const ribbon = new BladeRibbon(tint);
      this.group.add(ribbon.group, points);
      return { ribbon, points, presence: 0, bladeMix: 0, wasPresent: false };
    });
    this.applyPreset(preset);
  }

  applyPreset(preset: QualityPreset): void {
    for (const fx of this.hands) {
      fx.points.geometry.setDrawRange(0, preset.trailParticlesPerHand);
      fx.ribbon.applyPreset(preset);
    }
  }

  setViewport(heightPx: number, fovDeg: number): void {
    const pixels = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const fx of this.hands) fx.points.material.uniforms.uPixels!.value = pixels;
  }

  /** `visible` is false while paused/results or when no fresh tracking exists. */
  update(
    hands: readonly HandCursor[],
    visible: boolean,
    dtMs: number,
    bands: BandEnergies,
    calm: boolean,
    camera: THREE.Vector3,
  ): void {
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    if (!calm) this.time += dt;
    for (let i = 0; i < 2; i++) {
      const fx = this.hands[i]!,
        hand = hands.find((candidate) => candidate.hand === (i === 0 ? 'left' : 'right')),
        present = visible && !!hand?.present;
      if (present && !fx.wasPresent) fx.ribbon.reset();
      fx.wasPresent = present;
      const toward = present ? 1 : 0;
      fx.presence += (toward - fx.presence) * Math.min(1, (dt * 1000) / HAND_PRESENCE_FADE_MS);
      const blade = present && !!hand?.bladeActive;
      fx.bladeMix +=
        ((blade ? 1 : 0) - fx.bladeMix) *
        Math.min(1, (dt * 1000) / (blade ? BLADE_MIX_ON_MS : BLADE_MIX_OFF_MS));
      const drawn = fx.ribbon.update(present ? hand : undefined, dt, camera, this.time, fx.presence);
      const uniforms = fx.points.material.uniforms;
      fx.points.visible = fx.presence > 0.01 && !!hand;
      if (!hand || !fx.points.visible) continue;
      (uniforms.uPalm!.value as THREE.Vector3).set(hand.pos.x, hand.pos.y, hand.pos.z);
      (uniforms.uTip!.value as THREE.Vector3).set(hand.tip.x, hand.tip.y, hand.tip.z);
      (uniforms.uPointDir!.value as THREE.Vector2).set(hand.pointDir.x, hand.pointDir.y);
      uniforms.uTime!.value = this.time;
      uniforms.uBand!.value = calm ? 0 : 0.5 * bands.mid + 0.5 * bands.high;
      uniforms.uGesture!.value = GESTURE_CODE[hand.gesture] ?? 0;
      uniforms.uBladeMix!.value = drawn ? fx.bladeMix : 0;
      uniforms.uHeat!.value = Math.min(1, hand.speed / 12);
      uniforms.uPresence!.value = fx.presence;
      uniforms.uTwinkle!.value = calm ? 0 : 1;
      const spine = uniforms.uSpine!.value as Float32Array,
        last = fx.ribbon.sampleCount - 1;
      for (let k = 0; k < SPINE_UNIFORMS; k++) {
        fx.ribbon.sample(Math.round((k / (SPINE_UNIFORMS - 1)) * last), this.sample);
        spine[k * 3] = this.sample.x;
        spine[k * 3 + 1] = this.sample.y;
        spine[k * 3 + 2] = this.sample.z;
      }
    }
  }

  hide(): void {
    for (const fx of this.hands) {
      fx.points.visible = false;
      fx.presence = fx.bladeMix = 0;
      fx.wasPresent = false;
      fx.ribbon.reset();
    }
  }

  dispose(): void {
    for (const fx of this.hands) {
      fx.points.geometry.dispose();
      fx.points.material.dispose();
      fx.ribbon.dispose();
    }
  }
}
