/**
 * Sign Saber — utils/math.ts
 *
 * Responsibility: Vec2/Vec3 helpers, lerp, damp, clamp, plane/OBB helpers.
 * Spec: docs/07; docs/11
 * Inputs: —
 * Outputs: Functions
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { Vec2, Vec3 } from '../core/types';

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-rate * dt));
export const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const distance2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const finite3 = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
export function normalize3(v: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const length = length3(v);
  out.x = length > 0 ? v.x / length : 0;
  out.y = length > 0 ? v.y / length : 0;
  out.z = length > 0 ? v.z / length : 0;
  return out;
}
export function cross3(a: Vec3, b: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  out.z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  return out;
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
