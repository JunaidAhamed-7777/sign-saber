import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PoofPool } from '../src/render/poof';
import type { GameEvents } from '../src/core/events';
import {
  BLOCK_SIZE,
  GRAVITY_MPS2,
  POOF_GRAVITY_SCALE,
  POOF_LIFETIME_MS,
  POOF_POOL,
  POOF_POWERDOWN_MS,
  POOF_SPARKS,
  POOF_SPARK_SPEED_MAX,
  POOF_SPARK_SPEED_MIN,
  POOF_TARGET_SCALE,
} from '../src/core/constants';
function hit(id = 7): GameEvents['note:hit'] {
  return {
    note: { id, t: 1000, type: 'beam', col: 2, row: 1, dir: 'any', strength: 1 },
    judgement: 'perfect',
    timingErrorMs: 0,
    hand: 'right',
    impactPos: { x: 0.6, y: 2.1, z: -14 },
    impactVel: { x: 0, y: 0, z: 0 },
    scoreDelta: 100,
    combo: 1,
    multiplier: 1,
  };
}
const center = { x: 0.6, y: 2.1, z: -14 };
function spark(scene: THREE.Scene, index = 0): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  return scene.getObjectByName(`poof_sparks_${index}`) as THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
}
function target(scene: THREE.Scene, index = 0): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  return scene.getObjectByName(`poof_target_${index}`) as THREE.Mesh<
    THREE.BoxGeometry,
    THREE.MeshStandardMaterial
  >;
}
describe('whole-target beam poof', () => {
  it('powers down and collapses one intact target, emitting Points rather than debris boxes', () => {
    const scene = new THREE.Scene(),
      pool = new PoofPool(scene);
    expect(pool.trigger(hit(), 100, center)).toBe(true);
    pool.update(100, true, false);
    expect(target(scene).visible).toBe(true);
    expect(target(scene).scale.x).toBe(POOF_TARGET_SCALE);
    expect(spark(scene).visible).toBe(false);
    const emission = target(scene).material.emissiveIntensity;
    pool.update(175, true, false);
    expect(target(scene).material.emissiveIntensity).toBeLessThan(emission);
    pool.update(100 + POOF_POWERDOWN_MS, true, false);
    expect(target(scene).material.emissiveIntensity).toBe(0);
    expect(spark(scene).visible).toBe(true);
    expect(spark(scene).geometry.getAttribute('position').count).toBe(POOF_SPARKS);
    pool.update(500, true, false);
    expect(target(scene).scale.x).toBeLessThan(POOF_TARGET_SCALE);
    expect(
      scene.children.filter(
        (object) =>
          object.visible && object instanceof THREE.Mesh && object.geometry instanceof THREE.BoxGeometry,
      ),
    ).toHaveLength(1);
    expect(scene.children.some((object) => object instanceof THREE.InstancedMesh)).toBe(false);
    pool.dispose();
  });
  it('releases exactly at the inclusive700ms deadline and clears all visual channels', () => {
    const scene = new THREE.Scene(),
      pool = new PoofPool(scene);
    pool.trigger(hit(), 100, center);
    pool.update(100 + POOF_LIFETIME_MS - 1, true, false);
    expect(pool.occupancy).toBe(POOF_SPARKS);
    pool.update(100 + POOF_LIFETIME_MS, true, false);
    expect(pool.occupancy).toBe(0);
    expect(scene.children.every((object) => !object.visible)).toBe(true);
    pool.dispose();
  });
  it('uses deterministic note seeds, registered radial speeds and a closed-form gravity path', () => {
    const firstScene = new THREE.Scene(),
      secondScene = new THREE.Scene(),
      first = new PoofPool(firstScene),
      second = new PoofPool(secondScene);
    first.trigger(hit(11), 0, center);
    second.trigger(hit(11), 0, center);
    const milliseconds = 1,
      seconds = milliseconds / 1000;
    first.update(POOF_POWERDOWN_MS + milliseconds, true, false);
    second.update(POOF_POWERDOWN_MS + milliseconds, true, false);
    const p = spark(firstScene).geometry.getAttribute('position');
    expect(Array.from(p.array)).toEqual(
      Array.from(spark(secondScene).geometry.getAttribute('position').array),
    );
    for (let i = 0; i < POOF_SPARKS; i++) {
      const vx = p.getX(i) / seconds,
        vy = (p.getY(i) + GRAVITY_MPS2 * POOF_GRAVITY_SCALE * 0.5 * seconds * seconds) / seconds,
        vz = p.getZ(i) / seconds,
        speed = Math.hypot(vx, vy, vz);
      expect(speed).toBeGreaterThanOrEqual(POOF_SPARK_SPEED_MIN - 1e-5);
      expect(speed).toBeLessThanOrEqual(POOF_SPARK_SPEED_MAX + 1e-5);
    }
    first.update(400, true, false);
    const frozen = Array.from(p.array);
    first.update(400, true, false);
    expect(Array.from(p.array)).toEqual(frozen);
    second.reset();
    second.trigger(hit(12), 0, center);
    second.update(400, true, false);
    expect(Array.from(spark(secondScene).geometry.getAttribute('position').array)).not.toEqual(frozen);
    first.dispose();
    second.dispose();
  });
  it('keeps Calm tint/ring steady and suppresses the flash while preserving collapse and spark feedback', () => {
    const scene = new THREE.Scene(),
      pool = new PoofPool(scene);
    pool.trigger(hit(), 0, center);
    pool.update(130, true, true);
    const ring = scene.getObjectByName('poof_ring_0')!,
      flash = scene.getObjectByName('poof_flash_0')!;
    expect(flash.visible).toBe(false);
    expect(ring.scale.x).toBeCloseTo(BLOCK_SIZE * POOF_TARGET_SCALE);
    expect(target(scene).material.emissiveIntensity).toBe(0);
    pool.update(400, true, true);
    const tint = spark(scene).material.color.getHex();
    expect(spark(scene).visible).toBe(true);
    pool.update(600, true, true);
    expect(spark(scene).material.color.getHex()).toBe(tint);
    expect(ring.scale.x).toBeCloseTo(BLOCK_SIZE * POOF_TARGET_SCALE);
    expect(flash.visible).toBe(false);
    pool.dispose();
  });
  it('rejects repeated hits, reserves bounded spark capacity and reuses every warmed buffer', () => {
    const scene = new THREE.Scene(),
      pool = new PoofPool(scene),
      storage = scene.children
        .filter((object) => object instanceof THREE.Points)
        .map((object) => (object as THREE.Points).geometry.getAttribute('position').array);
    expect(pool.trigger(hit(), 0, center)).toBe(true);
    expect(pool.trigger(hit(), 0, center)).toBe(false);
    for (let i = 0; i < POOF_POOL + 20; i++) pool.trigger(hit(100 + i), i, center);
    expect(pool.occupancy).toBe(POOF_POOL * POOF_SPARKS);
    expect(scene.children).toHaveLength(POOF_POOL * 4);
    expect(
      scene.children
        .filter((object) => object instanceof THREE.Points)
        .every(
          (object, index) =>
            (object as THREE.Points).geometry.getAttribute('position').array === storage[index],
        ),
    ).toBe(true);
    expect(pool.releaseOldest()).toBe(true);
    expect(pool.occupancy).toBe((POOF_POOL - 1) * POOF_SPARKS);
    pool.reset();
    expect(pool.occupancy).toBe(0);
    pool.dispose();
  });
  it('disposes owned geometry/material/texture resources once and never revives after disposal', () => {
    const scene = new THREE.Scene(),
      pool = new PoofPool(scene),
      geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    let disposedGeometry = 0,
      disposedMaterial = 0,
      disposedTexture = 0;
    for (const object of scene.children) {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        materials.add(object.material as THREE.Material);
      } else if (object instanceof THREE.Sprite) materials.add(object.material);
    }
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposedGeometry++);
    for (const material of materials) material.addEventListener('dispose', () => disposedMaterial++);
    spark(scene).material.map!.addEventListener('dispose', () => disposedTexture++);
    pool.dispose();
    pool.dispose();
    expect(disposedGeometry).toBe(POOF_POOL + 2);
    expect(disposedMaterial).toBe(POOF_POOL * 4);
    expect(disposedTexture).toBe(1);
    expect(scene.children).toHaveLength(0);
    expect(pool.trigger(hit(), 0, center)).toBe(false);
  });
});
