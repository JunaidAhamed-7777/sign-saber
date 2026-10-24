/**
 * Sign Saber — tests/unit/judge.test.ts
 *
 * Responsibility: Judgement windows, bad cut rules, multiplier ladder, rank thresholds.
 * Spec: docs/17-testing-and-qa.md §Unit tests
 * Inputs: —
 * Outputs: —
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import { describe, expect, it } from 'vitest';
import { contactOutcome, judgeTiming, timingError } from '../../src/game/judge';

describe('capture-time judgement', () => {
  it('includes exact boundaries and rejects fractional values outside each bucket', () => {
    for (const sign of [-1, 1]) {
      expect(judgeTiming(sign * 60)).toBe('perfect');
      expect(judgeTiming(sign * 60.001)).toBe('great');
      expect(judgeTiming(sign * 120)).toBe('great');
      expect(judgeTiming(sign * 120.001)).toBe('good');
      expect(judgeTiming(sign * 200)).toBe('good');
      expect(judgeTiming(sign * 200.001)).toBeNull();
    }
    expect(judgeTiming(NaN)).toBeNull();
    expect(judgeTiming(210, 1.25)).toBe('good');
  });
  it('adds positive offset as a later judgement', () => {
    expect(timingError(980, 1000, 30)).toBe(10);
    expect(timingError(980, 1000, -30)).toBe(-50);
  });
  it('gates committed gesture/speed combinations and never bad-cuts resting hands', () => {
    expect(contactOutcome('slash', 'open', 2.49)).toBe('ignore');
    expect(contactOutcome('slash', 'open', 2.5)).toBe('hit');
    expect(contactOutcome('slash', 'fist', 1.2)).toBe('badcut');
    expect(contactOutcome('slash', 'point', 0)).toBe('ignore');
    expect(contactOutcome('smash', 'fist', 1.2)).toBe('hit');
    expect(contactOutcome('smash', 'open', 2.5)).toBe('badcut');
    expect(contactOutcome('smash', 'point', 9)).toBe('ignore');
    expect(contactOutcome('beam', 'point', 9)).toBe('ignore');
    expect(contactOutcome('slash', 'none', 99)).toBe('ignore');
  });
});
