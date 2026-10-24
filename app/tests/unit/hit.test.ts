/**
 * Sign Saber — tests/unit/hit.test.ts
 *
 * Responsibility: Contact tests: sphere vs OBB, swept blade segment vs OBB (no tunnelling at 12 m/s), beam aim radius, obstacle vs lean.
 * Spec: docs/07-hit-detection-and-scoring.md §14
 * Inputs: —
 * Outputs: —
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import { describe, expect, it } from 'vitest';
import {
  palmContact,
  sweptPalmContact,
  sweptBladeContact,
  makeCutPlane,
  beamAimTarget,
  segmentAABB,
} from '../../src/game/hit';
import { seededRandom } from '../../src/utils/math';
import { LANE_DIRECTION, notePosition } from '../../src/game/liveObjects';
import { BLOCK_SIZE, HAND_HIT_RADIUS, LANE_X, LANE_Y, SPAWN_DISTANCE } from '../../src/core/constants';
import type { Note } from '../../src/beatmap/types';

describe('continuous measured contact', () => {
  const target = { x: 0, y: 0 };
  it('uses rounded palm tolerance rather than an expanded square', () => {
    expect(palmContact(target, target)).toBe(true);
    expect(palmContact({ x: BLOCK_SIZE / 2 + HAND_HIT_RADIUS + 0.001, y: 0 }, target)).toBe(false);
    expect(sweptPalmContact({ x: -1, y: 0 }, { x: 1, y: 0 }, target)).toBeCloseTo(
      (1 - BLOCK_SIZE / 2 - HAND_HIT_RADIUS) / 2,
    );
    expect(sweptPalmContact({ x: -1, y: 0.53 }, { x: 1, y: 0.53 }, target)).toBeNull();
    expect(sweptPalmContact({ x: 0.51, y: 0.51 }, { x: 0.52, y: 0.52 }, target)).toBeNull();
  });
  it('detects a swept blade even when the square lies inside its quad', () => {
    expect(
      sweptBladeContact({ x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, target),
    ).toBeCloseTo(0.35);
    expect(
      sweptBladeContact({ x: -1, y: 2 }, { x: -1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 3 }, target),
    ).toBeNull();
    expect(
      sweptBladeContact({ x: -1, y: -1 }, { x: 0, y: 1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, target),
    ).not.toBeNull();
  });
  it('matches a dense independent-time search for seeded rotating blade trajectories', () => {
    const random = seededRandom(42);
    const box = { minX: -0.3, maxX: 0.3, minY: -0.3, maxY: 0.3 };
    for (let run = 0; run < 200; run++) {
      const a0 = { x: random() * 4 - 2, y: random() * 4 - 2 };
      const a1 = { x: random() * 4 - 2, y: random() * 4 - 2 };
      const b0 = { x: a0.x + random() * 3 - 1.5, y: a0.y + random() * 3 - 1.5 };
      const b1 = { x: a1.x + random() * 3 - 1.5, y: a1.y + random() * 3 - 1.5 };
      const exact = sweptBladeContact(a0, b0, a1, b1, target);
      let sampled: number | null = null;
      for (let step = 0; step <= 1000; step++) {
        const fraction = step / 1000;
        const a = { x: a0.x + (a1.x - a0.x) * fraction, y: a0.y + (a1.y - a0.y) * fraction };
        const b = { x: b0.x + (b1.x - b0.x) * fraction, y: b0.y + (b1.y - b0.y) * fraction };
        if (segmentAABB(a, b, box) !== null) {
          sampled = fraction;
          break;
        }
      }
      if (sampled !== null) {
        expect(exact).not.toBeNull();
        expect(exact!).toBeLessThanOrEqual(sampled + 1e-8);
        expect(exact!).toBeGreaterThanOrEqual(sampled - 0.001001);
      } else if (exact !== null) {
        const a = { x: a0.x + (a1.x - a0.x) * exact, y: a0.y + (a1.y - a0.y) * exact };
        const b = { x: b0.x + (b1.x - b0.x) * exact, y: b0.y + (b1.y - b0.y) * exact };
        const paddedBox = { minX: -0.300000001, maxX: 0.300000001, minY: -0.300000001, maxY: 0.300000001 };
        expect(segmentAABB(a, b, paddedBox)).not.toBeNull();
      }
    }
  });
  it('makes a plane containing the swing and lane directions', () => {
    for (const velocity of [
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 4, z: 0 },
      { x: 2, y: -3, z: 0 },
    ]) {
      const n = makeCutPlane(velocity, { x: 0, y: 0, z: 0 }).normal;
      expect(n.x * velocity.x + n.y * velocity.y + n.z * velocity.z).toBeCloseTo(0, 9);
      expect(n.x * LANE_DIRECTION.x + n.y * LANE_DIRECTION.y + n.z * LANE_DIRECTION.z).toBeCloseTo(0, 9);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
    }
  });
  it('positions the note exactly at the hit plane and gives its full approach', () => {
    const note: Note = { id: 0, t: 1000, type: 'slash', col: 2, row: 1, dir: 'any', strength: 1 };
    const pos = notePosition(note, 1000, 2000, { x: 0, y: 0, z: 0 });
    expect(pos.x).toBe(LANE_X[2]);
    expect(pos.y).toBe(LANE_Y[1]);
    expect(pos.z).toBeCloseTo(0, 9);
    notePosition(note, -1000, 2000, pos);
    expect(Math.hypot(pos.x - LANE_X[2], pos.y - LANE_Y[1], pos.z)).toBeCloseTo(SPAWN_DISTANCE);
    const aimed = beamAimTarget({ ...note, type: 'beam' });
    expect(aimed.z).toBe(0);
    expect(aimed.x).toBeGreaterThan(0);
    expect(aimed.x).toBeLessThan(LANE_X[2]);
  });
});
