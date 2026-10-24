/**
 * Sign Saber — render/poof.ts
 *
 * Responsibility: Beam destruction: emissive power-down, shrink, sparks.
 * Spec: docs/11-rendering-blocks-and-destruction.md §Poof
 * Inputs: note:hit (beam) only; beam:fire owns its separate ray.
 * Outputs: Effect
 *
 * Six complete pooled power-down effects; no pieces or halves are spawned.
 */
import * as THREE from 'three';
import type { GameEvents } from '../core/events';
import type { Vec3 } from '../core/types';
import {
  BLOCK_SIZE,
  GRAVITY_MPS2,
  POOF_LIFETIME_MS,
  POOF_POOL,
  POOF_SPARKS,
  POOF_POWERDOWN_MS,
  POOF_FLASH_DELAY_MS,
  POOF_FLASH_MS,
  POOF_RING_MS,
  POOF_FLASH_SIZE_M,
  POOF_RING_START_M,
  POOF_RING_END_M,
  POOF_SPARK_SPEED_MIN,
  POOF_SPARK_SPEED_MAX,
  POOF_SPARK_SIZE_M,
  POOF_GRAVITY_SCALE,
  POOF_TARGET_SCALE,
} from '../core/constants';
const GOLD = new THREE.Color(0xffc32b),
  DIM_RED = new THREE.Color(0x5a1a0a),
  DARK = new THREE.Color(0x080b12);
