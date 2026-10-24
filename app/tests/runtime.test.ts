/** Mocked browser lifecycle tests. These are not live-camera or audible-output evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeatmapV1, BundledTrackEntry } from '../src/beatmap/types';
import type { TrackingFrame } from '../src/core/types';
import { syntheticFrame } from './tracking-fixtures';

const mocks = vi.hoisted(() => ({
  library: vi.fn(),
  map: vi.fn(),
  bytes: vi.fn(),
  decode: vi.fn(),
  cameraStart: vi.fn(),
  renderers: [] as Record<string, unknown>[],
  cameras: [] as Record<string, unknown>[],
}));
vi.mock('../src/beatmap/bundled', () => ({
  loadBundledLibrary: mocks.library,
  loadBundledMap: mocks.map,
  loadBundledAudioBytes: mocks.bytes,
}));
vi.mock('../src/audio/decode', () => ({ decodeForPlayback: mocks.decode }));
vi.mock('../src/beatmap/generatorClient', () => ({
  GeneratorClient: class {
    cancel = vi.fn();
    dispose = vi.fn();
    generate = vi.fn();
  },
}));
vi.mock('../src/render/renderer', () => ({
  ArenaRenderer: class {
    setMode = vi.fn();
    setStage = vi.fn();
    setCalm = vi.fn();
    setMusicBands = vi.fn();
    setApproachMs = vi.fn();
    resize = vi.fn();
    hideTracking = vi.fn();
    tracking = vi.fn();
    hands = vi.fn();
    draw = vi.fn();
    finish = vi.fn();
    reset = vi.fn();
    dispose = vi.fn();
    setFrozenTime = vi.fn();
    constructor() {
      mocks.renderers.push(this as unknown as Record<string, unknown>);
    }
  },
}));
vi.mock('../src/tracking/camera', () => ({
  CameraController: class {
    identity = '';
    settings = null;
    stats = {};
    generation = 0;
    onFrame: ((frame: TrackingFrame) => void) | null = null;
    onStatus: ((message: string) => void) | null = null;
    client = { pauseCapture: vi.fn(), start: vi.fn() };
    start = vi.fn(
      async (
        _video: HTMLVideoElement,
        onFrame: (frame: TrackingFrame) => void,
        _onError: (message: string) => void,
        onStatus: (message: string) => void,
      ) => {
        this.identity = `synthetic-camera-${++this.generation}`;
        this.onFrame = onFrame;
        this.onStatus = onStatus;
        await mocks.cameraStart();
      },
    );
    stop = vi.fn(() => {
      this.identity = '';
    });
    setCaptureVisible = vi.fn();
    constructor() {
      mocks.cameras.push(this as unknown as Record<string, unknown>);
    }
  },
}));

import { GameRuntime } from '../src/core/runtime';
import { useStore } from '../src/state/store';
import { DatasetTrial, validateDatasetTrial } from '../src/tracking/datasetTrial';
import datasetFixture from '../public/assets/fixtures/coco-upper-body-trial.json';
import { COUNTDOWN_STEPS, START_COUNTDOWN_MS } from '../src/core/constants';

let now = 0;
let nextRaf = 0;
let raf = new Map<number, FrameRequestCallback>();
let suspendGate: Promise<void> | null = null;
let resumeGate: Promise<void> | null = null;
let runtime: GameRuntime | null = null;
const initialDisplay = structuredClone(useStore.getState());

class Parameter {
  value = 1;
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}
class Node {
  disconnected = false;
  connect<T>(next: T): T {
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
class Gain extends Node {
  gain = new Parameter();
}
class Analyser extends Node {
  fftSize = 1024;
  smoothingTimeConstant = 0;
  frequencyBinCount = 512;
  getByteFrequencyData(out: Uint8Array): void {
    out.fill(0);
  }
  getFloatTimeDomainData(out: Float32Array): void {
    out.fill(0);
  }
}
class Source extends Node {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  playbackRate = new Parameter();
  starts: number[][] = [];
  stops = 0;
  start(...values: number[]): void {
    this.starts.push(values);
  }
  stop(): void {
    this.stops++;
  }
}
class Context {
  static instances: Context[] = [];
  state: AudioContextState = 'suspended';
  sampleRate = 22050;
  baseLatency = 0;
  outputLatency = 0;
  destination = new Node();
  sources: Source[] = [];
  onstatechange: (() => void) | null = null;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  private frozen = 0;
  private anchor = 0;
  constructor() {
    Context.instances.push(this);
  }
  get currentTime(): number {
    return this.frozen + (this.state === 'running' ? (now - this.anchor) / 1000 : 0);
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    if (resumeGate) await resumeGate;
    if (this.state === 'closed') throw new Error('closed');
    if (this.state !== 'running') {
      this.anchor = now;
      this.state = 'running';
      this.onstatechange?.();
    }
  }
  async suspend(): Promise<void> {
    this.suspendCalls++;
    if (suspendGate) await suspendGate;
    this.frozen = this.currentTime;
    this.state = 'suspended';
    this.onstatechange?.();
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
  }
  createGain(): Gain {
    return new Gain();
  }
  createAnalyser(): Analyser {
    return new Analyser();
  }
  createBufferSource(): Source {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  /** Only the SFX bus creates buffers here; music comes from the mocked decoder. */
  readonly sfxBuffers = new WeakSet<object>();
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    const created = {
      length,
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels: 1,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    this.sfxBuffers.add(created);
    return created;
  }
  /** Music/preview sources, excluding synthesized SFX voices. */
  get music(): Source[] {
    return this.sources.filter((source) => !source.buffer || !this.sfxBuffers.has(source.buffer));
  }
}
class OfflineContext {
  static created = 0;
  constructor() {
    OfflineContext.created++;
  }
}
class Element extends EventTarget {
  tagName = 'DIV';
}
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const buffer = (): AudioBuffer => ({ duration: 5, length: 110250, sampleRate: 22050 }) as AudioBuffer;
function track(slug: string): BundledTrackEntry {
  return {
    slug,
    title: slug,
    artist: 'Synthetic fixture',
    role: 'intro',
    audioUrl: `/assets/tracks/${slug}/audio.mp3`,
    durationMs: 5000,
    bpm: null,
    preview: { startMs: 0, durationMs: 2000 },
    difficultyMaps: {
      easy: `/assets/tracks/${slug}/easy.json`,
      normal: `/assets/tracks/${slug}/normal.json`,
      hard: `/assets/tracks/${slug}/hard.json`,
    },
    generatorVersion: 1,
    warnings: ['lowTempoConfidence'],
    hashes: {
      audioSha256: '0'.repeat(64),
      canonicalPcmSha256: '0'.repeat(64),
      maps: { easy: '0'.repeat(64), normal: '0'.repeat(64), hard: '0'.repeat(64) },
    },
    rights: {
      sourceUrl: 'https://example.invalid/synthetic',
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'Synthetic tests only',
      changes: 'No audio packaged by this fixture',
    },
  };
}
function chart(slug: string): BeatmapV1 {
  return {
    version: 1,
    generatorVersion: 1,
    song: {
      title: slug,
      artist: 'Synthetic fixture',
      durationMs: 5000,
      bpm: 120,
      beatOffsetMs: 0,
      sourceHash: '0'.repeat(64),
      source: 'bundled',
      audioUrl: `/assets/tracks/${slug}/audio.mp3`,
    },
    difficulty: 'normal',
    approachMs: 2000,
    notes: [{ id: 0, t: 1000, type: 'slash', col: 2, row: 1, dir: 'any', strength: 1 }],
    obstacles: [],
    events: [],
    analysis: { beats: [], onsets: [], energy: [] },
  };
}
function step(time: number): void {
  now = time;
  const callbacks = [...raf.values()];
  raf.clear();
  for (const callback of callbacks) callback(now);
}
function registerTarget(id: string): void {
  const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
  const button = {
    isConnected: true,
    disabled: false,
    dataset: {},
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
    getAttribute: () => null,
  } as unknown as HTMLButtonElement;
  runtime!.targets.register(id, button, () => {});
}
let sequence = 0;
function emit(present = true): void {
  const frame = syntheticFrame(sequence++, now);
  if (!present) {
    frame.hands = [];
    frame.pose = null;
    frame.mask = null;
  }
  (runtime!.camera as unknown as { onFrame: (frame: TrackingFrame) => void }).onFrame(frame);
}
function advance(durationMs: number, present = true): void {
  const end = now + durationMs;
  while (now < end) {
    now = Math.min(end, now + 30);
    emit(present);
    step(now);
  }
}
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
async function prepare(): Promise<void> {
  await runtime!.boot();
  await runtime!.command('song:a');
  await runtime!.command('audio');
  await runtime!.command('camera');
  advance(700);
  await runtime!.command('camera-confirm');
  expect(useStore.getState().camera.calibrationValid).toBe(true);
}
async function play(): Promise<void> {
  if (runtime!.machine.state === 'SELECT') {
    advance(700);
    await runtime!.command('start');
    expect(runtime!.machine.state).toBe('CALIBRATION');
    advance(1500);
    await runtime!.command('confirm');
    advance(2100);
    await flush();
    expect(runtime!.machine.state).toBe('PLAYING');
  }
}

