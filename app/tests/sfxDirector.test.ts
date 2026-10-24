/** Event → cue wiring of the audio director with fake audio/DOM/store boundaries. Not audible evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { SfxBus } from '../src/audio/sfx';
import type { PlayOptions } from '../src/audio/sfx';
import type { SfxRenderer } from '../src/audio/sfxBank';
import { SfxDirector, WARM_ORDER, dynamicsDb, menuCue, notePan, wallPan } from '../src/audio/sfxDirector';
import type { SfxStore, SfxStoreView } from '../src/audio/sfxDirector';
import { SFX_IDS } from '../src/audio/sfxSynth';
import type { SfxId, SfxVoicing } from '../src/audio/sfxSynth';
import type { TonalCenter } from '../src/audio/tonic';
import { TypedEmitter } from '../src/utils/emitter';
import type { GameEvents } from '../src/core/events';
import type { BeatmapV1, Note, Obstacle } from '../src/beatmap/types';
import type { HandCursor } from '../src/core/types';
import type { MenuPointerState } from '../src/core/menuInput';
import {
  BEAM_CHARGE_MS,
  SFX_BEAT_SNAP_MS,
  SFX_DYNAMICS_DB,
  SFX_LIMITER_LOOKAHEAD_S,
  SFX_NEUTRAL_GO_RATE,
  SFX_PAN_BEAM,
  SFX_PAN_LANE,
  SFX_PAN_WALL,
  SFX_WALL_WARN_LEAD_S,
  SLASH_MIN_SPEED,
} from '../src/core/constants';
import { FakeContext } from './fakeAudio';

class Store implements SfxStore {
  state: SfxStoreView = { calm: false, audioReady: false };
  listeners = new Set<(state: SfxStoreView, previous: SfxStoreView) => void>();
  getState(): SfxStoreView {
    return this.state;
  }
  subscribe(listener: (state: SfxStoreView, previous: SfxStoreView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(patch: Partial<SfxStoreView>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch };
    for (const listener of this.listeners) listener(this.state, previous);
  }
}
/** Never resolves renders (no background CPU); tonic answers come from `center`. */
class QuietRenderer implements SfxRenderer {
  center: TonalCenter | null = null;
  tonicCalls = 0;
  render(): Promise<Float32Array[]> {
    return new Promise(() => {});
  }
  async tonic(): Promise<TonalCenter | null> {
    this.tonicCalls++;
    return this.center;
  }
  dispose(): void {}
}
class Button extends EventTarget {
  disabled = false;
  focusVisible = false;
  dataset: Record<string, string>;
  constructor(id: string) {
    super();
    this.dataset = { target: id };
  }
  closest(): Button {
    return this;
  }
  matches(selector: string): boolean {
    return selector === ':focus-visible' ? this.focusVisible : false;
  }
}

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 1,
  t: 4000,
  type: 'slash',
  col: 0,
  row: 1,
  dir: 'any',
  strength: 0.5,
  ...overrides,
});
const obstacle = (overrides: Partial<Obstacle> = {}): Obstacle => ({
  id: 1,
  t: 6000,
  durationMs: 1000,
  kind: 'wallLeft',
  ...overrides,
});
const map = (events: BeatmapV1['events'] = []): BeatmapV1 =>
  ({ song: { bpm: 120, durationMs: 60000 }, events, notes: [], obstacles: [] }) as unknown as BeatmapV1;
const cursor = (
  hand: 'left' | 'right',
  charge: number,
  gesture: HandCursor['gesture'] = 'point',
): HandCursor => ({ hand, present: true, gesture, charge }) as HandCursor;
const hit = (overrides: Partial<GameEvents['note:hit']> = {}): GameEvents['note:hit'] => ({
  note: note(),
  judgement: 'perfect',
  timingErrorMs: 0,
  hand: 'left',
  impactPos: { x: 0, y: 0, z: 0 },
  impactVel: { x: SLASH_MIN_SPEED * 2, y: 0, z: 0 },
  scoreDelta: 100,
  combo: 1,
  multiplier: 1,
  ...overrides,
});

