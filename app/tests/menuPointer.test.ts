import { describe, expect, it } from 'vitest';
import { MenuPointerController } from '../src/gestures/menuPointer';
import type { MenuContext, MenuHandSample } from '../src/core/menuInput';
const context = (): MenuContext => ({
  enabled: true,
  screenEpoch: 1,
  layoutEpoch: 1,
  viewport: { left: 0, top: 0, width: 1000, height: 700 },
  targets: [
    {
      id: 'start',
      bounds: { left: 400, top: 200, width: 200, height: 300 },
      enabled: true,
      nativeOnly: false,
      screenEpoch: 1,
      layoutEpoch: 1,
    },
  ],
});
function sample(
  t: number,
  gesture: MenuHandSample['gesture'] = 'open',
  extra: Partial<MenuHandSample> = {},
): MenuHandSample {
  return {
    hand: 'right',
    present: true,
    seq: t,
    tCapture: t,
    gesture,
    palm: { x: 0.5, y: 0.5 },
    confidence: 1,
    ...extra,
  };
}
function arm(p: MenuPointerController, c: MenuContext, start = 0): void {
  for (const t of [start, start + 80, start + 160]) p.update(sample(t), c, t);
  expect(p.state.phase).toBe('armed');
}
describe('palm menu input (synthetic capture samples)', () => {
  it('hover never clicks, point requires arming, and a held point activates once', () => {
    const p = new MenuPointerController();
    const c = context();
    expect(p.update(sample(0, 'point'), c, 0)).toBeNull();
    arm(p, c, 10);
    expect(p.update(sample(200, 'point'), c, 200)).toBeNull();
    expect(p.update(sample(300, 'point'), c, 300)).toEqual({
      targetId: 'start',
      hand: 'right',
      screenEpoch: 1,
      layoutEpoch: 1,
      tCapture: 300,
    });
    for (let t = 350; t < 1200; t += 50) expect(p.update(sample(t, 'point'), c, t)).toBeNull();
    arm(p, c, 1200);
    expect(p.update(sample(1400, 'point'), c, 1400)).toBeNull();
    expect(p.update(sample(1500, 'point'), c, 1500)?.targetId).toBe('start');
  });
  it('freezes the open anchor through a short ambiguous transition and then confirms', () => {
    const p = new MenuPointerController();
    const c = context();
    arm(p, c);
    for (const t of [200, 300]) expect(p.update(sample(t, 'none', { confidence: 0 }), c, t)).toBeNull();
    expect(p.update(sample(400, 'point'), c, 400)).toBeNull();
    expect(p.update(sample(500, 'point'), c, 500)?.targetId).toBe('start');
    expect(p.state.xCss).toBeCloseTo(500);
  });
  it.each([
    'stale',
    'lost',
    'movement',
    'disabled',
    'native',
    'layout',
    'uncertain',
    'long-transition',
    'gap',
  ] as const)('cancels %s without click-through', (kind) => {
    const p = new MenuPointerController();
    const c = context();
    arm(p, c);
    if (kind === 'native') p.cancel(170, true);
    if (kind === 'layout') c.layoutEpoch++;
    if (kind === 'disabled') c.targets[0]!.enabled = false;
    const s = sample(200, kind === 'long-transition' ? 'none' : 'point');
    if (kind === 'lost') s.present = false;
    if (kind === 'movement') s.palm.x += 0.1;
    p.update(s, c, kind === 'stale' ? 351 : 200);
    if (kind === 'gap') {
      expect(p.update(sample(500, 'point'), c, 500)).toBeNull();
      return;
    }
    if (kind === 'long-transition') {
      p.update(sample(300, 'none'), c, 300);
      p.update(sample(401, 'none'), c, 401);
    }
    if (kind === 'uncertain') p.update(sample(250, 'point', { confidence: 0.5 }), c, 250);
    for (const t of [300, 400, 500, 600]) expect(p.update(sample(t, 'point'), c, t)).toBeNull();
  });
  it('rejects wrong hand, duplicate frames and invalid reach; requires native handover cooldown', () => {
    const p = new MenuPointerController();
    const c = context();
    expect(p.setReach({ left: 1, right: 0, top: 0, bottom: 1 }, 0)).toBe(false);
    arm(p, c);
    expect(p.update(sample(200, 'point', { hand: 'left' }), c, 200)).toBeNull();
    p.update(sample(200, 'point'), c, 200);
    expect(p.update(sample(200, 'point'), c, 400)).toBeNull();
    p.cancel(220, true);
    p.update(sample(300), c, 300);
    expect(p.state.visible).toBe(false);
    arm(p, c, 720);
  });
  it('does not arm native-only targets or click when gameplay disables menus', () => {
    const p = new MenuPointerController();
    const c = context();
    c.targets[0]!.nativeOnly = true;
    for (let t = 0; t < 500; t += 50) expect(p.update(sample(t), c, t)).toBeNull();
    expect(p.state.phase).toBe('idle');
    c.targets[0]!.nativeOnly = false;
    arm(p, c, 500);
    c.enabled = false;
    expect(p.update(sample(700, 'point'), c, 700)).toBeNull();
    expect(p.state.visible).toBe(false);
  });
  it('produces identical activation requests at varied render cadence with deterministic fixture delivery', () => {
    const records = [
      sample(0),
      sample(80),
      sample(160),
      sample(200, 'point'),
      sample(250, 'point'),
      sample(300, 'point'),
      sample(400, 'point'),
    ];
    const run = (hz: number, stall: boolean) => {
      const p = new MenuPointerController();
      const c = context();
      const activations = [];
      let next = 0;
      for (let now = 0; now < 600; now += 1000 / hz) {
        if (stall && now > 180 && now < 420) continue;
        while (next < records.length && records[next]!.tCapture + 20 <= now) {
          const r = records[next++]!;
          const a = p.update(r, c, r.tCapture + 20);
          if (a) activations.push(a);
        }
      }
      return activations;
    };
    const reference = run(30, false);
    expect(reference).toHaveLength(1);
    for (const hz of [30, 60, 120]) {
      expect(run(hz, false)).toEqual(reference);
      expect(run(hz, true)).toEqual(reference);
    }
  });
});