beforeEach(() => {
  now = 100;
  sequence = 0;
  nextRaf = 0;
  raf = new Map();
  suspendGate = resumeGate = null;
  Context.instances = [];
  OfflineContext.created = 0;
  mocks.renderers.length = mocks.cameras.length = 0;
  mocks.library.mockReset().mockResolvedValue([track('a'), track('b')]);
  mocks.map.mockReset().mockImplementation(async (entry: BundledTrackEntry) => chart(entry.slug));
  mocks.bytes.mockReset().mockResolvedValue(new ArrayBuffer(4));
  mocks.decode.mockReset().mockResolvedValue(buffer());
  mocks.cameraStart.mockReset().mockResolvedValue(undefined);
  useStore.setState(structuredClone(initialDisplay), true);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const window = new EventTarget();
  const document = new EventTarget() as EventTarget & { hidden: boolean; createElement: () => Element };
  document.hidden = false;
  document.createElement = () => new Element();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('HTMLButtonElement', Element);
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    raf.set(++nextRaf, callback);
    return nextRaf;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => raf.delete(id));
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('OfflineAudioContext', OfflineContext);
  runtime = new GameRuntime(new Element() as unknown as HTMLElement);
});
afterEach(() => {
  runtime?.dispose();
  runtime = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runtime browser lifecycle (mocked boundaries)', () => {
  it('reports each hand only while its capture is fresh', async () => {
    await prepare();
    await play();
    advance(100);
    expect(useStore.getState().hud).toMatchObject({ leftPresent: true, rightPresent: true });
    step(now + 300);
    expect(useStore.getState().hud).toMatchObject({
      leftPresent: false,
      rightPresent: false,
      left: 'none',
      right: 'none',
      leftCharge: 0,
      rightCharge: 0,
    });
  });
  it('runs a dataset trial through pause, resume, results and keyboard retry without camera', async () => {
    vi.spyOn(DatasetTrial, 'load').mockImplementation(
      async () => new DatasetTrial(validateDatasetTrial(datasetFixture), now),
    );
    await runtime!.boot();
    await runtime!.command('song:a');
    await runtime!.command('audio');
    useStore.setState({
      arrangement: {
        active: false,
        ready: true,
        stage: 'ready',
        fraction: 1,
        sourceTitle: 'Test',
        durationMs: 5000,
        error: null,
      },
    });
    await runtime!.command('dataset-trial');
    step(now + 3000);
    await flush();
    expect(runtime!.machine.state).toBe('PLAYING');
    expect(runtime!.datasetTrialActive).toBe(true);
    expect(runtime!.camera.start).not.toHaveBeenCalled();
    expect(useStore.getState().camera.calibrationValid).toBe(false);
    expect(useStore.getState().hud).toMatchObject({
      leftPresent: false,
      rightPresent: false,
      leftCharge: 0,
      rightCharge: 0,
    });
    await runtime!.pause('manual');
    await runtime!.command('resume');
    step(now + 1600);
    await flush();
    expect(runtime!.machine.state).toBe('PLAYING');
    step(now + 7000);
    await flush();
    expect(runtime!.machine.state).toBe('RESULTS');
    expect(useStore.getState().results?.counts).toMatchObject({ perfect: 0, great: 0, good: 0, miss: 1 });
    const event = Object.assign(new Event('keydown'), { code: 'Enter', isComposing: false });
    window.dispatchEvent(event);
    await flush();
    expect(runtime!.machine.state).toBe('CALIBRATION');
    expect(runtime!.datasetTrialActive).toBe(true);
    expect(runtime!.camera.start).not.toHaveBeenCalled();
  });
  it('browses and decodes without creating a live audio context, requesting camera, or playing sound', async () => {
    await runtime!.boot();
    await runtime!.command('song:a');
    expect(runtime!.machine.state).toBe('SELECT');
    expect(useStore.getState().map?.song.title).toBe('a');
    expect(Context.instances).toHaveLength(0);
    expect(OfflineContext.created).toBe(1);
    expect(runtime!.camera.start).not.toHaveBeenCalled();
    await runtime!.command('audio', 'hand');
    expect(Context.instances).toHaveLength(0);
    await runtime!.command('audio');
    expect(Context.instances).toHaveLength(1);
    expect(Context.instances[0]!.music).toHaveLength(0);
    await runtime!.command('preview');
    expect(Context.instances[0]!.music).toHaveLength(1);
  });
  it('does not let an older failed song request overwrite a newer ready selection', async () => {
    await runtime!.boot();
    const old = deferred<BeatmapV1>();
    mocks.map.mockImplementation((entry: BundledTrackEntry) =>
      entry.slug === 'a' ? old.promise : Promise.resolve(chart('b')),
    );
    const first = runtime!.command('song:a');
    await runtime!.command('song:b');
    old.reject(new Error('old corrupt chart'));
    await first;
    expect(useStore.getState()).toMatchObject({ selectedSlug: 'b', loading: false, error: null });
    expect(useStore.getState().map?.song.title).toBe('b');
  });
  it('keeps camera setup independent of songs and rejects late setup callbacks after cancellation', async () => {
    await runtime!.boot();
    const old = deferred<void>();
    mocks.cameraStart.mockReturnValue(old.promise);
    const setup = runtime!.command('camera');
    const camera = runtime!.camera as unknown as {
      onFrame: (frame: TrackingFrame) => void;
      onStatus: (message: string) => void;
    };
    await runtime!.command('camera-cancel');
    const stage = useStore.getState().cameraStage;
    camera.onStatus('stale ready');
    camera.onFrame(syntheticFrame(0, now));
    old.resolve();
    await setup;
    expect(useStore.getState()).toMatchObject({
      selectedSlug: null,
      figureAvailable: false,
      cameraStage: stage,
      camera: { state: 'not-set-up', calibrationValid: false },
    });
    expect(Context.instances).toHaveLength(0);
  });
  it('pauses on fresh empty tracking frames rather than confusing inference freshness with player presence', async () => {
    await prepare();
    await play();
    advance(1600, false);
    await flush();
    expect(runtime!.machine.state).toBe('PAUSED');
    expect(runtime!.machine.pauseReason).toBe('tracking');
    expect(Context.instances[0]!.state).toBe('suspended');
    expect(mocks.renderers[0]!.setFrozenTime).toHaveBeenCalled();
  });
  it('uses Enable sound in PAUSED as guarded countdown recovery without playing music immediately', async () => {
    await prepare();
    await play();
    await runtime!.pause('manual');
    const context = Context.instances[0]!,
      calls = context.resumeCalls;
    await runtime!.command('audio');
    expect(context.resumeCalls).toBe(calls);
    expect(context.state).toBe('suspended');
    advance(1200);
    await flush();
    expect(context.resumeCalls).toBe(calls);
    expect(runtime!.machine.state).toBe('PAUSED');
    advance(400);
    await flush();
    expect(context.resumeCalls).toBe(calls + 1);
    expect(runtime!.machine.state).toBe('PLAYING');
  });
  it('does not allow unfinished suspension to race Quit or native sound recovery', async () => {
    await prepare();
    await play();
    const gate = deferred<void>();
    suspendGate = gate.promise;
    const pausing = runtime!.pause('manual');
    await runtime!.command('resume');
    await runtime!.command('songs');
    expect(runtime!.machine.state).toBe('SELECT');
    expect(useStore.getState().audioReady).toBe(false);
    const context = Context.instances[0]!,
      calls = context.resumeCalls,
      enabling = runtime!.command('audio');
    await flush();
    expect(context.resumeCalls).toBe(calls);
    gate.resolve();
    await pausing;
    await enabling;
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(calls + 1);
    expect(runtime!.machine.state).toBe('SELECT');
  });
  it('stops the source if suspension fails and requires a safe restart instead of silent resumed scoring', async () => {
    await prepare();
    await play();
    const gate = deferred<void>();
    suspendGate = gate.promise;
    const pausing = runtime!.pause('manual');
    gate.reject(new Error('Audio device suspend failed'));
    await pausing;
    expect(Context.instances[0]!.music.every((source) => source.disconnected)).toBe(true);
    await runtime!.command('resume');
    expect(runtime!.machine.state).toBe('PAUSED');
    expect(useStore.getState().status).toContain('Choose Songs');
  });
  it('cancels an armed start when live framing leaves calibration bounds', async () => {
    await prepare();
    advance(700);
    await runtime!.command('start');
    advance(1500);
    await runtime!.command('confirm');
    expect(Context.instances[0]!.music).toHaveLength(1);
    for (let sample = 0; sample < 15; sample++) {
      now += 30;
      const frame = syntheticFrame(sequence++, now);
      frame.pose!.landmarks[11 * 4] = 0.05;
      frame.pose!.landmarks[12 * 4] = 0.95;
      (runtime!.camera as unknown as { onFrame: (frame: TrackingFrame) => void }).onFrame(frame);
      step(now);
    }
    expect(runtime!.machine.state).toBe('CALIBRATION');
    expect(useStore.getState().countdown).toBeNull();
    expect(Context.instances[0]!.music.every((source) => source.disconnected)).toBe(true);
    expect(useStore.getState().status).toContain('Framing');
  });
  it('finishes a synthetic session with actual miss counts and retries with reset results', async () => {
    await prepare();
    await play();
    advance(7000);
    await flush();
    expect(runtime!.machine.state).toBe('RESULTS');
    expect(useStore.getState().results?.counts.miss).toBe(1);
    expect(useStore.getState().results?.score).toBe(0);
    expect(mocks.renderers[0]!.finish).toHaveBeenCalledTimes(1);
    await runtime!.command('retry');
    expect(runtime!.machine.state).toBe('CALIBRATION');
    expect(useStore.getState().results).toBeNull();
  });
  it('allows only Back during start countdown and Songs/Cancel during resume countdown', async () => {
    for (const id of ['back', 'start', 'songs', 'resume', 'cancel-resume', 'credits']) registerTarget(id);
    await prepare();
    await runtime!.command('credits');
    const modal = (
      runtime as unknown as { menuContext(enabled: boolean): { targets: { id: string }[] } }
    ).menuContext(true);
    expect(modal.targets.map((target) => target.id)).toEqual(['credits']);
    await runtime!.command('start');
    expect(runtime!.machine.state).toBe('SELECT');
    await runtime!.command('credits');
    advance(700);
    await runtime!.command('start');
    advance(1500);
    await runtime!.command('confirm');
    const context = (
      runtime as unknown as { menuContext(enabled: boolean): { targets: { id: string }[] } }
    ).menuContext(true);
    expect(context.targets.map((target) => target.id)).toEqual(['back']);
    await runtime!.command('back');
    expect(runtime!.machine.state).toBe('SELECT');
    expect(Context.instances[0]!.music.every((source) => source.disconnected)).toBe(true);
    await play();
    await runtime!.pause('manual');
    await runtime!.command('resume');
    const resumed = (
      runtime as unknown as { menuContext(enabled: boolean): { targets: { id: string }[] } }
    ).menuContext(true);
    expect(resumed.targets.map((target) => target.id)).toEqual(['songs', 'cancel-resume']);
  });
  it('cancels an asynchronous resume without enabling scoring or leaving audio playing', async () => {
    await prepare();
    await play();
    await runtime!.pause('manual');
    const gate = deferred<void>();
    resumeGate = gate.promise;
    await runtime!.command('resume');
    advance(1600);
    await flush();
    await runtime!.command('cancel-resume');
    gate.resolve();
    await flush();
    expect(runtime!.machine.state).toBe('PAUSED');
    expect(Context.instances[0]!.state).toBe('suspended');
    resumeGate = null;
    await runtime!.command('resume');
    advance(1600);
    await flush();
    expect(runtime!.machine.state).toBe('PLAYING');
  });
  it('confirms the unlock, schedules neutral countdown ticks on the song clock and disconnects SFX on quit', async () => {
    await prepare();
    const context = Context.instances[0]!;
    const sfx = (): Source[] => context.sources.filter((source) => !context.music.includes(source));
    expect(sfx()).toHaveLength(1);
    advance(700);
    await runtime!.command('start');
    advance(1500);
    await runtime!.command('confirm');
    const songStart = context.music[0]!.starts[0]![0]!;
    const step = START_COUNTDOWN_MS / COUNTDOWN_STEPS / 1000;
    const ticks = sfx().slice(1);
    expect(ticks).toHaveLength(COUNTDOWN_STEPS);
    ticks.forEach((tick, index) =>
      expect(tick.starts[0]![0]).toBeCloseTo(songStart - (COUNTDOWN_STEPS - index) * step, 6),
    );
    expect(sfx()[0]!.disconnected).toBe(true);
    advance(2100);
    await flush();
    expect(runtime!.machine.state).toBe('PLAYING');
    await runtime!.pause('manual');
    await runtime!.command('songs');
    expect(sfx().every((source) => source.disconnected)).toBe(true);
  });
  it('releases sources through twenty restart/quit cycles without recreating camera resources', async () => {
    await prepare();
    for (let iteration = 0; iteration < 20; iteration++) {
      await play();
      await runtime!.pause('manual');
      await runtime!.command('songs');
      await runtime!.command('audio');
    }
    expect(Context.instances).toHaveLength(1);
    expect(runtime!.camera.start).toHaveBeenCalledTimes(1);
    expect(Context.instances[0]!.music).toHaveLength(20);
    expect(Context.instances[0]!.music.every((source) => source.disconnected)).toBe(true);
    const camera = runtime!.camera;
    runtime!.dispose();
    runtime!.dispose();
    expect(camera.stop).toHaveBeenCalledTimes(1);
    expect(Context.instances[0]!.closeCalls).toBe(1);
    expect(raf.size).toBe(0);
  });
});