let events: TypedEmitter<GameEvents>;
let store: Store;
let context: FakeContext;
let renderer: QuietRenderer;
let win: EventTarget;
let doc: EventTarget;
let director: SfxDirector;
let play: MockInstance<(name: SfxId, options?: PlayOptions) => number | null>;
const START = 12;
const calls = (): [SfxId, PlayOptions][] => play.mock.calls.map(([name, options]) => [name, options ?? {}]);
const names = (): SfxId[] => calls().map(([name]) => name);
const last = (name: SfxId): PlayOptions =>
  calls()
    .filter(([cue]) => cue === name)
    .at(-1)![1];
const state = (prev: GameEvents['state:change']['prev'], next: GameEvents['state:change']['next']): void =>
  events.emit('state:change', { prev, next });

beforeEach(() => {
  events = new TypedEmitter<GameEvents>();
  store = new Store();
  context = new FakeContext();
  renderer = new QuietRenderer();
  win = new EventTarget();
  doc = new EventTarget();
  director = new SfxDirector(events, store, { window: win, document: doc });
  director.attach(context.asAudioContext(), context.destination as unknown as AudioNode, renderer);
  play = vi.spyOn(SfxBus.prototype, 'play');
});
afterEach(() => {
  director.dispose();
  vi.restoreAllMocks();
});
const startSession = (overrides: Partial<Parameters<SfxDirector['beginSession']>[0]> = {}): void => {
  director.beginSession({
    map: map(),
    startAt: START,
    stepMs: 500,
    confidentTempo: true,
    music: null,
    ...overrides,
  });
  state('CALIBRATION', 'PLAYING');
  play.mockClear();
};