interface PoofSlot {
  active: boolean;
  birth: number;
  noteId: number;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Sprite;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: Float32Array;
  velocities: Float32Array;
}
function unitNoise(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
function softCircle(): THREE.DataTexture {
  const size = 32,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1),
        alpha = Math.max(0, 1 - radius) ** 2,
        at = (y * size + x) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
      pixels[at + 3] = Math.round(alpha * 255);
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
export class PoofPool {
  private readonly slots: PoofSlot[] = [];
  private readonly targetGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  private readonly ringGeometry = new THREE.RingGeometry(0.46, 0.5, 48);
  private readonly texture = softCircle();
  private index = 0;
  private disposed = false;
  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < POOF_POOL; i++) {
      const positions = new Float32Array(POOF_SPARKS * 3),
        velocities = new Float32Array(POOF_SPARKS * 3),
        sparkGeometry = new THREE.BufferGeometry();
      sparkGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      const body = new THREE.Mesh(
        this.targetGeometry,
        new THREE.MeshStandardMaterial({
          color: GOLD,
          emissive: GOLD,
          emissiveIntensity: 1,
          roughness: 0.3,
          metalness: 0.35,
          transparent: true,
        }),
      );
      const ring = new THREE.Mesh(
        this.ringGeometry,
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthWrite: false, opacity: 0 }),
      );
      const flash = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: GOLD,
          map: this.texture,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      const sparks = new THREE.Points(
        sparkGeometry,
        new THREE.PointsMaterial({
          color: GOLD,
          map: this.texture,
          size: POOF_SPARK_SIZE_M,
          sizeAttenuation: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      body.name = `poof_target_${i}`;
      ring.name = `poof_ring_${i}`;
      flash.name = `poof_flash_${i}`;
      sparks.name = `poof_sparks_${i}`;
      for (const object of [body, ring, flash, sparks]) {
        object.visible = false;
        object.layers.set(1);
        object.frustumCulled = false;
        this.scene.add(object);
      }
      this.slots.push({
        active: false,
        birth: 0,
        noteId: -1,
        body,
        ring,
        flash,
        sparks,
        positions,
        velocities,
      });
    }
  }
  trigger(event: GameEvents['note:hit'], time: number, center: Vec3): boolean {
    if (
      this.disposed ||
      event.note.type !== 'beam' ||
      !Number.isInteger(event.note.id) ||
      event.note.id < 0 ||
      !Number.isFinite(time) ||
      !Number.isFinite(center.x) ||
      !Number.isFinite(center.y) ||
      !Number.isFinite(center.z)
    )
      return false;
    for (const slot of this.slots) if (slot.active && slot.noteId === event.note.id) return false;
    const slot = this.slots[this.index++ % this.slots.length]!;
    slot.active = true;
    slot.birth = time;
    slot.noteId = event.note.id;
    slot.body.position.set(center.x, center.y, center.z);
    slot.ring.position.set(center.x, center.y, center.z + (BLOCK_SIZE * POOF_TARGET_SCALE) / 2);
    slot.flash.position.copy(slot.ring.position);
    slot.sparks.position.copy(slot.body.position);
    slot.flash.scale.setScalar(POOF_FLASH_SIZE_M);
    for (let i = 0; i < POOF_SPARKS; i++) {
      const at = i * 3,
        z = unitNoise(event.note.id, i * 3) * 2 - 1,
        angle = unitNoise(event.note.id, i * 3 + 1) * Math.PI * 2,
        radius = Math.sqrt(Math.max(0, 1 - z * z)),
        speed =
          POOF_SPARK_SPEED_MIN +
          (POOF_SPARK_SPEED_MAX - POOF_SPARK_SPEED_MIN) * unitNoise(event.note.id, i * 3 + 2);
      slot.velocities[at] = Math.cos(angle) * radius * speed;
      slot.velocities[at + 1] = Math.sin(angle) * radius * speed;
      slot.velocities[at + 2] = z * speed;
      slot.positions[at] = slot.positions[at + 1] = slot.positions[at + 2] = 0;
    }
    return true;
  }
  update(time: number, visible: boolean, calm: boolean): void {
    for (const slot of this.slots) {
      const age = time - slot.birth;
      if (slot.active && (age < 0 || age >= POOF_LIFETIME_MS)) slot.active = false;
      slot.body.visible = slot.active && visible;
      slot.ring.visible = slot.active && visible;
      slot.flash.visible = false;
      slot.sparks.visible = false;
      if (!slot.active) continue;
      const power = Math.max(0, 1 - age / POOF_POWERDOWN_MS),
        progress = Math.max(0, (age - POOF_POWERDOWN_MS) / (POOF_LIFETIME_MS - POOF_POWERDOWN_MS)),
        collapse = 1 - progress ** 3;
      slot.body.scale.setScalar(POOF_TARGET_SCALE * collapse);
      slot.body.material.color.copy(calm ? DARK : GOLD).lerp(DARK, 1 - power);
      slot.body.material.emissiveIntensity = calm ? 0 : power;
      slot.body.material.opacity = 0.75 * collapse;
      if (calm) {
        slot.ring.scale.setScalar(BLOCK_SIZE * POOF_TARGET_SCALE);
        slot.ring.material.opacity = 0.35 * (1 - progress);
      } else {
        const ringProgress = (age - POOF_FLASH_DELAY_MS) / POOF_RING_MS;
        slot.ring.visible = visible && ringProgress >= 0 && ringProgress < 1;
        slot.ring.scale.setScalar(
          POOF_RING_START_M + (POOF_RING_END_M - POOF_RING_START_M) * Math.max(0, ringProgress),
        );
        slot.ring.material.opacity = Math.max(0, Math.min(1, 1 - ringProgress));
        const flashProgress = (age - POOF_FLASH_DELAY_MS) / POOF_FLASH_MS;
        slot.flash.visible = visible && flashProgress >= 0 && flashProgress < 1;
        (slot.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, 1 - flashProgress));
      }
      if (age >= POOF_POWERDOWN_MS) {
        const seconds = (age - POOF_POWERDOWN_MS) / 1000;
        slot.sparks.visible = visible;
        for (let i = 0; i < POOF_SPARKS; i++) {
          const at = i * 3;
          slot.positions[at] = slot.velocities[at]! * seconds;
          slot.positions[at + 1] =
            slot.velocities[at + 1]! * seconds - GRAVITY_MPS2 * POOF_GRAVITY_SCALE * 0.5 * seconds * seconds;
          slot.positions[at + 2] = slot.velocities[at + 2]! * seconds;
        }
        slot.sparks.geometry.getAttribute('position').needsUpdate = true;
        slot.sparks.material.color.copy(GOLD).lerp(DIM_RED, calm ? 0 : progress);
        slot.sparks.material.size = POOF_SPARK_SIZE_M * (1 - progress);
        slot.sparks.material.opacity = 1 - progress;
      }
    }
  }
  get occupancy(): number {
    let total = 0;
    for (const slot of this.slots) if (slot.active) total += POOF_SPARKS;
    return total;
  }
  get oldestBirth(): number {
    let time = Infinity;
    for (const slot of this.slots) if (slot.active) time = Math.min(time, slot.birth);
    return time;
  }
  releaseOldest(): boolean {
    let oldest: PoofSlot | null = null;
    for (const slot of this.slots) if (slot.active && (!oldest || slot.birth < oldest.birth)) oldest = slot;
    if (!oldest) return false;
    oldest.active = false;
    oldest.body.visible = oldest.ring.visible = oldest.flash.visible = oldest.sparks.visible = false;
    return true;
  }
  reset(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.noteId = -1;
      slot.body.visible = slot.ring.visible = slot.flash.visible = slot.sparks.visible = false;
    }
    this.index = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      for (const object of [slot.body, slot.ring, slot.flash, slot.sparks]) this.scene.remove(object);
      slot.body.material.dispose();
      slot.ring.material.dispose();
      slot.flash.material.dispose();
      slot.sparks.material.dispose();
      slot.sparks.geometry.dispose();
    }
    this.targetGeometry.dispose();
    this.ringGeometry.dispose();
    this.texture.dispose();
    this.slots.length = 0;
  }
}
