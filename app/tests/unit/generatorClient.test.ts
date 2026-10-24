import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeatmapV1 } from '../../src/beatmap/types';
import type { GenRequest } from '../../src/beatmap/generator.worker';
import type * as CacheModule from '../../src/beatmap/cache';
import { GeneratorClient } from '../../src/beatmap/generatorClient';
import { APPROACH_MS, GENERATOR_VERSION } from '../../src/core/constants';
vi.mock('../../src/audio/decode', () => ({
  decodeForPlayback: vi.fn(async () => ({ duration: 10, sampleRate: 44100 })),
}));
vi.mock('../../src/beatmap/dsp/resample', () => ({
  monoForAnalysis: vi.fn(async () => new Float32Array(220500)),
}));
vi.mock('../../src/beatmap/cache', async (importOriginal) => {
  const original = await importOriginal<typeof CacheModule>();
  return {
    ...original,
    BeatmapCache: class {
      async get() {
        return undefined;
      }
      async getAnalysis() {
        return undefined;
      }
      async put() {}
      async putAnalysis() {}
      async close() {}
    },
  };
});
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: GenRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: GenRequest): void {
    this.messages.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(value: unknown): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }
}
const file = (): File =>
  new File([new Uint8Array([1, 2, 3])], 'Synthetic fixture.wav', { type: 'audio/wav' });
function returnedMap(worker: FakeWorker): BeatmapV1 {
  const request = worker.messages[0]!;
  if (request.type === 'cancel') throw new Error('Expected active analysis request');
  return {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    song: { ...request.meta, durationMs: 10000, bpm: 120, beatOffsetMs: 0 },
    difficulty: request.difficulty,
    approachMs: APPROACH_MS[request.difficulty],
    notes: [{ id: 0, t: 1000, type: 'slash', col: 1, row: 1, dir: 'any', strength: 1 }],
    obstacles: [],
    events: [],
    analysis: { beats: [], onsets: [], energy: [] },
  };
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());
describe('generation job lifecycle (synthetic browser boundaries)', () => {
  it('cancels immediately even while a native read promise cannot be aborted', async () => {
    const client = new GeneratorClient({} as BaseAudioContext);
    const slowFile = {
      name: 'slow.wav',
      size: 10,
      arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
    } as File;
    const result = client.generate(slowFile, 'normal');
    client.cancel();
    await expect(result).rejects.toThrow('cancelled');
    expect(FakeWorker.instances).toHaveLength(0);
    client.dispose();
  });
  it('terminates an old worker and prevents its late result from resolving a new job', async () => {
    const client = new GeneratorClient({} as BaseAudioContext);
    const first = client.generate(file(), 'normal').catch((error) => error);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const old = FakeWorker.instances[0]!;
    const second = client.generate(file(), 'hard');
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(await first).toBeInstanceOf(Error);
    expect(old.terminated).toBe(true);
    const latest = FakeWorker.instances[1]!,
      id = latest.messages[0]!.jobId;
    old.emit({ type: 'done', jobId: id, map: returnedMap(old), warnings: [] });
    latest.emit({ type: 'done', jobId: id, map: returnedMap(latest), warnings: ['lowTempoConfidence'] });
    expect(await second).toMatchObject({ map: { difficulty: 'hard' }, warnings: ['lowTempoConfidence'] });
    client.dispose();
  });
  it.each([null, {}, { type: 'unknown' }, { type: 'progress', stage: 'stft', fraction: NaN }])(
    'rejects an unexpected worker response without an unhandled dereference',
    async (response) => {
      const client = new GeneratorClient({} as BaseAudioContext);
      const result = client.generate(file(), 'normal');
      const rejection = expect(result).rejects.toThrow(/invalid|unknown/);
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
      const worker = FakeWorker.instances[0]!;
      worker.emit(
        response && typeof response === 'object'
          ? { ...response, jobId: worker.messages[0]!.jobId }
          : response,
      );
      await rejection;
      expect(worker.terminated).toBe(true);
      client.dispose();
    },
  );
  it('refuses malformed or cross-source maps even when a worker says done', async () => {
    const client = new GeneratorClient({} as BaseAudioContext);
    const result = client.generate(file(), 'normal');
    const rejection = expect(result).rejects.toThrow('invalid chart');
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0]!,
      map = returnedMap(worker);
    map.song.sourceHash = '0'.repeat(64);
    worker.emit({ type: 'done', jobId: worker.messages[0]!.jobId, map, warnings: [] });
    await rejection;
    client.dispose();
  });
});
