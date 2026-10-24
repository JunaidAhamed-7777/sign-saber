/** Minimal Web Audio fakes for SFX unit tests. They record calls; they do not produce sound. */
export class FakeParam {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 1) {
    this.value = value;
  }
  cancelScheduledValues(time: number): void {
    this.events.push(['cancel', 0, time]);
  }
  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push(['set', value, time]);
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push(['ramp', value, time]);
  }
}
export class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect<T>(next: T): T {
    this.connections.push(next);
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
export class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}
export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}
export class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[] = [];
  start(...args: number[]): void {
    this.starts.push(args);
  }
  stop(at = 0): void {
    this.stops.push(at);
  }
  /** Simulate the browser's natural end callback. */
  end(): void {
    this.onended?.();
  }
}
export interface FakeBuffer {
  length: number;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}
export class FakeContext {
  currentTime = 10;
  state: string = 'running';
  sampleRate = 22050;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  compressors: FakeCompressor[] = [];
  buffers: FakeBuffer[] = [];
  constructor(options: { panner?: boolean; compressor?: boolean } = {}) {
    if (options.panner === false) (this as { createStereoPanner?: unknown }).createStereoPanner = undefined;
    if (options.compressor === false)
      (this as { createDynamicsCompressor?: unknown }).createDynamicsCompressor = undefined;
  }
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
  createStereoPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }
  createDynamicsCompressor(): FakeCompressor {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = {
      length,
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel]!,
    };
    this.buffers.push(buffer);
    return buffer as unknown as AudioBuffer;
  }
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
