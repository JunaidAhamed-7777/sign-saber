/**
 * Sign Saber — tests/unit/score.test.ts
 *
 * Responsibility: Score accumulation, multiplier ladder transitions, maxScore, rank thresholds, kinetic energy integration.
 * Spec: docs/07-hit-detection-and-scoring.md §14
 * Inputs: —
 * Outputs: —
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import { describe, expect, it } from 'vitest';
import { maximumScore, multiplierFor, rankFor, ScoreState } from '../../src/game/score';
import { KineticMeter } from '../../src/game/kinetic';
import type { HandCursor } from '../../src/core/types';
import { PLAY_W } from '../../src/core/constants';

describe('score and truthful accuracy', () => {
  it('awards threshold multiplier on that hit', () => {
    expect([4, 5, 14, 15, 29, 30].map(multiplierFor)).toEqual([1, 2, 2, 4, 4, 8]);
    expect(maximumScore(40, 2)).toBe(400 + 2000 + 6000 + 8800 + 800);
  });
  it('has 100% accuracy with an early wall even below the score ceiling', () => {
    const score = new ScoreState({ notes: Array(2), obstacles: Array(1) });
    expect(score.liveAccuracy).toBeNull();
    score.dodge();
    score.hit('perfect');
    score.hit('perfect');
    expect(score.finalAccuracy).toBe(1);
    expect(score.score).toBe(250);
    expect(score.maxScore).toBe(600);
    expect(score.snapshot().rank).toBe('SS');
  });
  it('misses/bad cuts/wall hits reset combo without subtracting earned base', () => {
    const score = new ScoreState({ notes: Array(5), obstacles: Array(1) });
    score.hit('perfect');
    score.hit('great');
    score.miss();
    score.badcut();
    score.obstacleHit();
    expect(score.combo).toBe(0);
    expect(score.multiplier).toBe(1);
    expect(score.earnedBase).toBe(170);
    expect(score.finalAccuracy).toBeCloseTo(170 / 550);
    expect(score.counts).toEqual({
      perfect: 1,
      great: 1,
      good: 0,
      miss: 1,
      badcut: 1,
      obstaclesHit: 1,
      obstaclesDodged: 0,
    });
    expect(new ScoreState({ notes: [], obstacles: [] }).finalAccuracy).toBe(0);
  });
  it('respects exact rank boundaries', () => {
    expect([0.95, 0.9, 0.8, 0.65, 0.5, 0.499].map(rankFor)).toEqual(['SS', 'S', 'A', 'B', 'C', 'D']);
  });
  it('counts one local speed peak with physical proxy conversion', () => {
    const meter = new KineticMeter(PLAY_W);
    const hand = { hand: 'right', present: true, speed: 0, tCapture: 0 } as HandCursor;
    for (const [time, speed] of [
      [0, 0],
      [30, 2],
      [60, 4],
      [90, 2],
      [120, 3],
      [150, 1],
    ]) {
      hand.tCapture = time!;
      hand.speed = speed!;
      meter.update([hand], null);
    }
    expect(meter.joules).toBe(20);
    expect(meter.kcal).toBeCloseTo(20 / 4184 / 0.25);
  });
});
