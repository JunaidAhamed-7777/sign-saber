import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SlicePool } from '../src/render/slices';
import type { GameEvents } from '../src/core/events';
import { HALF_LIFETIME_MS, SLICE_POOL } from '../src/core/constants';
const hit: GameEvents['note:hit'] = {
  note: { id: 0, t: 1000, type: 'slash', col: 2, row: 1, dir: 'any', strength: 1 },
  judgement: 'perfect',
  timingErrorMs: 0,
  hand: 'right',
  cutPlane: { normal: { x: 0, y: 1, z: 0 }, point: { x: 1, y: 2.05, z: 0 } },
  impactPos: { x: 1, y: 2.05, z: 0 },
  impactVel: { x: 4, y: 0, z: 0 },
  scoreDelta: 100,
  combo: 1,
  multiplier: 1,
};
describe('visible swing-plane slice pool', () => {
  it('transforms the plane through a rotated block and preserves its world-space cap', () => {
    const scene = new THREE.Scene(),
      pool = new SlicePool(scene);
    pool.trigger(hit, 0, { x: 1, y: 2, z: 0 }, Math.PI / 4);
    pool.update(0, true, false);
    const point = new THREE.Vector3();
    let caps = 0;
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.visible) continue;
      mesh.updateMatrixWorld(true);
      const geometry = mesh.geometry,
        position = geometry.getAttribute('position'),
        cap = geometry.groups[1]!;
      for (let i = cap.start; i < cap.start + cap.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        expect(point.y).toBeCloseTo(2.05, 5);
        caps++;
      }
    }
    expect(caps).toBeGreaterThan(0);
    expect(pool.fallbackCuts).toBe(0);
    expect(pool.occupancy).toBe(2);
    pool.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('keeps allocation capacity fixed, freezes by song time and clears every owned half', () => {
    const scene = new THREE.Scene(),
      pool = new SlicePool(scene);
    for (let i = 0; i < 20; i++) pool.trigger(hit, 0, { x: 1, y: 2, z: 0 });
    expect(scene.children).toHaveLength(SLICE_POOL);
    expect(pool.occupancy).toBe(SLICE_POOL);
    pool.update(100, true, false);
    const before = scene.children.map((child) => [
      ...child.position.toArray(),
      ...child.quaternion.toArray(),
    ]);
    pool.update(100, true, false);
    expect(
      scene.children.map((child) => [...child.position.toArray(), ...child.quaternion.toArray()]),
    ).toEqual(before);
    pool.update(HALF_LIFETIME_MS + 1, true, false);
    expect(pool.occupancy).toBe(0);
    expect(scene.children.every((child) => !child.visible)).toBe(true);
    pool.reset();
    pool.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
