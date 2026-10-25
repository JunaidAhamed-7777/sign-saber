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
import { CONTACT_MIN_SPEED } from '../../src/core/constants';

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
  it('hits slash and smash blocks with any moving hand shape and never bad-cuts', () => {
    for (const gesture of ['open', 'fist', 'point', 'none'] as const) {
      expect(contactOutcome('slash', gesture, CONTACT_MIN_SPEED)).toBe('hit');
      expect(contactOutcome('smash', gesture, CONTACT_MIN_SPEED)).toBe('hit');
      expect(contactOutcome('slash', gesture, CONTACT_MIN_SPEED - 0.01)).toBe('ignore');
      expect(contactOutcome('beam', gesture, 9)).toBe('ignore');
    }
  });
});
