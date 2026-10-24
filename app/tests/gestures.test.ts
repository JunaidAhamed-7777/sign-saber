import { describe, expect, it } from 'vitest';
import { ClassifierScratch, classify, type GestureResult } from '../src/gestures/classifier';
import { CursorProcessor, predictCursor } from '../src/gestures/cursor';
import { PLAY_W, BEAM_CHARGE_MS, GESTURE_DROP_FRAMES } from '../src/core/constants';
import { syntheticHand } from './tracking-fixtures';
describe('geometric gestures, synthetic only', () => {
  it.each(['open', 'fist', 'point'] as const)('classifies %s with explicit geometry', (gesture) => {
    const out: GestureResult = { gesture: 'none', confidence: 0, ambiguous: true };
    classify(syntheticHand(gesture), 'none', out, new ClassifierScratch());
    expect(out.gesture).toBe(gesture);
    expect(out.confidence).toBeGreaterThan(0.6);
  });
  it('rejects degenerate/non-finite landmarks and tiny palms', () => {
    const out: GestureResult = { gesture: 'open', confidence: 1, ambiguous: false };
    const scratch = new ClassifierScratch();
    const hand = syntheticHand();
    hand.worldLandmarks.fill(0);
    classify(hand, 'open', out, scratch);
    expect(out.gesture).toBe('none');
    hand.landmarks[0] = NaN;
    classify(hand, 'open', out, scratch);
    expect(out.confidence).toBe(0);
    hand.landmarks.fill(0);
    classify(hand, 'open', out, scratch);
    expect(out.gesture).toBe('none');
  });
  it('uses capture-time velocity, activates the blade, and predicts without changing the sample', () => {
    const p = new CursorProcessor('right');
    for (let t = 0; t <= 100; t += 25) p.update(syntheticHand('open', 'right', (6 * t) / 1000 / PLAY_W), t);
    expect(p.cursor.gesture).toBe('open');
    expect(p.cursor.speed).toBeCloseTo(6, 4);
    expect(p.cursor.bladeActive).toBe(true);
    const before = p.cursor.pos.x;
    const out = { x: 0, y: 0, z: 0 };
    predictCursor(p.cursor, 1000, out);
    expect(out.x - before).toBeCloseTo(6 * 0.08);
    expect(p.cursor.pos.x).toBe(before);
    p.update(syntheticHand(), 1000);
    expect(p.cursor.speed).toBe(0);
  });
  it('charges from unique samples, holds full, resets after fire and hand loss', () => {
    const p = new CursorProcessor('right');
    for (let t = 0; t <= BEAM_CHARGE_MS + 100; t += 25) p.update(syntheticHand('point'), t);
    expect(p.cursor.charge).toBe(1);
    p.update(syntheticHand('point'), BEAM_CHARGE_MS + 100);
    expect(p.cursor.charge).toBe(1);
    p.beamFired(600);
    expect(p.cursor.charge).toBe(0);
    p.update(syntheticHand('point'), 625);
    expect(p.cursor.charge).toBe(0);
    p.update(null, 650);
    expect(p.cursor.charge).toBe(0);
    expect(p.cursor.present).toBe(false);
  });
  it('sustained ambiguous evidence drops display gesture and cannot charge', () => {
    const p = new CursorProcessor('right');
    for (let t = 0; t <= 100; t += 25) p.update(syntheticHand('point'), t);
    const hand = syntheticHand('point');
    hand.landmarks.fill(0);
    for (let n = 1; n <= GESTURE_DROP_FRAMES; n++) p.update(hand, 100 + n * 25);
    expect(p.cursor.gesture).toBe('none');
    expect(p.cursor.charge).toBe(0);
  });
});
