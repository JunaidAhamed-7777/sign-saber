/** SFX bus and buffer bank lifecycle with a fake AudioContext. Not audible-output evidence. */
import { describe, expect, it } from 'vitest';
import { SfxBus, limiterMakeupDb, voiceLimit } from '../src/audio/sfx';
import { InlineRenderer, SfxBank, validRender } from '../src/audio/sfxBank';
import type { SfxRenderer } from '../src/audio/sfxBank';
import { DEFAULT_VOICING, SFX_IDS, renderSfx, sfxShape } from '../src/audio/sfxSynth';
import type { SfxId, SfxVoicing } from '../src/audio/sfxSynth';
import type { TonalCenter } from '../src/audio/tonic';
import {
  SFX_CACHE_MAX_BUFFERS,
  SFX_LIMITER,
  SFX_LIMITER_LOOKAHEAD_S,
  SFX_MAX_VOICES,
  SFX_PITCH_JITTER_CENTS,
  SFX_POLYPHONY,
  SFX_STOP_RAMP_S,
} from '../src/core/constants';
import { FakeContext } from './fakeAudio';
import type { FakeSource } from './fakeAudio';

/** Renderer whose jobs resolve only when the test says so. */
class ManualRenderer implements SfxRenderer {
  jobs: {
    id: SfxId;
    voicing: SfxVoicing;
    resolve: (channels: Float32Array[]) => void;
    reject: (error: Error) => void;
  }[] = [];
  disposed = false;
  render(id: SfxId, _sampleRate: number, voicing: SfxVoicing): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => this.jobs.push({ id, voicing, resolve, reject }));
  }
  async tonic(): Promise<TonalCenter | null> {
    throw new Error('worker gone');
  }
  dispose(): void {
    this.disposed = true;
  }
}
const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const bus = (context = new FakeContext()): { context: FakeContext; bus: SfxBus } => ({
  context,
  bus: new SfxBus(
    context.asAudioContext(),
    context.destination as unknown as AudioNode,
    new ManualRenderer(),
  ),
});
const voiceSources = (context: FakeContext): FakeSource[] => context.sources;