describe('audio director: gameplay cues', () => {
  it('layers gesture, judgement and stereo placement on hits', () => {
    startSession();
    events.emit('note:hit', hit());
    expect(names()).toEqual(['slash', 'sparkle']);
    const slash = last('slash');
    expect(slash.rate).toBe(1.03);
    expect(slash.jitter).toBe(true);
    expect(slash.pan).toBeCloseTo(notePan(0, 'left'), 9);
    expect(slash.pan).toBeLessThan(-SFX_PAN_LANE);
    expect(last('sparkle').pan).toBeCloseTo(slash.pan! / 2, 9);
    play.mockClear();
    events.emit(
      'note:hit',
      hit({ note: note({ type: 'smash', col: 3 }), judgement: 'great', hand: 'right' }),
    );
    expect(names()).toEqual(['smash', 'glint']);
    expect(last('smash').pan).toBeGreaterThan(SFX_PAN_LANE);
    play.mockClear();
    events.emit('note:hit', hit({ judgement: 'good' }));
    expect(names()).toEqual(['slash']);
    expect(last('slash').rate).toBe(0.97);
  });
  it('scales gesture loudness with swing speed within the registered range', () => {
    expect(dynamicsDb(SLASH_MIN_SPEED, SLASH_MIN_SPEED)).toBe(SFX_DYNAMICS_DB.min);
    expect(dynamicsDb(SLASH_MIN_SPEED * 10, SLASH_MIN_SPEED)).toBe(SFX_DYNAMICS_DB.max);
    expect(dynamicsDb(Number.NaN, SLASH_MIN_SPEED)).toBe(0);
    startSession();
    events.emit('note:hit', hit({ impactVel: { x: 0, y: SLASH_MIN_SPEED, z: 0 } }));
    expect(last('slash').gainDb).toBe(SFX_DYNAMICS_DB.min);
  });
  it('sounds an early-arriving hit on its chart time, never later than SFX_BEAT_SNAP_MS', () => {
    startSession();
    const chartAt = (t: number): number => START + t / 1000 - SFX_LIMITER_LOOKAHEAD_S;
    context.currentTime = chartAt(4000) - 0.02;
    events.emit('note:hit', hit());
    expect(last('slash').at).toBeCloseTo(chartAt(4000), 9);
    context.currentTime = chartAt(4000) - (SFX_BEAT_SNAP_MS + 30) / 1000;
    events.emit('note:hit', hit());
    expect(last('slash').at).toBeUndefined();
    context.currentTime = chartAt(4000) + 0.05;
    events.emit('note:hit', hit());
    expect(last('slash').at).toBeUndefined();
  });
  it('plays a beam as a hand-panned zap and a collapse, and rate-limits misses', () => {
    startSession();
    events.emit('beam:fire', {
      hand: 'right',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
      note: null,
    });
    events.emit('note:hit', hit({ note: note({ type: 'beam', col: 2 }), judgement: 'great', hand: 'right' }));
    expect(names()).toEqual(['zap', 'poof', 'glint']);
    expect(last('zap').pan).toBe(SFX_PAN_BEAM);
    play.mockClear();
    events.emit('note:miss', { note: note() });
    events.emit('note:miss', { note: note({ id: 2 }) });
    context.currentTime += 0.1;
    events.emit('note:miss', { note: note({ id: 3 }) });
    expect(names()).toEqual(['miss', 'miss']);
    events.emit('note:badcut', { note: note({ col: 3 }), hand: 'right', gesture: 'fist' });
    expect(last('badcut').pan).toBeGreaterThan(0);
  });
  it('times the wall warning to arrival, from the wall side, and plays hit/dodge', () => {
    startSession();
    const arrival = START + 6 - SFX_LIMITER_LOOKAHEAD_S;
    events.emit('obstacle:spawn', { obstacle: obstacle() });
    expect(last('wallWarn')).toMatchObject({
      at: arrival - SFX_WALL_WARN_LEAD_S,
      offset: 0,
      pan: -SFX_PAN_WALL,
    });
    context.currentTime = arrival - 0.2;
    events.emit('obstacle:spawn', { obstacle: obstacle({ kind: 'wallRight' }) });
    expect(last('wallWarn').offset).toBeCloseTo(SFX_WALL_WARN_LEAD_S - 0.2, 9);
    expect(last('wallWarn').pan).toBe(SFX_PAN_WALL);
    context.currentTime = arrival + 0.1;
    play.mockClear();
    events.emit('obstacle:spawn', { obstacle: obstacle() });
    expect(names()).toEqual([]);
    events.emit('obstacle:hit', { obstacle: obstacle({ kind: 'wallRight' }) });
    events.emit('obstacle:dodged', { obstacle: obstacle({ kind: 'bar' }), scoreDelta: 50 });
    expect(names()).toEqual(['wallHit', 'dodge']);
    expect(last('dodge').pan).toBe(wallPan('bar'));
  });
  it('rewards multiplier steps and milestones in the track mode and softens combo breaks', () => {
    startSession();
    const combo = (value: number, multiplier: number, broke = false): void =>
      events.emit('combo:change', { combo: value, multiplier, broke });
    combo(5, 2);
    expect(last('combo').rate).toBe(1);
    combo(10, 2);
    expect(last('milestone').rate).toBe(1);
    combo(15, 4);
    expect(last('combo').rate).toBeCloseTo(2 ** (4 / 12), 9);
    combo(25, 4);
    expect(last('milestone').rate).toBeCloseTo(2 ** (4 / 12), 9);
    combo(200, 8);
    expect(last('milestone').rate).toBe(2);
    play.mockClear();
    combo(0, 1, true);
    expect(names()).toEqual(['comboBreak']);
    combo(3, 1);
    combo(0, 1, true);
    expect(names()).toEqual(['comboBreak']);
    store.set({ calm: true });
    combo(12, 2);
    play.mockClear();
    combo(0, 1, true);
    expect(names()).toEqual([]);
  });
  it('schedules drop stings on their exact chart time from the per-frame lookahead', () => {
    startSession({
      map: map([
        { t: 1000, kind: 'kick', intensity: 1 },
        { t: 2000, kind: 'drop', intensity: 1 },
      ]),
    });
    context.currentTime = START + 1.5;
    events.emit('song:progress', { songTimeMs: 1500, durationMs: 60000 });
    expect(names()).toEqual([]);
    context.currentTime = START + 1.95;
    events.emit('song:progress', { songTimeMs: 1950, durationMs: 60000 });
    events.emit('song:progress', { songTimeMs: 1960, durationMs: 60000 });
    expect(names()).toEqual(['drop']);
    expect(last('drop').at).toBeCloseTo(START + 2 - SFX_LIMITER_LOOKAHEAD_S, 9);
  });
});

