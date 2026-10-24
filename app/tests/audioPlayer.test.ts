import { describe, expect, it } from 'vitest';
import { AudioPlayer } from '../src/audio/player';
import { SfxBus } from '../src/audio/sfx';
import { decodeForPlayback } from '../src/audio/decode';
import { SFX_POLYPHONY } from '../src/core/constants';

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
class FakeNode {
  disconnected = false;
  connect<T>(next: T): T {
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
class FakeGain extends FakeNode {
  gain = new Parameter();
}
class FakeAnalyser extends FakeNode {
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
class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  playbackRate = new Parameter();
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[] = [];
  start(...args: number[]): void {
    this.starts.push(args);
  }
  stop(at = 0): void {
    this.stops.push(at);
  }
}
class FakeContext {
  currentTime = 10;
  state = 'running';
  sampleRate = 22050;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    return {
      length,
      duration: length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
describe('owned audio lifecycle', () => {
  it('schedules the music once and invalidates stopped-source end callbacks', () => {
    const context = new FakeContext();
    const player = new AudioPlayer(context.asAudioContext());
    const buffer = context.createBuffer(1, 22050 * 5, 22050);
    player.prepare(buffer);
    const at = player.start(2000);
    expect(at).toBe(12);
    expect(context.sources[0]!.starts).toEqual([[12]]);
    const oldEnd = context.sources[0]!.onended!;
    player.start(2000);
    oldEnd();
    expect(context.sources[0]!.stops).toHaveLength(1);
    expect(context.sources[0]!.disconnected).toBe(true);
    expect(player.clock.state).toBe('running');
    context.sources[1]!.onended!();
    expect(player.clock.state).toBe('ended');
    player.dispose();
    expect(player.clock.state).toBe('idle');
  });
  it('does not create an orphan source if sound is still locked', () => {
    const context = new FakeContext();
    const player = new AudioPlayer(context.asAudioContext());
    player.prepare(context.createBuffer(1, 22050 * 5, 22050));
    context.state = 'suspended';
    expect(() => player.start(2000)).toThrow('Enable sound');
    expect(context.sources).toHaveLength(0);
    expect(player.clock.state).toBe('idle');
    player.dispose();
  });
  it('keeps preview explicit, bounded and exclusive, preserving actual silence in analysis', () => {
    const context = new FakeContext();
    const player = new AudioPlayer(context.asAudioContext());
    const buffer = context.createBuffer(1, 22050 * 20, 22050);
    expect(() => player.preview(buffer, 18000, 5000)).toThrow('outside');
    player.preview(buffer, 1000, 3000);
    expect(context.sources[0]!.starts).toEqual([[10, 1, 3]]);
    player.preview(buffer, 5000, 3000);
    expect(context.sources[0]!.stops).toHaveLength(1);
    expect(player.analyser.update(1 / 60)).toEqual({ low: 0, mid: 0, high: 0, rms: 0 });
    context.state = 'suspended';
    expect(() => player.preview(buffer, 0, 3000)).toThrow('Enable sound');
    player.dispose();
  });
  it('caps per-sound voices, retires them explicitly and remains silent before unlock', () => {
    const context = new FakeContext();
    const bus = new SfxBus(context.asAudioContext());
    context.state = 'suspended';
    bus.play('slash');
    expect(context.sources).toHaveLength(0);
    context.state = 'running';
    for (let index = 0; index < 20; index++) bus.play('slash', 'perfect');
    expect(bus.activeVoices).toBe(SFX_POLYPHONY);
    expect(context.sources[0]!.stops).toHaveLength(1);
    expect(context.sources[19]!.playbackRate.value).toBe(1.03);
    bus.stop();
    expect(bus.activeVoices).toBe(0);
    expect(context.sources[19]!.disconnected).toBe(true);
    bus.dispose();
  });
  it('rejects failed, empty and unsafe decoder output instead of returning ready', async () => {
    const failure = {
      decodeAudioData: async () => {
        throw new Error('unsupported');
      },
    } as unknown as BaseAudioContext;
    await expect(decodeForPlayback(new ArrayBuffer(4), failure)).rejects.toThrow('could not decode');
    await expect(decodeForPlayback(new ArrayBuffer(0), failure)).rejects.toThrow('empty');
    const context = new FakeContext();
    const buffer = context.createBuffer(1, 5 * context.sampleRate, context.sampleRate);
    buffer.getChannelData(0)[0] = NaN;
    const invalid = { decodeAudioData: async () => buffer } as unknown as BaseAudioContext;
    await expect(decodeForPlayback(new ArrayBuffer(4), invalid)).rejects.toThrow('invalid samples');
  });
});
