/**
 * Sign Saber — audio/sfxMetrics.ts
 *
 * Responsibility: Offline measurements of rendered SFX (peak, RMS, momentary loudness, spectral centroid).
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus (loudness bounds)
 * Inputs: PCM channels and sample rate
 * Outputs: Numbers for synthesis loudness normalization, tests and the render receipt; never gameplay.
 */
import { FFT } from '../beatmap/dsp/fft';

const toDb = (value: number): number => (value > 0 ? 20 * Math.log10(value) : -Infinity);

export function peakDb(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  return toDb(peak);
}

/** RMS over the whole buffer, all channels pooled. */
export function rmsDb(channels: readonly Float32Array[]): number {
  let sum = 0,
    count = 0;
  for (const channel of channels) {
    for (const value of channel) sum += value * value;
    count += channel.length;
  }
  return toDb(Math.sqrt(sum / Math.max(1, count)));
}

/** Loudest RMS over a sliding window (default 50 ms): the perceived "body" level of a short cue. */
export function maxWindowRmsDb(
  channels: readonly Float32Array[],
  sampleRate: number,
  windowS = 0.05,
): number {
  const length = channels[0]?.length ?? 0;
  const window = Math.max(1, Math.min(length, Math.round(windowS * sampleRate)));
  let sum = 0,
    best = 0;
  for (let index = 0; index < length; index++) {
    for (const channel of channels) sum += channel[index]! ** 2;
    if (index >= window) for (const channel of channels) sum -= channel[index - window]! ** 2;
    if (index >= window - 1) best = Math.max(best, sum);
  }
  return toDb(Math.sqrt(Math.max(0, best) / (window * channels.length)));
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}
/** ITU-R BS.1770 K-weighting coefficients for any sample rate (shelf + RLB high-pass). */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const Q = 0.7071752369554196,
    Vh = 10 ** (3.999843853973347 / 20),
    Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  K = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const Qh = 0.5003270373238773;
  a0 = 1 + K / Qh + K * K;
  const highpass = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Qh + K * K) / a0 };
  return [shelf, highpass];
}
function filter(input: Float32Array, stage: Biquad): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let index = 0; index < input.length; index++) {
    const x = input[index]!;
    const y = stage.b0 * x + stage.b1 * x1 + stage.b2 * x2 - stage.a1 * y1 - stage.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[index] = y;
  }
  return output;
}

/**
 * Maximum BS.1770 momentary loudness (400 ms window, 100 ms hop) in LUFS. Short cues are measured
 * against a zero-padded 400 ms window, as a meter would see them in isolation.
 */
export function momentaryLufs(channels: readonly Float32Array[], sampleRate: number): number {
  const [shelf, highpass] = kWeighting(sampleRate);
  const window = Math.round(0.4 * sampleRate),
    hop = Math.round(0.1 * sampleRate);
  const weighted = channels.map((channel) => {
    const padded = new Float32Array(Math.max(channel.length, window) + window);
    padded.set(channel);
    return filter(filter(padded, shelf), highpass);
  });
  const length = weighted[0]!.length;
  let best = 0;
  for (let start = 0; start + window <= length; start += hop) {
    let power = 0;
    for (const channel of weighted) {
      let sum = 0;
      for (let index = start; index < start + window; index++) sum += channel[index]! ** 2;
      power += sum / window;
    }
    best = Math.max(best, power);
  }
  return best > 0 ? -0.691 + 10 * Math.log10(best) : -Infinity;
}

/** Energy-weighted mean spectral centroid in Hz (2048-point Hann frames, 50 % overlap, mono sum). */
export function spectralCentroidHz(channels: readonly Float32Array[], sampleRate: number): number {
  const size = 2048,
    hop = 1024,
    fft = new FFT(size);
  const length = channels[0]?.length ?? 0;
  const re = new Float64Array(size),
    im = new Float64Array(size);
  let weighted = 0,
    total = 0;
  for (let start = 0; start < Math.max(1, length); start += hop) {
    for (let k = 0; k < size; k++) {
      let value = 0;
      for (const channel of channels) value += channel[start + k] ?? 0;
      re[k] = value * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (size - 1)));
      im[k] = 0;
    }
    fft.transform(re, im);
    for (let bin = 1; bin < size / 2; bin++) {
      const energy = re[bin]! ** 2 + im[bin]! ** 2;
      weighted += energy * ((bin * sampleRate) / size);
      total += energy;
    }
  }
  return total > 0 ? weighted / total : 0;
}

/** Mean absolute sample value (DC check) and largest single-sample step (click check). */
export function dcAndMaxStep(channels: readonly Float32Array[]): { dc: number; maxStep: number } {
  let dc = 0,
    maxStep = 0,
    count = 0;
  for (const channel of channels) {
    let previous = 0;
    for (const value of channel) {
      dc += value;
      maxStep = Math.max(maxStep, Math.abs(value - previous));
      previous = value;
      count++;
    }
  }
  return { dc: dc / Math.max(1, count), maxStep };
}

export interface SfxMeasurement {
  seconds: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  bodyRmsDb: number;
  momentaryLufs: number;
  centroidHz: number;
}
export function measureSfx(channels: readonly Float32Array[], sampleRate: number): SfxMeasurement {
  return {
    seconds: (channels[0]?.length ?? 0) / sampleRate,
    channels: channels.length,
    peakDb: peakDb(channels),
    rmsDb: rmsDb(channels),
    bodyRmsDb: maxWindowRmsDb(channels, sampleRate),
    momentaryLufs: momentaryLufs(channels, sampleRate),
    centroidHz: spectralCentroidHz(channels, sampleRate),
  };
}