describe('SFX bus', () => {
  it('stays silent before unlock and after disposal', () => {
    const { context, bus: sfx } = bus();
    context.state = 'suspended';
    expect(sfx.play('slash')).toBeNull();
    expect(context.sources).toHaveLength(0);
    context.state = 'running';
    expect(sfx.play('slash')).not.toBeNull();
    sfx.dispose();
    expect(sfx.play('slash')).toBeNull();
    expect(context.sources[0]!.disconnected).toBe(true);
  });
  it('routes voices through a hard-knee limiter whose spec makeup gain is trimmed back out', () => {
    const { context, bus: sfx } = bus();
    const limiter = context.compressors[0]!;
    expect(limiter.threshold.value).toBe(SFX_LIMITER.thresholdDb);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(SFX_LIMITER.ratio);
    expect(limiterMakeupDb(-3, 20)).toBeCloseTo(1.71, 2);
    expect(20 * Math.log10(sfx.output.gain.value)).toBeCloseTo(-limiterMakeupDb(), 6);
    expect(sfx.latencyS).toBe(SFX_LIMITER_LOOKAHEAD_S);
    sfx.setVolume(0.5);
    expect(sfx.output.gain.value).toBeCloseTo(0.5 * 10 ** (-limiterMakeupDb() / 20), 9);
    sfx.setVolume(Number.NaN);
    expect(sfx.output.gain.value).toBeCloseTo(0.5 * 10 ** (-limiterMakeupDb() / 20), 9);
    const plain = new FakeContext({ compressor: false, panner: false });
    const fallback = new SfxBus(plain.asAudioContext(), undefined, new ManualRenderer());
    expect(fallback.latencyS).toBe(0);
    expect(fallback.output.gain.value).toBe(1);
    expect(fallback.play('slash', { pan: 0.5 })).not.toBeNull();
    expect(plain.panners).toHaveLength(0);
  });
  it('schedules at the requested context time with offset, pan, gain and bounded rate', () => {
    const { context, bus: sfx } = bus();
    sfx.play('slash', { at: 5 });
    expect(context.sources[0]!.starts[0]).toEqual([10, 0]);
    sfx.play('wallWarn', { at: 10.4, offset: 0.1, pan: -2, gainDb: -6, rate: 9 });
    const source = context.sources[1]!;
    expect(source.starts[0]).toEqual([10.4, 0.1]);
    expect(context.panners[1]!.pan.value).toBe(-1);
    expect(source.playbackRate.value).toBe(4);
    expect(20 * Math.log10(context.gains.at(-1)!.gain.value)).toBeCloseTo(-6, 6);
    expect(sfx.play('miss', { offset: 10 })).toBeNull();
    expect(sfx.plays).toMatchObject({ slash: 1, wallWarn: 1 });
  });
  it('caps each sound at its polyphony by fading the oldest voice', () => {
    const { context, bus: sfx } = bus();
    for (let index = 0; index < 20; index++) sfx.play('slash', { rate: 1.03 });
    expect(sfx.countOf('slash')).toBe(SFX_POLYPHONY);
    const first = context.sources[0]!;
    expect(first.stops).toEqual([10 + SFX_STOP_RAMP_S]);
    expect(context.gains.find((gain) => gain.gain.events.some(([kind]) => kind === 'ramp'))).toBeDefined();
    first.end();
    expect(first.disconnected).toBe(true);
    for (let index = 0; index < 5; index++) sfx.play('charge');
    expect(sfx.countOf('charge')).toBe(voiceLimit('charge'));
    expect(voiceLimit('charge')).toBe(2);
  });
  it('never exceeds the global voice cap across sounds', () => {
    const { bus: sfx } = bus();
    for (let round = 0; round < 3; round++) for (const id of SFX_IDS) sfx.play(id);
    expect(sfx.activeVoices).toBeLessThanOrEqual(SFX_MAX_VOICES);
  });
  it('applies seeded cosmetic jitter within ±SFX_PITCH_JITTER_CENTS and repeats after reseed', () => {
    const { context, bus: sfx } = bus();
    for (let index = 0; index < 50; index++) sfx.play('smash', { jitter: true, rate: 0.97 });
    const rates = context.sources.map((source) => source.playbackRate.value);
    const bound = 2 ** (SFX_PITCH_JITTER_CENTS / 1200);
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.97 / bound - 1e-9);
      expect(rate).toBeLessThanOrEqual(0.97 * bound + 1e-9);
    }
    expect(new Set(rates).size).toBeGreaterThan(10);
    sfx.reseed();
    sfx.stop();
    const again = context.sources.length;
    for (let index = 0; index < 50; index++) sfx.play('smash', { jitter: true, rate: 0.97 });
    expect(context.sources.slice(again).map((source) => source.playbackRate.value)).toEqual(rates);
  });
  it('keeps future cues across a pause boundary but silences what is sounding', () => {
    const { context, bus: sfx } = bus();
    const sounding = sfx.play('smash');
    const future = sfx.play('wallWarn', { at: 12 });
    sfx.silenceSounding();
    expect(sfx.isActive(sounding)).toBe(false);
    expect(sfx.isActive(future)).toBe(true);
    expect(context.sources[0]!.stops).toEqual([10 + SFX_STOP_RAMP_S]);
    sfx.stop();
    expect(sfx.activeVoices).toBe(0);
    expect(context.sources.every((source) => source.disconnected)).toBe(true);
  });
  it('releases one voice by handle and cancels a not-yet-started voice outright', () => {
    const { context, bus: sfx } = bus();
    const now = sfx.play('charge');
    const later = sfx.play('charge', { at: 11 });
    sfx.release(later);
    expect(context.sources[1]!.disconnected).toBe(true);
    sfx.release(now, 0.04);
    expect(context.sources[0]!.stops).toEqual([10.04]);
    sfx.release(null);
    expect(sfx.activeVoices).toBe(0);
  });
  it('disconnects every node through repeated session retries', () => {
    const { context, bus: sfx } = bus();
    for (let retry = 0; retry < 20; retry++) {
      for (const id of ['count', 'count', 'countGo', 'slash', 'smash', 'sparkle'] as const) sfx.play(id);
      sfx.stop();
    }
    expect(sfx.activeVoices).toBe(0);
    expect(voiceSources(context).every((source) => source.disconnected)).toBe(true);
    expect(context.panners.every((panner) => panner.disconnected)).toBe(true);
    sfx.dispose();
    expect(sfx.output.gain).toBeDefined();
    expect(context.compressors[0]!.disconnected).toBe(true);
  });
});

