import { describe, expect, it } from 'vitest';
import { TypedEmitter } from '../src/utils/emitter';
import { normalizeWorkerTime, msToSeconds, secondsToMs } from '../src/core/clock';
import { assertTransition, StateMachine } from '../src/core/stateMachine';
import { readFlags } from '../src/core/flags';
import { SampleRing } from '../src/core/loop';
describe('foundation contracts', () => {
  it('normalizes nonzero worker origins and units', () => {
    expect(normalizeWorkerTime(50, 10000, 9000)).toBe(1050);
    expect(msToSeconds(secondsToMs(1.25))).toBe(1.25);
    expect(() => normalizeWorkerTime(NaN, 0, 0)).toThrow();
  });
  it('dispatches typed payloads once and disposes safely during dispatch', () => {
    const bus = new TypedEmitter<{ hit: { id: number } }>();
    const received: number[] = [];
    const off = bus.on('hit', (p) => received.push(p.id));
    bus.emit('hit', { id: 2 });
    off();
    off();
    bus.emit('hit', { id: 3 });
    expect(received).toEqual([2]);
    expect(bus.listenerCount).toBe(0);
  });
  it('guards readiness, rejects illegal transitions and stale epochs', () => {
    const m = new StateMachine();
    expect(m.transition('boot:ready')).toBe(false);
    expect(m.state).toBe('BOOT');
    expect(m.transition('boot:ready', { ready: true })).toBe(true);
    const epoch = m.epoch;
    m.transition('camera:setup');
    expect(m.transition('camera:ready', { ready: true, epoch })).toBe(false);
    expect(m.transition('select:start', { ready: false })).toBe(false);
    m.transition('select:start', { ready: true });
    expect(() => m.transition('results:retry')).toThrow();
    m.transition('calib:back');
    expect(m.state).toBe('SELECT');
  });
  it('does not let tracking recovery resume a manual pause', () => {
    const m = new StateMachine();
    m.transition('boot:ready', { ready: true });
    m.transition('select:start', { ready: true });
    m.transition('calib:complete', { ready: true });
    m.transition('pause:request');
    expect(m.transition('track:regained', { ready: true })).toBe(false);
    expect(m.state).toBe('PAUSED');
    m.transition('pause:resume', { ready: true });
    expect(m.state).toBe('PLAYING');
  });
  it('requires every lifecycle route to be explicit', () => {
    expect(assertTransition('SELECT', 'camera:error')).toBe('SELECT');
    expect(assertTransition('PLAYING', 'song:ended')).toBe('RESULTS');
    expect(assertTransition('RESULTS', 'results:songs')).toBe('SELECT');
    expect(() => assertTransition('BOOT', 'select:start')).toThrow();
  });
  it('keeps replay allowlisted and disabled in production', () => {
    expect(readFlags('?replay=https://evil.invalid&speed=.25', true).replay).toBeNull();
    expect(readFlags('?replay=synthetic-open', false).replay).toBeNull();
    expect(readFlags('?replay=synthetic-open&speed=.25', true).speed).toBe(0.25);
  });
  it('retains bounded chronological samples with nearest-rank percentiles', () => {
    const ring = new SampleRing(3);
    [1, 2, 3, 4].forEach((x) => ring.add(x));
    expect(ring.export()).toEqual([2, 3, 4]);
    expect(ring.summary()).toEqual({ count: 3, p50: 3, p95: 4, p99: 4, max: 4 });
  });
});
