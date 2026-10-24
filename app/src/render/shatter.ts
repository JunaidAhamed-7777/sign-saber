/**
 * Sign Saber — render/shatter.ts
 *
 * Responsibility: Pre-fractured shard instancing with burst + ballistic motion.
 * Spec: docs/11-rendering-blocks-and-destruction.md §Shatter
 * Inputs: note:hit (smash)
 * Outputs: Shard instances
 *
 * Implements a bounded instanced pool for verified authored shards or complete eight-octant fallback.
 */
import * as THREE from 'three';
import type { GameEvents } from '../core/events';
import type { ShardAsset } from './assets';
import {
  BLOCK_SIZE,
  FRAGMENT_LIFETIME_MS,
  GRAVITY_MPS2,
  LANE_X,
  LANE_Y,
  MAX_FRAGMENTS,
  SHATTER_BURST_MIN,
  SHATTER_BURST_MAX,
  SHATTER_INHERIT,
  SHATTER_POOL,
  SHARD_FLASH_MS,
  SHATTER_DEPTH_FRACTION,
  SHATTER_RECEDE_MPS,
} from '../core/constants';
import { createShardMaterial, createTargetUniforms } from './blocks';

const SMASH = new THREE.Color(0xff2bd6),
  WHITE = new THREE.Color(0xffffff);
interface ShatterSlot {
  active: boolean;
  birth: number;
  positions: Float32Array;
  velocities: Float32Array;
  rotations: Float32Array;
}
/** One instanced draw per shard shape; all session-owned transform buffers are prepared before play. */
export class ShatterPool {
  private meshes: THREE.InstancedMesh[] = [];
  private slots: ShatterSlot[] = [];
  private shards: readonly ShardAsset[] = [];
  private index = 0;
  private readonly transform = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  constructor(
    private readonly scene: THREE.Scene,
    shards: readonly ShardAsset[],
    private readonly lifetimeMs: number = FRAGMENT_LIFETIME_MS,
    /** Shard surface material; fracture faces are distinguished by the geometry's `aInner` flag. */
    readonly material: THREE.Material = createShardMaterial(createTargetUniforms()),
  ) {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) throw new RangeError('Invalid shatter lifetime.');
    this.configure(shards);
  }
  configure(shards: readonly ShardAsset[]): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.shards = shards;
    const capacity = Math.min(SHATTER_POOL, Math.floor(MAX_FRAGMENTS / (shards.length + 4)));
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      birth: 0,
      positions: new Float32Array(shards.length * 3),
      velocities: new Float32Array(shards.length * 3),
      rotations: new Float32Array(shards.length),
    }));
    for (const shard of shards) {
      const mesh = new THREE.InstancedMesh(shard.geometry, this.material, capacity);
      mesh.name = `smash_shard_${this.meshes.length}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.layers.set(1);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, SMASH);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.index = 0;
  }
  trigger(event: GameEvents['note:hit'], time: number): void {
    const slot = this.slots[this.index++ % this.slots.length]!;
    slot.active = true;
    slot.birth = time;
    for (let i = 0; i < this.shards.length; i++) {
      const offset = this.shards[i]!.offset,
        at = i * 3;
      slot.positions[at] = LANE_X[event.note.col] + offset.x * BLOCK_SIZE;
      slot.positions[at + 1] = LANE_Y[event.note.row] + offset.y * BLOCK_SIZE;
      slot.positions[at + 2] = event.impactPos.z + offset.z * BLOCK_SIZE;
      const phase = event.note.id * 1.618 + i * 2.399;
      const rx = offset.x + Math.sin(phase) * 0.15,
        ry = offset.y + Math.cos(phase) * 0.15,
        rz = offset.z + Math.sin(phase * 2) * 0.15;
      // Pieces farther from the struck front face leave slower, so the burst reads as starting at the fist.
      const length = Math.hypot(rx, ry, rz) || 1,
        fromImpact = Math.hypot(offset.x, offset.y, offset.z - 0.5),
        speed =
          (SHATTER_BURST_MIN +
            ((SHATTER_BURST_MAX - SHATTER_BURST_MIN) * ((event.note.id * 17 + i * 13) % 31)) / 31) *
          (1 - 0.3 * Math.min(1, fromImpact));
      slot.velocities[at] = event.impactVel.x * SHATTER_INHERIT + (rx / length) * speed;
      slot.velocities[at + 1] = event.impactVel.y * SHATTER_INHERIT + (ry / length) * speed;
      // Burst sideways and away from the camera; pieces never fly into the player's view.
      slot.velocities[at + 2] = (rz / length) * speed * SHATTER_DEPTH_FRACTION - SHATTER_RECEDE_MPS;
      slot.rotations[i] = phase;
    }
  }
  update(time: number, visible: boolean, calm: boolean): void {
    let count = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const age = time - slot.birth;
      if (age < 0 || age > this.lifetimeMs) {
        slot.active = false;
        continue;
      }
      const seconds = age / 1000,
        // Pieces shrink steadily from the burst so the near field clears quickly.
        fade = 1 - 0.85 * Math.min(1, age / this.lifetimeMs) ** 0.8,
        // White-hot for SHARD_FLASH_MS (never in Calm), then the fracture faces cool over the lifetime.
        flash = calm ? 0 : Math.max(0, 1 - age / SHARD_FLASH_MS);
      this.tint
        .copy(SMASH)
        .lerp(WHITE, flash * 0.6)
        .multiplyScalar((1 + flash * 0.5) * (1 - 0.45 * (age / this.lifetimeMs)));
      for (let i = 0; i < this.meshes.length; i++) {
        this.meshes[i]!.setColorAt(count, this.tint);
        const at = i * 3;
        this.transform.position.set(
          slot.positions[at]! + slot.velocities[at]! * seconds,
          slot.positions[at + 1]! +
            slot.velocities[at + 1]! * seconds -
            GRAVITY_MPS2 * 0.5 * seconds * seconds,
          slot.positions[at + 2]! + slot.velocities[at + 2]! * seconds,
        );
        const spin = calm ? 0 : slot.rotations[i]! * seconds;
        this.transform.rotation.set(spin, spin * 0.5, spin * 0.25);
        this.transform.scale.setScalar(BLOCK_SIZE * fade);
        this.transform.updateMatrix();
        this.meshes[i]!.setMatrixAt(count, this.transform.matrix);
      }
      count++;
    }
    for (const mesh of this.meshes) {
      mesh.count = count;
      mesh.visible = visible;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  get occupancy(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += this.shards.length;
    return count;
  }
  get oldestBirth(): number {
    let time = Infinity;
    for (const slot of this.slots) if (slot.active) time = Math.min(time, slot.birth);
    return time;
  }
  releaseOldest(): boolean {
    let oldest: ShatterSlot | null = null;
    for (const slot of this.slots) if (slot.active && (!oldest || slot.birth < oldest.birth)) oldest = slot;
    if (!oldest) return false;
    oldest.active = false;
    return true;
  }
  reset(): void {
    for (const slot of this.slots) slot.active = false;
    for (const mesh of this.meshes) mesh.count = 0;
    this.index = 0;
  }
  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.slots = [];
    this.material.dispose();
  }
}
