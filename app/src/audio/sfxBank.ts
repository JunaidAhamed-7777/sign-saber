/**
 * Sign Saber — audio/sfxBank.ts
 *
 * Responsibility: Render, validate and cache SFX AudioBuffers per voicing; tonal-centre requests.
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus
 * Inputs: Sound ids and voicings; music frames for tonic estimates
 * Outputs: AudioBuffers (bounded LRU cache)
 *
 * Rendering runs in a module worker when available. Without one (tests, worker failure) each job runs
 * in its own macrotask on the main thread. `resolve` never returns nothing for a valid id: if the exact
 * render is not ready it falls back to another cached voicing, then to a synchronous render.
 */
import { SFX_CACHE_MAX_BUFFERS } from '../core/constants';
import { renderSfx, sfxKey, sfxShape } from './sfxSynth';
import type { SfxId, SfxVoicing } from './sfxSynth';
import { estimateFromFrames } from './tonic';
import type { TonalCenter } from './tonic';
import type { SfxWorkerRequest, SfxWorkerResponse } from './sfxRender.worker';

export interface SfxRenderer {
  render(id: SfxId, sampleRate: number, voicing: SfxVoicing): Promise<Float32Array[]>;
  tonic(frames: Float32Array, sampleRate: number): Promise<TonalCenter | null>;
  dispose(): void;
}
export type BufferFactory = Pick<BaseAudioContext, 'createBuffer' | 'sampleRate'>;

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Main-thread renderer; each job yields first so a warm-up never becomes one long task. */
export class InlineRenderer implements SfxRenderer {
  async render(id: SfxId, sampleRate: number, voicing: SfxVoicing): Promise<Float32Array[]> {
    await nextTask();
    return renderSfx(id, sampleRate, voicing);
  }
  async tonic(frames: Float32Array, sampleRate: number): Promise<TonalCenter | null> {
    await nextTask();
    return estimateFromFrames(frames, sampleRate);
  }
  dispose(): void {}
}

interface Job {
  resolve: (value: SfxWorkerResponse) => void;
  reject: (reason: Error) => void;
}
/** Module-worker renderer. Any worker failure rejects outstanding jobs; the bank then renders inline. */
export class WorkerRenderer implements SfxRenderer {
  private readonly worker: Worker;
  private readonly jobs = new Map<string, Job>();
  private sequence = 0;
  failed = false;
  constructor() {
    this.worker = new Worker(new URL('./sfxRender.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SfxWorkerResponse>) => {
      const response = event.data;
      const job = typeof response?.key === 'string' ? this.jobs.get(response.key) : undefined;
      if (!job) return;
      this.jobs.delete(response.key);
      if (response.type === 'error') job.reject(new Error(response.message));
      else job.resolve(response);
    };
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.fail(new Error('The sound worker stopped; rendering sounds on the main thread.'));
    };
  }
  private fail(error: Error): void {
    this.failed = true;
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
    this.worker.terminate();
  }
  private post(request: SfxWorkerRequest, transfer: Transferable[] = []): Promise<SfxWorkerResponse> {
    if (this.failed) return Promise.reject(new Error('The sound worker is unavailable.'));
    return new Promise((resolve, reject) => {
      this.jobs.set(request.key, { resolve, reject });
      this.worker.postMessage(request, transfer);
    });
  }
  async render(id: SfxId, sampleRate: number, voicing: SfxVoicing): Promise<Float32Array[]> {
    const response = await this.post({ type: 'render', key: `r${++this.sequence}`, id, sampleRate, voicing });
    if (response.type !== 'render' || !Array.isArray(response.channels))
      throw new Error('The sound worker returned an invalid render.');
    return response.channels;
  }
  async tonic(frames: Float32Array, sampleRate: number): Promise<TonalCenter | null> {
    const response = await this.post({ type: 'tonic', key: `t${++this.sequence}`, frames, sampleRate }, [
      frames.buffer,
    ]);
    if (response.type !== 'tonic') throw new Error('The sound worker returned an invalid analysis.');
    return response.center;
  }
  dispose(): void {
    this.fail(new Error('Sound rendering was stopped.'));
  }
}

