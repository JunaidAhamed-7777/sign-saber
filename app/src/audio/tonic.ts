/**
 * Sign Saber — audio/tonic.ts
 *
 * Responsibility: Cheap tonal-centre estimate of the selected music, used only to tune pitched SFX.
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus (musical pitch)
 * Inputs: Decoded PCM (AudioBuffer-like)
 * Outputs: { pitchClass, mode, correlation } or null when the estimate is weak
 *
 * Krumhansl–Kessler key profiles correlated with a chroma vector from a few Hann-windowed FFT frames.
 * This is a cosmetic heuristic, not verified key detection; it never affects charts or scoring.
 */
import {
  SFX_TONIC_FFT,
  SFX_TONIC_FRAMES,
  SFX_TONIC_MAX_HZ,
  SFX_TONIC_MIN_CORRELATION,
  SFX_TONIC_MIN_HZ,
} from '../core/constants';
import { FFT } from '../beatmap/dsp/fft';

export interface TonalCenter {
  /** 0 = C … 11 = B. */
  pitchClass: number;
  mode: 'major' | 'minor';
  /** Pearson correlation of the chroma vector with the winning key profile. */
  correlation: number;
}
export interface PcmSource {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}
/** Krumhansl & Kessler (1982) probe-tone profiles, tonic first. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Leading/trailing fraction of the track skipped (fades and silence). */
const EDGE_FRACTION = 0.08;

function correlate(chroma: readonly number[], profile: readonly number[], rotation: number): number {
  let meanA = 0,
    meanB = 0;
  for (let index = 0; index < 12; index++) {
    meanA += chroma[index]!;
    meanB += profile[index]!;
  }
  meanA /= 12;
  meanB /= 12;
  let numerator = 0,
    varA = 0,
    varB = 0;
  for (let index = 0; index < 12; index++) {
    const a = chroma[(index + rotation) % 12]! - meanA,
      b = profile[index]! - meanB;
    numerator += a * b;
    varA += a * a;
    varB += b * b;
  }
  return varA > 0 && varB > 0 ? numerator / Math.sqrt(varA * varB) : 0;
}

/**
 * Copy `SFX_TONIC_FRAMES` mono frames of `SFX_TONIC_FFT` samples, evenly spaced across the interior of
 * the track. This is the only main-thread work (a small copy); the FFT runs where `estimateFromFrames` runs.
 */
export function sampleTonicFrames(source: PcmSource): Float32Array | null {
  const size = SFX_TONIC_FFT;
  if (
    !(source.length >= size) ||
    !(source.sampleRate > 0) ||
    !(source.numberOfChannels >= 1) ||
    typeof source.getChannelData !== 'function'
  )
    return null;
  const channels = Array.from({ length: source.numberOfChannels }, (_, index) =>
    source.getChannelData(index),
  );
  const first = Math.floor(source.length * EDGE_FRACTION);
  const span = Math.max(0, source.length - size - 2 * first);
  const frames = new Float32Array(size * SFX_TONIC_FRAMES);
  for (let frame = 0; frame < SFX_TONIC_FRAMES; frame++) {
    const start = first + Math.floor((span * frame) / Math.max(1, SFX_TONIC_FRAMES - 1));
    for (const channel of channels) {
      const slice = channel.subarray(start, start + size);
      for (let index = 0; index < slice.length; index++) frames[frame * size + index]! += slice[index]!;
    }
  }
  return frames;
}

/** Chroma (12 pitch-class energies) of frames from `sampleTonicFrames`, or null when silent/invalid. */
export function chromaOf(frames: Float32Array, sampleRate: number): number[] | null {
  const size = SFX_TONIC_FFT;
  const count = Math.floor(frames.length / size);
  if (count < 1 || !(sampleRate > 0)) return null;
  const fft = new FFT(size);
  const re = new Float64Array(size),
    im = new Float64Array(size),
    window = new Float64Array(size);
  for (let index = 0; index < size; index++)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  const lowBin = Math.max(1, Math.ceil((SFX_TONIC_MIN_HZ * size) / sampleRate));
  const highBin = Math.min(size / 2 - 1, Math.floor((SFX_TONIC_MAX_HZ * size) / sampleRate));
  // Per-bin pitch class and weight: bins near a semitone centre count fully, quarter-tone bins not at all.
  const classes = new Uint8Array(highBin + 1),
    weights = new Float64Array(highBin + 1);
  for (let bin = lowBin; bin <= highBin; bin++) {
    const midi = 69 + 12 * Math.log2((bin * sampleRate) / size / 440);
    const nearest = Math.round(midi);
    classes[bin] = ((nearest % 12) + 12) % 12;
    weights[bin] = Math.max(0, 1 - 2 * Math.abs(midi - nearest));
  }
  const chroma = new Array<number>(12).fill(0);
  let energy = 0;
  for (let frame = 0; frame < count; frame++) {
    for (let index = 0; index < size; index++) {
      re[index] = frames[frame * size + index]! * window[index]!;
      im[index] = 0;
    }
    fft.transform(re, im);
    for (let bin = lowBin; bin <= highBin; bin++) {
      const weighted = Math.sqrt(re[bin]! * re[bin]! + im[bin]! * im[bin]!) * weights[bin]!;
      chroma[classes[bin]!]! += weighted;
      energy += weighted;
    }
  }
  return energy > 0 && Number.isFinite(energy) ? chroma : null;
}

/** Best-correlated major/minor key, or null when the frames are silent or tonally ambiguous. */
export function estimateFromFrames(frames: Float32Array, sampleRate: number): TonalCenter | null {
  const chroma = chromaOf(frames, sampleRate);
  if (!chroma) return null;
  let best: TonalCenter | null = null;
  for (let pitchClass = 0; pitchClass < 12; pitchClass++)
    for (const mode of ['major', 'minor'] as const) {
      const correlation = correlate(chroma, mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE, pitchClass);
      if (!best || correlation > best.correlation) best = { pitchClass, mode, correlation };
    }
  return best && best.correlation >= SFX_TONIC_MIN_CORRELATION ? best : null;
}

/** Convenience for tests and offline tools: sample and estimate in one call. */
export function estimateTonalCenter(source: PcmSource): TonalCenter | null {
  const frames = sampleTonicFrames(source);
  return frames ? estimateFromFrames(frames, source.sampleRate) : null;
}

/** Frequency of a pitch class in the octave starting at `low` (Hz). */
export function pitchClassHz(pitchClass: number, low: number): number {
  let hz = 440 * 2 ** ((pitchClass - 9) / 12);
  while (hz < low) hz *= 2;
  while (hz >= low * 2) hz /= 2;
  return hz;
}
