/**
 * Sign Saber — tests/unit/classifier.test.ts
 *
 * Responsibility: Gesture classifier assertions on explicitly synthetic geometry.
 * Spec: docs/17-testing-and-qa.md §Unit tests
 * Inputs: —
 * Outputs: —
 *
 * Synthetic geometry is not recorded-camera or human acceptance evidence.
 */
import { expect, it } from 'vitest';
import { ClassifierScratch, classify, type GestureResult } from '../../src/gestures/classifier';
import { syntheticHand } from '../tracking-fixtures';
it('marks an edge-on held display gesture uncertain, so it cannot arm a menu or charge a beam', () => {
  const hand = syntheticHand('point');
  hand.landmarks[5 * 3] = hand.landmarks[17 * 3]!;
  const result: GestureResult = { gesture: 'none', confidence: 0, ambiguous: false };
  classify(hand, 'point', result, new ClassifierScratch());
  expect(result).toEqual({ gesture: 'point', confidence: 0, ambiguous: true });
});
