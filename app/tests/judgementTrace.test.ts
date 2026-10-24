import { describe, expect, it } from 'vitest';
import { TypedEmitter } from '../src/utils/emitter';
import type { GameEvents } from '../src/core/events';
import { JudgementTraceRecorder } from '../src/core/judgementTrace';
import type { Note, Obstacle } from '../src/beatmap/types';
import type { SessionStats } from '../src/core/types';

const note = (id: number, t: number): Note => ({
  id,
  t,
  type: 'slash',
  col: 1,
  row: 1,
  dir: 'any',
  strength: 0.5,
});
const obstacle = (id: number, t: number): Obstacle =>
  ({ id, t, durationMs: 800, kind: 'wallLeft' }) as Obstacle;
const origin = { x: 0, y: 0, z: 0 };
function hit(bus: TypedEmitter<GameEvents>, id: number, t: number, timingErrorMs: number): void {
  bus.emit('note:hit', {
    note: note(id, t),
    judgement: 'great',
    timingErrorMs,
    hand: 'right',
    impactPos: origin,
    impactVel: origin,
    scoreDelta: 85,
    combo: 3,
    multiplier: 2,
  });
}
const end = { score: 170, maxCombo: 3 } as SessionStats;
function scenario(bus: TypedEmitter<GameEvents>): void {
  hit(bus, 1, 1000, -12.5);
  bus.emit('note:miss', { note: note(2, 1500) });
  bus.emit('note:badcut', { note: note(3, 2000), hand: 'left', gesture: 'fist' });
  bus.emit('beam:fire', { hand: 'left', from: origin, to: origin, note: null });
  bus.emit('obstacle:dodged', { obstacle: obstacle(4, 2500), scoreDelta: 50 });
  bus.emit('session:end', end);
}

describe('JudgementTraceRecorder', () => {
  it('records semantic fields in emission order and hashes without delivery timestamps', async () => {
    const busA = new TypedEmitter<GameEvents>();
    const busB = new TypedEmitter<GameEvents>();
    let clockA = 0;
    let clockB = 5000;
    const a = new JudgementTraceRecorder(16, () => (clockA += 16.7));
    const b = new JudgementTraceRecorder(16, () => (clockB += 8.3));
    a.attach(busA);
    b.attach(busB);
    scenario(busA);
    scenario(busB);
    const [ea, eb] = await Promise.all([a.export(), b.export()]);
    expect(ea.events.map((e) => e.kind)).toEqual([
      'note:hit',
      'note:miss',
      'note:badcut',
      'beam:fire',
      'obstacle:dodged',
      'session:end',
    ]);
    expect(ea.events[0]).toMatchObject({
      subject: 1,
      chartTimeMs: 1000,
      judgement: 'great',
      timingErrorMs: -12.5,
      hand: 'right',
      scoreDelta: 85,
      combo: 3,
      multiplier: 2,
      repeat: false,
    });
    expect(ea.events[2]).toMatchObject({ hand: 'left', gesture: 'fist', scoreDelta: null });
    expect(ea.events[3]).toMatchObject({ subject: -1, chartTimeMs: null });
    expect(ea.events[5]).toMatchObject({ kind: 'session:end', scoreDelta: 170, combo: 3 });
    expect(ea.deliveredAtMs).not.toEqual(eb.deliveredAtMs);
    expect(ea.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ea.sha256).toBe(eb.sha256);
  });
  it('changes the hash when any semantic field changes', async () => {
    const bus = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(8);
    recorder.attach(bus);
    hit(bus, 1, 1000, -12.5);
    const first = (await recorder.export()).sha256;
    recorder.reset();
    hit(bus, 1, 1000, -12.4);
    expect((await recorder.export()).sha256).not.toBe(first);
  });
  it('subscribes idempotently and detaches safely, including during dispatch', () => {
    const bus = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(8);
    recorder.attach(bus);
    recorder.attach(bus);
    expect(bus.listenerCount).toBe(7);
    bus.emit('note:miss', { note: note(1, 100) });
    expect(recorder.length).toBe(1);
    bus.on('note:miss', () => recorder.detach());
    bus.emit('note:miss', { note: note(2, 200) });
    expect(recorder.length).toBe(2);
    bus.emit('note:miss', { note: note(3, 300) });
    expect(recorder.length).toBe(2);
    recorder.detach();
    recorder.dispose();
    expect(recorder.attached).toBe(false);
    expect(bus.listenerCount).toBe(1);
  });
  it('moves to another emitter without keeping old subscriptions', () => {
    const first = new TypedEmitter<GameEvents>();
    const second = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(8);
    recorder.attach(first);
    recorder.attach(second);
    expect(first.listenerCount).toBe(0);
    first.emit('note:miss', { note: note(1, 100) });
    second.emit('note:miss', { note: note(2, 200) });
    expect(recorder.events().map((e) => e.subject)).toEqual([2]);
  });
  it('reports overflow explicitly instead of silently dropping events', async () => {
    const bus = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(2);
    recorder.attach(bus);
    for (let id = 0; id < 5; id++) bus.emit('note:miss', { note: note(id, id * 100) });
    const exported = await recorder.export();
    expect(exported.count).toBe(2);
    expect(exported.overflow).toBe(3);
    expect(recorder.canonical()).toContain('overflow=3');
    const complete = new JudgementTraceRecorder(8);
    const other = new TypedEmitter<GameEvents>();
    complete.attach(other);
    for (let id = 0; id < 2; id++) other.emit('note:miss', { note: note(id, id * 100) });
    expect((await complete.export()).sha256).not.toBe(exported.sha256);
  });
  it('flags a repeated terminal outcome for one note or wall', async () => {
    const bus = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(8);
    recorder.attach(bus);
    hit(bus, 7, 700, 0);
    bus.emit('note:miss', { note: note(7, 700) });
    bus.emit('obstacle:hit', { obstacle: obstacle(1, 900) });
    bus.emit('obstacle:dodged', { obstacle: obstacle(1, 900), scoreDelta: 0 });
    bus.emit('beam:fire', { hand: 'left', from: origin, to: origin, note: note(8, 800) });
    bus.emit('beam:fire', { hand: 'left', from: origin, to: origin, note: note(8, 800) });
    const exported = await recorder.export();
    expect(exported.repeats).toBe(2);
    expect(exported.events.map((e) => e.repeat)).toEqual([false, true, false, true, false, false]);
  });
  it('resets per session while retaining its subscription', () => {
    const bus = new TypedEmitter<GameEvents>();
    const recorder = new JudgementTraceRecorder(8);
    recorder.attach(bus);
    bus.emit('note:miss', { note: note(1, 100) });
    recorder.reset('epoch 2');
    expect(recorder.length).toBe(0);
    expect(recorder.label).toBe('epoch 2');
    bus.emit('note:miss', { note: note(1, 100) });
    expect(recorder.events()[0]!.repeat).toBe(false);
  });
  it('rejects an invalid capacity', () => {
    expect(() => new JudgementTraceRecorder(0)).toThrow(RangeError);
  });
});
