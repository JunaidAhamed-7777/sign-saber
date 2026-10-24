/**
 * Sign Saber — tests/unit/oneEuro.test.ts
 *
 * Responsibility: One Euro filter: step response, lag at low speed, responsiveness at high speed, dt robustness.
 * Spec: docs/17-testing-and-qa.md §Unit tests
 * Inputs: —
 * Outputs: —
 *
 * Numeric filter assertions are separate from live-camera acceptance evidence.
 */
import { expect, it } from 'vitest';
import { OneEuroFilter } from '../../src/tracking/filters';
it('retains a constant across irregular capture intervals and ignores time reversal', () => {
  const filter = new OneEuroFilter();
  for (const time of [0, 0.01, 0.04, 0.14, 0.2]) expect(filter.filter(0.5, time)).toBe(0.5);
  expect(filter.filter(100, 0.15)).toBe(0.5);
});
it('attenuates a seeded stationary jitter fixture without changing its mean substantially', () => {
  const filter = new OneEuroFilter();
  let seed = 123;
  let rawEnergy = 0;
  let outputEnergy = 0;
  let outputSum = 0;
  for (let i = 0; i < 300; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const raw = 0.5 + (seed / 2 ** 32 - 0.5) * 0.04;
    const value = filter.filter(raw, i / 30);
    if (i >= 30) {
      rawEnergy += (raw - 0.5) ** 2;
      outputEnergy += (value - 0.5) ** 2;
      outputSum += value;
    }
  }
  expect(outputEnergy).toBeLessThan(rawEnergy);
  expect(outputSum / 270).toBeCloseTo(0.5, 2);
});
