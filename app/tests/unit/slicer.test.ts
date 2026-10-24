import { describe, expect, it } from 'vitest';
import { CubeSlicer } from '../../src/render/slicer';
import type { CutHalf } from '../../src/render/slicer';
import { BLOCK_SIZE } from '../../src/core/constants';
import { seededRandom } from '../../src/utils/math';
function closed(half: CutHalf): boolean {
  const unique: number[][] = [],
    indices: number[] = [];
  for (let i = 0; i < half.count; i++) {
    const p = [half.positions[i * 3]!, half.positions[i * 3 + 1]!, half.positions[i * 3 + 2]!];
    let index = unique.findIndex(
      (v) => (v[0]! - p[0]!) ** 2 + (v[1]! - p[1]!) ** 2 + (v[2]! - p[2]!) ** 2 < 1e-10,
    );
    if (index < 0) {
      index = unique.length;
      unique.push(p);
    }
    indices.push(index);
  }
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3)
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[i + edge]!,
        b = indices[i + ((edge + 1) % 3)]!;
      if (a === b) return false;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  return [...edges.values()].every((count) => count === 2);
}
describe('bounded exact convex cube cuts', () => {
  it('conserves volume, closes both meshes and keeps caps planar for 200 seeded swing planes', () => {
    const random = seededRandom(270),
      slicer = new CubeSlicer(),
      storage = slicer.result.positive.positions;
    for (let run = 0; run < 200; run++) {
      const x = random() * 2 - 1,
        y = random() * 2 - 1,
        z = random() * 2 - 1,
        length = Math.hypot(x, y, z),
        normal = { x: x / length, y: y / length, z: z / length },
        offset = (random() - 0.5) * 0.5;
      const result = slicer.cut({
        normal,
        point: { x: normal.x * offset, y: normal.y * offset, z: normal.z * offset },
      });
      expect(result.fallback).toBe(false);
      expect(result.positive.positions).toBe(storage);
      expect(result.positive.volume + result.negative.volume).toBeCloseTo(BLOCK_SIZE ** 3, 5);
      for (const [half, sign] of [
        [result.positive, 1],
        [result.negative, -1],
      ] as const) {
        expect(half.count).toBeLessThanOrEqual(128);
        expect(closed(half), `unclosed ${run}/${sign}`).toBe(true);
        for (let vertex = 0; vertex < half.count; vertex++) {
          const at = vertex * 3,
            signed =
              normal.x * half.positions[at]! +
              normal.y * half.positions[at + 1]! +
              normal.z * half.positions[at + 2]! -
              offset;
          expect(signed * sign).toBeGreaterThanOrEqual(-1e-5);
          if (half.caps[vertex] === 1) expect(Math.abs(signed)).toBeLessThan(1e-5);
          expect(Number.isFinite(half.positions[at])).toBe(true);
        }
      }
    }
  });
  it('handles face, edge, vertex, tangent, missed and invalid planes without NaNs or slivers', () => {
    const slicer = new CubeSlicer();
    for (const plane of [
      { normal: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 } },
      { normal: { x: 1, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 } },
      { normal: { x: 1, y: 1, z: 1 }, point: { x: 0.1, y: 0.1, z: 0.1 } },
      { normal: { x: 1, y: 0, z: 0 }, point: { x: 0.3, y: 0, z: 0 } },
      { normal: { x: 1, y: 0, z: 0 }, point: { x: 5, y: 0, z: 0 } },
      { normal: { x: 0, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 } },
      { normal: { x: NaN, y: 1, z: 0 }, point: { x: Infinity, y: 0, z: 0 } },
    ]) {
      const cut = slicer.cut(plane);
      expect(closed(cut.positive)).toBe(true);
      expect(closed(cut.negative)).toBe(true);
      expect(cut.positive.volume).toBeGreaterThan(0);
      expect(cut.negative.volume).toBeGreaterThan(0);
      expect(cut.positive.volume + cut.negative.volume).toBeCloseTo(BLOCK_SIZE ** 3, 5);
    }
  });
});
