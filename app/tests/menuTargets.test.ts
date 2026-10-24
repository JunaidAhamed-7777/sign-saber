import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuTargets } from '../src/ui/menuTargets';
import type { MenuActivation } from '../src/core/menuInput';
function button() {
  const attributes = new Map<string, string>();
  const rect = { left: 20, top: 20, width: 100, height: 72, right: 120, bottom: 92 };
  const element = {
    isConnected: true,
    disabled: false,
    hidden: false,
    visible: true,
    dataset: { nativeOnly: 'false' },
    getBoundingClientRect: () => ({ ...rect }),
    getClientRects: () => (element.visible ? [{ ...rect }] : []),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    closest: () => null,
  };
  return { element: element as unknown as HTMLButtonElement, state: element, rect, attributes };
}
function request(registry: MenuTargets, targetId = 'start'): MenuActivation {
  return {
    targetId,
    screenEpoch: registry.screenEpoch,
    layoutEpoch: registry.layoutEpoch,
    hand: 'right',
    tCapture: 100,
  };
}
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
});
afterEach(() => vi.unstubAllGlobals());
describe('shared semantic menu target guards with mocked DOM geometry', () => {
  it('dispatches equivalent native and hand actions only through the registered callback', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const run = vi.fn();
    registry.register('start', target.element, run);
    registry.surface(1);
    const context = registry.snapshot(true);
    expect(context.targets[0]!.bounds).toEqual({ left: 20, top: 20, width: 100, height: 72 });
    expect(registry.activate('start', 'native')).toBe(true);
    expect(registry.activate('start', 'hand', request(registry))).toBe(true);
    expect(run.mock.calls).toEqual([['native'], ['hand']]);
  });
  it('rejects stale screen/layout epochs, dirty layouts and geometry moved after arming', () => {
    const invalidated = vi.fn();
    const registry = new MenuTargets(invalidated);
    const target = button();
    const run = vi.fn();
    registry.register('start', target.element, run);
    registry.snapshot(true);
    const old = request(registry);
    registry.invalidate();
    expect(registry.activate('start', 'hand', old)).toBe(false);
    registry.snapshot(true);
    expect(registry.activate('start', 'hand', old)).toBe(false);
    const beforeMove = request(registry);
    target.rect.left += 10;
    target.rect.right += 10;
    expect(registry.activate('start', 'hand', beforeMove)).toBe(false);
    expect(invalidated).toHaveBeenCalled();
    registry.snapshot(true);
    const beforeScreen = request(registry);
    registry.surface(2);
    expect(registry.activate('start', 'hand', beforeScreen)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps native-only browser actions available to native input and rejects hand activation', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    target.state.dataset.nativeOnly = 'true';
    const run = vi.fn();
    registry.register('start', target.element, run);
    registry.snapshot(true);
    expect(registry.activate('start', 'hand', request(registry))).toBe(false);
    expect(registry.activate('start', 'native')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
  it('rejects disabled, disconnected and removed controls for both input sources', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const run = vi.fn();
    const off = registry.register('start', target.element, run);
    registry.snapshot(true);
    target.state.disabled = true;
    expect(registry.activate('start', 'native')).toBe(false);
    expect(registry.activate('start', 'hand', request(registry))).toBe(false);
    target.state.disabled = false;
    target.state.isConnected = false;
    expect(registry.activate('start', 'native')).toBe(false);
    target.state.isConnected = true;
    off();
    expect(registry.activate('start', 'native')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('binds a hand activation request to its original target ID', () => {
    const registry = new MenuTargets(vi.fn());
    const a = button();
    const b = button();
    const run = vi.fn();
    registry.register('start', a.element, run);
    registry.register('quit', b.element, run);
    registry.snapshot(true);
    expect(registry.activate('quit', 'hand', request(registry, 'start'))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('revalidates current busy and hidden states for native and armed hand input', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const run = vi.fn();
    registry.register('start', target.element, run);
    registry.snapshot(true);
    target.attributes.set('aria-busy', 'true');
    expect(registry.activate('start', 'native')).toBe(false);
    expect(registry.activate('start', 'hand', request(registry))).toBe(false);
    target.attributes.delete('aria-busy');
    target.state.visible = false;
    expect(registry.activate('start', 'native')).toBe(false);
    expect(registry.activate('start', 'hand', request(registry))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('does not dispatch a hand request from a globally disabled menu context', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const run = vi.fn();
    registry.register('start', target.element, run);
    registry.snapshot(true);
    const activation = request(registry);
    registry.snapshot(false);
    expect(registry.activate('start', 'hand', activation)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('an older registration disposer cannot remove the replacement callback on the same element', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registry.register('start', target.element, first);
    const offSecond = registry.register('start', target.element, second);
    offFirst();
    expect(registry.activate('start', 'native')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    offSecond();
    expect(registry.activate('start', 'native')).toBe(false);
  });
  it('refuses conflicting target identities and disposes all callback ownership', () => {
    const registry = new MenuTargets(vi.fn());
    const target = button();
    const run = vi.fn();
    registry.register('start', target.element, run);
    expect(() => registry.register('start', button().element, run)).toThrow('Duplicate menu target');
    registry.dispose();
    expect(registry.activate('start', 'native')).toBe(false);
    expect(registry.snapshot(true).targets).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
