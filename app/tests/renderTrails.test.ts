import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BladeRibbon } from '../src/render/blade';
import { HandTrails } from '../src/render/trails';
import { QUALITY_TIER_PRESETS, BLADE_LEN_MAX } from '../src/core/constants';
import type { HandCursor } from '../src/core/types';

function cursor(overrides: Partial<HandCursor> = {}): HandCursor {
  const history = Array.from({ length: 24 }, (_, i) => ({ x: -1 + i * 0.09, y: 1.5, z: 0 }));
  return {
    hand: 'left',
    present: true,
    tCapture: 0,
    gesture: 'open',
    gestureConfidence: 1,
    gestureHeldMs: 500,
    pos: history[history.length - 1]!,
    vel: { x: 6, y: 0, z: 0 },
    speed: 6,
    tip: { x: 1.1, y: 1.6, z: 0 },
    pointDir: { x: 0, y: 1 },
    bladeActive: true,
    bladeLength: BLADE_LEN_MAX,
    charge: 0,
    history,
    ...overrides,
  };
}
const camera = new THREE.Vector3(0, 1.75, 4.6);

describe('blade ribbon and hand trails (cosmetic only)', () => {
  it('grows smoothly toward the measured blade length and writes finite strips', () => {
    const ribbon = new BladeRibbon(new THREE.Color(0x19f5ff));
    ribbon.applyPreset(QUALITY_TIER_PRESETS.high);
    const hand = cursor();
    let previous = 0;
    for (let frame = 0; frame < 30; frame++) {
      ribbon.update(hand, 1 / 60, camera, frame / 60, 1);
      expect(ribbon.drawnLength).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = ribbon.drawnLength;
    }
    expect(ribbon.drawnLength).toBeGreaterThan(0.5 * BLADE_LEN_MAX);
    expect(Array.from(ribbon.spine).every(Number.isFinite)).toBe(true);
    // The hilt sample sits on the measured palm; the trail never extends past the recorded path.
    const hilt = ribbon.sample(QUALITY_TIER_PRESETS.high.ribbonSpineSamples - 1, { x: 0, y: 0, z: 0 });
    expect(hilt.x).toBeCloseTo(hand.pos.x, 5);
    const tail = ribbon.sample(0, { x: 0, y: 0, z: 0 });
    expect(tail.x).toBeGreaterThanOrEqual(hand.history[0]!.x - 1e-6);
    ribbon.dispose();
  });
  it('retracts when the blade drops and resets without bridging a lost hand', () => {
    const ribbon = new BladeRibbon(new THREE.Color(0x19f5ff));
    ribbon.applyPreset(QUALITY_TIER_PRESETS.low);
    for (let frame = 0; frame < 30; frame++) ribbon.update(cursor(), 1 / 60, camera, 0, 1);
    for (let frame = 0; frame < 60; frame++)
      ribbon.update(cursor({ bladeActive: false, bladeLength: 0 }), 1 / 60, camera, 0, 1);
    expect(ribbon.drawnLength).toBeLessThan(0.05);
    expect(ribbon.update(cursor({ present: false }), 1 / 60, camera, 0, 1)).toBe(false);
    ribbon.reset();
    expect(ribbon.drawnLength).toBe(0);
    ribbon.dispose();
  });
  it('degenerate or stationary history produces no ribbon and no NaNs', () => {
    const ribbon = new BladeRibbon(new THREE.Color(0xb36bff)),
      still = cursor({ history: Array.from({ length: 24 }, () => ({ x: 0, y: 1, z: 0 })) });
    for (let frame = 0; frame < 20; frame++) expect(ribbon.update(still, 1 / 60, camera, 0, 1)).toBe(false);
    expect(Array.from(ribbon.spine).every(Number.isFinite)).toBe(true);
    ribbon.dispose();
  });
  it('sizes particle draws from the tier and hides both hands on demand', () => {
    const trails = new HandTrails(QUALITY_TIER_PRESETS.low),
      points = trails.group.children.filter((child) => child instanceof THREE.Points) as THREE.Points[];
    expect(points).toHaveLength(2);
    for (const p of points)
      expect(p.geometry.drawRange.count).toBe(QUALITY_TIER_PRESETS.low.trailParticlesPerHand);
    trails.update([cursor()], true, 16, { low: 0, mid: 0.5, high: 0.5, rms: 0 }, false, camera);
    expect(points[0]!.visible).toBe(true);
    trails.hide();
    expect(points.every((p) => !p.visible)).toBe(true);
    trails.dispose();
  });
});