describe('SFX buffer bank', () => {
  const valid = (id: SfxId, sampleRate = 22050): Float32Array[] => renderSfx(id, sampleRate, DEFAULT_VOICING);
  it('renders synchronously only as a last resort and caches the result', () => {
    const context = new FakeContext();
    const bank = new SfxBank(context, new ManualRenderer());
    const buffer = bank.resolve('uiHover', DEFAULT_VOICING);
    expect(bank.syncRenders).toBe(1);
    expect(bank.resolve('uiHover', DEFAULT_VOICING)).toBe(buffer);
    expect(bank.syncRenders).toBe(1);
    expect(buffer.length).toBe(Math.round(sfxShape('uiHover').seconds * 22050));
  });
  it('validates worker renders and prefers a cached voicing while the exact render is pending', async () => {
    const context = new FakeContext();
    const renderer = new ManualRenderer();
    const bank = new SfxBank(context, renderer);
    const loading = bank.load('glint', DEFAULT_VOICING);
    renderer.jobs[0]!.resolve(valid('glint'));
    const base = await loading;
    expect(bank.has('glint', DEFAULT_VOICING)).toBe(true);
    const shifted = { ...DEFAULT_VOICING, rootHz: 700 };
    expect(bank.resolve('glint', shifted)).toBe(base);
    expect(bank.syncRenders).toBe(0);
    expect(renderer.jobs[1]!.voicing.rootHz).toBe(700);
    const bad = bank.load('miss', DEFAULT_VOICING);
    renderer.jobs[2]!.resolve([new Float32Array(3)]);
    await expect(bad).rejects.toThrow('Invalid render');
  });
  it('falls back to main-thread rendering when the worker fails', async () => {
    const context = new FakeContext();
    const renderer = new ManualRenderer();
    const bank = new SfxBank(context, renderer);
    const loading = bank.load('count', DEFAULT_VOICING);
    renderer.jobs[0]!.reject(new Error('worker crashed'));
    expect(await loading).not.toBeNull();
    expect(bank.has('count', DEFAULT_VOICING)).toBe(true);
    expect(await bank.tonic(new Float32Array(16), 22050)).toBeNull();
  });
  it('bounds the cache as an LRU', async () => {
    const context = new FakeContext();
    const bank = new SfxBank(context, new InlineRenderer());
    for (let index = 0; index < SFX_CACHE_MAX_BUFFERS + 5; index++)
      await bank.load('glint', { ...DEFAULT_VOICING, rootHz: 523.25 + index });
    expect(bank.size).toBe(SFX_CACHE_MAX_BUFFERS);
    bank.dispose();
    expect(bank.size).toBe(0);
  });
  it('warms in the requested order and stops after disposal', async () => {
    const context = new FakeContext();
    const renderer = new ManualRenderer();
    const bank = new SfxBank(context, renderer);
    const warming = bank.warm(['uiHover', 'count'], DEFAULT_VOICING);
    await flush();
    expect(renderer.jobs.map((job) => job.id)).toEqual(['uiHover']);
    renderer.jobs[0]!.resolve(valid('uiHover'));
    await flush();
    expect(renderer.jobs.map((job) => job.id)).toEqual(['uiHover', 'count']);
    bank.dispose();
    renderer.jobs[1]!.resolve(valid('count'));
    await warming;
    expect(renderer.disposed).toBe(true);
    expect(bank.size).toBe(0);
  });
  it('rejects malformed renders', () => {
    const good = valid('miss');
    expect(validRender('miss', 22050, good)).toBe(true);
    expect(validRender('miss', 22050, [good[0]!, good[0]!])).toBe(false);
    expect(validRender('miss', 44100, good)).toBe(false);
    const loud = good.map((channel) => channel.slice());
    loud[0]![5] = 1.5;
    expect(validRender('miss', 22050, loud)).toBe(false);
    const nan = good.map((channel) => channel.slice());
    nan[0]![5] = Number.NaN;
    expect(validRender('miss', 22050, nan)).toBe(false);
    expect(validRender('miss', 22050, 'nope')).toBe(false);
  });
});