describe('audio director: lifecycle cues', () => {
  it('schedules a pitched musical count for confident tempo and neutral ticks otherwise', () => {
    director.beginSession({ map: map(), startAt: START, stepMs: 500, confidentTempo: true, music: null });
    expect(calls().map(([name, options]) => [name, options.at])).toEqual([
      ['count', START - 1.5 - SFX_LIMITER_LOOKAHEAD_S],
      ['count', START - 1 - SFX_LIMITER_LOOKAHEAD_S],
      ['countGo', START - 0.5 - SFX_LIMITER_LOOKAHEAD_S],
    ]);
    play.mockClear();
    director.beginSession({ map: map(), startAt: 11.2, stepMs: 600, confidentTempo: false, music: null });
    // The first tick would be in the past: it is skipped rather than played late.
    expect(names()).toEqual(['countNeutral', 'countNeutral']);
    expect(last('countNeutral').rate).toBe(SFX_NEUTRAL_GO_RATE);
  });
  it('silences on pause, plays resume, and picks the results sting by rank', () => {
    const silence = vi.spyOn(SfxBus.prototype, 'silenceSounding');
    startSession();
    state('PLAYING', 'PAUSED');
    expect(silence).toHaveBeenCalledTimes(1);
    state('PAUSED', 'PLAYING');
    expect(names()).toEqual(['resume']);
    events.emit('session:end', { rank: 'S' } as GameEvents['session:end']);
    state('PLAYING', 'RESULTS');
    expect(names().at(-1)).toBe('resultsHigh');
    startSession();
    events.emit('session:end', { rank: 'B' } as GameEvents['session:end']);
    state('PLAYING', 'RESULTS');
    expect(names().at(-1)).toBe('resultsLow');
  });
  it('confirms the unlock once, never on resume, and follows Calm', () => {
    state('BOOT', 'SELECT');
    store.set({ audioReady: true });
    expect(names()).toEqual(['uiEnable']);
    store.set({ audioReady: false });
    state('SELECT', 'CALIBRATION');
    state('CALIBRATION', 'PLAYING');
    state('PLAYING', 'PAUSED');
    play.mockClear();
    store.set({ audioReady: true });
    expect(names()).toEqual([]);
    const voicing = vi.spyOn(SfxBus.prototype, 'setVoicing');
    store.set({ calm: true });
    expect(voicing).toHaveBeenCalledWith({ calm: true });
  });
  it('tunes pitched cues to the estimated tonic once per music buffer', async () => {
    const voicing = vi.spyOn(SfxBus.prototype, 'setVoicing');
    renderer.center = { pitchClass: 9, mode: 'minor', correlation: 0.9 };
    const data = new Float32Array(22050 * 6);
    const music = { length: data.length, sampleRate: 22050, numberOfChannels: 1, getChannelData: () => data };
    startSession({ music });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voicing).toHaveBeenLastCalledWith({ rootHz: 880 });
    // Minor mode: the multiplier step uses a minor third.
    events.emit('combo:change', { combo: 15, multiplier: 4, broke: false });
    expect(last('combo').rate).toBeCloseTo(2 ** (3 / 12), 9);
    startSession({ music });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderer.tonicCalls).toBe(1);
    startSession({ music: { length: 5, sampleRate: 22050 } as unknown as typeof music });
    expect(voicing).toHaveBeenLastCalledWith({ rootHz: 523.25 });
  });
  it('runs the beam charge cue from capture-time cursors and cancels it cleanly', () => {
    const release = vi.spyOn(SfxBus.prototype, 'release');
    director.hands([cursor('left', 0.5)]);
    expect(names()).toEqual([]);
    startSession();
    director.hands([cursor('left', 0.3)]);
    expect(names()).toEqual(['charge']);
    expect(last('charge').offset).toBeCloseTo(0.3 * (BEAM_CHARGE_MS / 1000), 9);
    expect(last('charge').pan).toBe(-SFX_PAN_BEAM);
    director.hands([cursor('left', 0.6)]);
    expect(names()).toEqual(['charge']);
    director.hands([cursor('left', 0.4)]);
    expect(release).toHaveBeenCalledTimes(1);
    director.hands([cursor('left', 0.45)]);
    expect(names()).toEqual(['charge', 'charge']);
    director.hands([cursor('left', 1)]);
    director.hands([cursor('left', 1)]);
    expect(names()).toEqual(['charge', 'charge']);
    events.emit('beam:fire', {
      hand: 'left',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
      note: null,
    });
    expect(release).toHaveBeenCalledTimes(2);
    director.hands([cursor('right', 0.5, 'open')]);
    expect(names().filter((name) => name === 'charge')).toHaveLength(2);
  });
  it('stops every voice and forgets the session on stop/dispose', () => {
    const stop = vi.spyOn(SfxBus.prototype, 'stop');
    startSession();
    director.stop();
    expect(stop).toHaveBeenCalled();
    events.emit('obstacle:spawn', { obstacle: obstacle() });
    expect(names()).toEqual([]);
    director.dispose();
    expect(events.listenerCount).toBe(0);
    expect(store.listeners.size).toBe(0);
    events.emit('note:hit', hit());
    expect(names()).toEqual([]);
  });
});