export function createRenderer(): SfxRenderer {
  try {
    if (typeof Worker === 'function') return new WorkerRenderer();
  } catch {
    /* Worker construction can be blocked by policy; fall back to the main thread. */
  }
  return new InlineRenderer();
}

/** Channels must match the recipe shape exactly and stay finite within full scale. */
export function validRender(id: SfxId, sampleRate: number, channels: unknown): channels is Float32Array[] {
  const shape = sfxShape(id);
  const length = Math.max(1, Math.round(shape.seconds * sampleRate));
  if (!Array.isArray(channels) || channels.length !== shape.channels) return false;
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== length) return false;
    for (const value of channel) if (!(Math.abs(value) <= 1)) return false;
  }
  return true;
}

export class SfxBank {
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly inflight = new Map<string, Promise<AudioBuffer | null>>();
  private renderer: SfxRenderer;
  private disposed = false;
  /** Count of synchronous main-thread fallbacks (diagnostic; expected 0 after warm-up). */
  syncRenders = 0;
  constructor(
    private readonly factory: BufferFactory,
    renderer: SfxRenderer = createRenderer(),
  ) {
    this.renderer = renderer;
  }
  private store(key: string, buffer: AudioBuffer): AudioBuffer {
    this.cache.delete(key);
    this.cache.set(key, buffer);
    while (this.cache.size > SFX_CACHE_MAX_BUFFERS) this.cache.delete(this.cache.keys().next().value!);
    return buffer;
  }
  private toBuffer(channels: Float32Array[]): AudioBuffer {
    const buffer = this.factory.createBuffer(channels.length, channels[0]!.length, this.factory.sampleRate);
    channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    return buffer;
  }
  has(id: SfxId, voicing: SfxVoicing): boolean {
    return this.cache.has(sfxKey(id, voicing));
  }
  /** Exact render if cached; otherwise the closest cached voicing; otherwise a synchronous render. */
  resolve(id: SfxId, voicing: SfxVoicing): AudioBuffer {
    const key = sfxKey(id, voicing);
    const exact = this.cache.get(key);
    if (exact) return this.store(key, exact);
    let fallback: AudioBuffer | undefined;
    const sameCalm = `${id}:${voicing.calm ? 'calm' : 'full'}`;
    for (const [candidate, buffer] of this.cache)
      if (candidate === sameCalm || candidate.startsWith(`${sameCalm}:`)) fallback = buffer;
      else if (!fallback && candidate.startsWith(`${id}:`)) fallback = buffer;
    if (fallback) {
      void this.load(id, voicing);
      return fallback;
    }
    this.syncRenders++;
    return this.store(key, this.toBuffer(renderSfx(id, this.factory.sampleRate, voicing)));
  }
  load(id: SfxId, voicing: SfxVoicing): Promise<AudioBuffer | null> {
    const key = sfxKey(id, voicing);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const sampleRate = this.factory.sampleRate;
    const job = (async (): Promise<AudioBuffer | null> => {
      let channels: unknown;
      try {
        channels = await this.renderer.render(id, sampleRate, voicing);
      } catch {
        if (this.disposed) return null;
        if (!(this.renderer instanceof InlineRenderer)) this.renderer = new InlineRenderer();
        channels = await this.renderer.render(id, sampleRate, voicing);
      }
      if (this.disposed) return null;
      if (!validRender(id, sampleRate, channels)) throw new Error(`Invalid render for sound ${id}`);
      return this.store(key, this.toBuffer(channels));
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }
  /** Render missing sounds one after another (keeps the worker queue short and ordered by priority). */
  async warm(ids: readonly SfxId[], voicing: SfxVoicing): Promise<void> {
    for (const id of ids) {
      if (this.disposed) return;
      try {
        await this.load(id, voicing);
      } catch {
        /* resolve() falls back to a synchronous render if this sound is ever played. */
      }
    }
  }
  async tonic(frames: Float32Array, sampleRate: number): Promise<TonalCenter | null> {
    try {
      return await this.renderer.tonic(frames, sampleRate);
    } catch {
      return this.disposed ? null : estimateFromFrames(frames, sampleRate);
    }
  }
  get size(): number {
    return this.cache.size;
  }
  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.cache.clear();
    this.inflight.clear();
  }
}
