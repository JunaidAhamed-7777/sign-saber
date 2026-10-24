/** Preallocated capped halves. One slot owns its clipper buffers and materials for its whole lifetime. */
import * as THREE from 'three';
import type { GameEvents } from '../core/events';
import type { Vec3, Plane } from '../core/types';
import {
  GRAVITY_MPS2,
  HALF_LIFETIME_MS,
  SLICE_INHERIT,
  SLICE_POOL,
  SLICE_SEPARATION_SPEED,
  SLICE_CAP_HEAT_GAIN,
  SLICE_CAP_HEAT_MS,
  BLOCK_SIZE,
} from '../core/constants';
import { CubeSlicer } from './slicer';
import type { CutHalf, SlicerFaces } from './slicer';
interface HalfMesh {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;
  source: CutHalf;
  origin: Vec3;
  velocity: Vec3;
  axis: THREE.Vector3;
  spin: number;
}
interface SliceSlot {
  slicer: CubeSlicer;
  halves: HalfMesh[];
  active: boolean;
  birth: number;
  base: THREE.Quaternion;
}
const CYAN = new THREE.Color(0x19f5ff),
  WHITE = new THREE.Color(0xe8f1ff);
export class SlicePool {
  private readonly slots: SliceSlot[] = [];
  private index = 0;
  private readonly spin = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly plane: Plane = { normal: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 } };
  fallbackCuts = 0;
  constructor(
    private readonly scene: THREE.Scene,
    private readonly lifetimeMs: number = HALF_LIFETIME_MS,
    /** Convex target shape to cut (default: the cube); the renderer passes the Slash diamond. */
    faces?: SlicerFaces,
  ) {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0)
      throw new RangeError('Invalid sliced-half lifetime.');
    for (let slot = 0; slot < Math.floor(SLICE_POOL / 2); slot++) {
      const slicer = new CubeSlicer(BLOCK_SIZE, faces),
        halves: HalfMesh[] = [];
      for (const source of [slicer.result.positive, slicer.result.negative]) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(source.positions, 3).setUsage(THREE.DynamicDrawUsage),
        );
        geometry.setAttribute(
          'normal',
          new THREE.BufferAttribute(source.normals, 3).setUsage(THREE.DynamicDrawUsage),
        );
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(source.uvs, 2).setUsage(THREE.DynamicDrawUsage),
        );
        geometry.setDrawRange(0, 0);
        geometry.addGroup(0, 0, 0);
        geometry.addGroup(0, 0, 1);
        const body = new THREE.MeshStandardMaterial({
            color: 0x0b2a36,
            emissive: CYAN,
            emissiveIntensity: 0.35,
            metalness: 0.4,
            roughness: 0.3,
            transparent: true,
          }),
          cap = new THREE.MeshStandardMaterial({
            color: WHITE,
            emissive: 0x8ff8ff,
            emissiveIntensity: 1,
            roughness: 0.25,
            transparent: true,
          });
        const mesh = new THREE.Mesh(geometry, [body, cap]);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.layers.set(1);
        this.scene.add(mesh);
        halves.push({
          mesh,
          source,
          origin: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          axis: new THREE.Vector3(0, 1, 0),
          spin: 0,
        });
      }
      this.slots.push({ slicer, halves, active: false, birth: 0, base: new THREE.Quaternion() });
    }
  }
  trigger(event: GameEvents['note:hit'], time: number, center: Vec3, rotationZ = 0): void {
    const slot = this.slots[this.index++ % this.slots.length]!,
      normal = event.cutPlane?.normal ?? this.plane.normal,
      point = event.cutPlane?.point ?? center,
      c = Math.cos(rotationZ),
      s = Math.sin(rotationZ);
    const nx = normal.x,
      ny = normal.y,
      nz = normal.z;
    this.plane.normal.x = nx * c + ny * s;
    this.plane.normal.y = -nx * s + ny * c;
    this.plane.normal.z = nz;
    const px = point.x - center.x,
      py = point.y - center.y;
    this.plane.point.x = px * c + py * s;
    this.plane.point.y = -px * s + py * c;
    this.plane.point.z = point.z - center.z;
    const result = slot.slicer.cut(this.plane);
    if (result.fallback) this.fallbackCuts++;
    const worldNX = result.normal.x * c - result.normal.y * s,
      worldNY = result.normal.x * s + result.normal.y * c,
      worldNZ = result.normal.z;
    slot.active = true;
    slot.birth = time;
    slot.base.setFromAxisAngle(this.zAxis, rotationZ);
    for (let i = 0; i < 2; i++) {
      const half = slot.halves[i]!,
        source = half.source,
        pivot = source.centroid,
        sign = i === 0 ? 1 : -1;
      for (let vertex = 0; vertex < source.count; vertex++) {
        source.positions[vertex * 3] = source.positions[vertex * 3]! - pivot.x;
        source.positions[vertex * 3 + 1] = source.positions[vertex * 3 + 1]! - pivot.y;
        source.positions[vertex * 3 + 2] = source.positions[vertex * 3 + 2]! - pivot.z;
      }
      half.origin.x = center.x + pivot.x * c - pivot.y * s;
      half.origin.y = center.y + pivot.x * s + pivot.y * c;
      half.origin.z = center.z + pivot.z;
      half.velocity.x = event.impactVel.x * SLICE_INHERIT + worldNX * sign * SLICE_SEPARATION_SPEED;
      half.velocity.y = event.impactVel.y * SLICE_INHERIT + worldNY * sign * SLICE_SEPARATION_SPEED + 0.6;
      half.velocity.z = worldNZ * sign * SLICE_SEPARATION_SPEED;
      const phase = event.note.id * 1.618 + i * 2.399;
      half.axis
        .set(
          result.normal.x * 0.7 + Math.sin(phase) * 0.3,
          result.normal.y * 0.7 + Math.cos(phase) * 0.3,
          result.normal.z * 0.7 + Math.sin(phase * 2) * 0.3,
        )
        .normalize();
      half.spin = (2 + (3 * ((event.note.id * 17 + i * 13) % 31)) / 31) * sign;
      const geometry = half.mesh.geometry;
      geometry.setDrawRange(0, source.count);
      geometry.groups[0]!.count = source.bodyCount;
      geometry.groups[1]!.start = source.bodyCount;
      geometry.groups[1]!.count = source.count - source.bodyCount;
      for (const name of ['position', 'normal', 'uv']) geometry.getAttribute(name).needsUpdate = true;
    }
  }
  update(time: number, visible: boolean, calm: boolean): void {
    for (const slot of this.slots) {
      const age = time - slot.birth;
      if (slot.active && (age < 0 || age > this.lifetimeMs)) slot.active = false;
      for (const half of slot.halves) {
        half.mesh.visible = slot.active && visible;
        if (!slot.active) continue;
        const t = age / 1000,
          fade = 1 - Math.max(0, (age / this.lifetimeMs - 0.6) / 0.4);
        half.mesh.position.set(
          half.origin.x + half.velocity.x * t,
          half.origin.y + half.velocity.y * t - GRAVITY_MPS2 * 0.5 * t * t,
          half.origin.z + half.velocity.z * t,
        );
        this.spin.setFromAxisAngle(half.axis, calm ? 0 : half.spin * t);
        half.mesh.quaternion.copy(slot.base).multiply(this.spin);
        for (const material of half.mesh.material) material.opacity = fade;
        // Cross-section starts white-hot and cools to the block colour (steady tint in Calm).
        const heat = calm ? 0 : Math.max(0, 1 - age / SLICE_CAP_HEAT_MS);
        half.mesh.material[1]!.color.copy(CYAN).lerp(WHITE, heat);
        half.mesh.material[1]!.emissiveIntensity = 1 + heat * SLICE_CAP_HEAT_GAIN;
      }
    }
  }
  get occupancy(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count += 2;
    return count;
  }
  get oldestBirth(): number {
    let time = Infinity;
    for (const slot of this.slots) if (slot.active) time = Math.min(time, slot.birth);
    return time;
  }
  releaseOldest(): boolean {
    let oldest: SliceSlot | null = null;
    for (const slot of this.slots) if (slot.active && (!oldest || slot.birth < oldest.birth)) oldest = slot;
    if (!oldest) return false;
    oldest.active = false;
    for (const half of oldest.halves) half.mesh.visible = false;
    return true;
  }
  reset(): void {
    for (const slot of this.slots) {
      slot.active = false;
      for (const half of slot.halves) half.mesh.visible = false;
    }
    this.index = 0;
  }
  dispose(): void {
    for (const slot of this.slots)
      for (const half of slot.halves) {
        this.scene.remove(half.mesh);
        half.mesh.geometry.dispose();
        for (const material of half.mesh.material) material.dispose();
      }
    this.slots.length = 0;
  }
}