describe('audio director: menu cues', () => {
  it('classifies semantic menu actions', () => {
    expect(menuCue('audio')).toBeNull();
    expect(menuCue('volume-up')).toBe('uiHover');
    for (const id of ['back', 'songs', 'cancel-resume', 'camera-cancel', 'ui:select:previous'])
      expect(menuCue(id), id).toBe('uiBack');
    for (const id of ['song:cipher', 'difficulty:hard', 'calm', 'hand', 'ui:select:next'])
      expect(menuCue(id), id).toBe('uiSelect');
    for (const id of ['start', 'confirm', 'performer-trial', 'retry', 'resume'])
      expect(menuCue(id), id).toBe('uiConfirm');
  });
  it('plays native clicks, mouse hover and keyboard focus on registered buttons only', () => {
    state('BOOT', 'SELECT');
    const button = new Button('start');
    const click = new Event('click');
    Object.defineProperty(click, 'target', { value: button });
    win.dispatchEvent(click);
    expect(names()).toEqual(['uiConfirm']);
    button.disabled = true;
    win.dispatchEvent(click);
    expect(names()).toEqual(['uiConfirm']);
    button.disabled = false;
    const over = (pointerType: string, target: Button): void => {
      const event = new Event('pointerover');
      Object.defineProperties(event, { target: { value: target }, pointerType: { value: pointerType } });
      doc.dispatchEvent(event);
    };
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    over('mouse', button);
    over('mouse', button);
    over('touch', new Button('songs'));
    expect(names()).toEqual(['uiConfirm', 'uiHover']);
    const focus = new Event('focusin');
    const focused = new Button('songs');
    Object.defineProperty(focus, 'target', { value: focused });
    vi.spyOn(performance, 'now').mockReturnValue(20_000);
    doc.dispatchEvent(focus);
    expect(names()).toEqual(['uiConfirm', 'uiHover']);
    focused.focusVisible = true;
    doc.dispatchEvent(focus);
    expect(names()).toEqual(['uiConfirm', 'uiHover', 'uiHover']);
  });
  it('gives the hand pointer a hover tick per target, an arm cue, and a cue for accepted activations', () => {
    const pointer = (phase: MenuPointerState['phase'], targetId: string | null): MenuPointerState => ({
      hand: 'right',
      visible: true,
      xCss: 0,
      yCss: 0,
      phase,
      targetId,
      progress: 0,
    });
    vi.spyOn(performance, 'now').mockReturnValue(30_000);
    director.pointer(pointer('hover', 'start'));
    director.pointer(pointer('hover', 'start'));
    director.pointer(pointer('armed', 'start'));
    director.pointer(pointer('confirming', 'start'));
    director.menuAction('start');
    expect(names()).toEqual(['uiHover', 'uiArm', 'uiConfirm']);
    director.pointer(pointer('idle', null));
    vi.spyOn(performance, 'now').mockReturnValue(40_000);
    director.pointer(pointer('hover', 'start'));
    expect(names().at(-1)).toBe('uiHover');
  });
});

describe('audio director: preparation', () => {
  it('warms every sound exactly once, menu feedback first', () => {
    expect([...WARM_ORDER].sort()).toEqual([...SFX_IDS].sort());
    expect(WARM_ORDER.slice(0, 2)).toEqual(['uiEnable', 'uiHover']);
  });
  it('keeps the calm voicing chosen before audio was enabled', () => {
    const calmStore = new Store();
    calmStore.state = { calm: true, audioReady: false };
    const other = new SfxDirector(new TypedEmitter<GameEvents>(), calmStore, {});
    const voicing = vi.spyOn(SfxBus.prototype, 'setVoicing');
    other.attach(context.asAudioContext(), context.destination as unknown as AudioNode, new QuietRenderer());
    expect(voicing).toHaveBeenCalledWith({ calm: true } satisfies Partial<SfxVoicing>);
    other.dispose();
  });
});
