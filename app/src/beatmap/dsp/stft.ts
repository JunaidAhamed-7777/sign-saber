import { ANALYSIS_SR, BAND_EDGES_HZ, DSP_EPSILON, FFT_SIZE, HOP, STFT_LOG_GAIN } from '../../core/constants';
import { FFT } from './fft';

export type Band = 'low' | 'mid' | 'high';
export const BANDS: readonly Band[] = ['low', 'mid', 'high'];
export const HOP_MS = (HOP / ANALYSIS_SR) * 1000;
export interface Spectrum {
  frames: number;
  bins: number;
  magnitudes: Float32Array;
  centroid: Float32Array;
  power: Record<Band, Float32Array>;
}

/** Frame n is centred on source sample n*HOP (zero padding at both edges). */
export function stft(mono: Float32Array): Spectrum {
  const frames = Math.floor(mono.length / HOP) + 1,
    bins = FFT_SIZE / 2 + 1;
  const magnitudes = new Float32Array(frames * bins);
  const centroid = new Float32Array(frames);
  const power = {
    low: new Float32Array(frames),
    mid: new Float32Array(frames),
    high: new Float32Array(frames),
  };
  const re = new Float64Array(FFT_SIZE),
    im = new Float64Array(FFT_SIZE),
    window = new Float64Array(FFT_SIZE);
  const fft = new FFT(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  for (let n = 0; n < frames; n++) {
    for (let i = 0; i < FFT_SIZE; i++) re[i] = (mono[n * HOP + i - FFT_SIZE / 2] ?? 0) * window[i]!;
    im.fill(0);
    fft.transform(re, im);
    let total = 0,
      weighted = 0;
    for (let k = 0; k < bins; k++) {
      const hz = (k * ANALYSIS_SR) / FFT_SIZE;
      const squared = re[k]! * re[k]! + im[k]! * im[k]!;
      const mag = Math.log1p(STFT_LOG_GAIN * Math.sqrt(squared));
      magnitudes[n * bins + k] = mag;
      total += mag;
      weighted += hz * mag;
      for (const band of BANDS) {
        const [lo, hi] = BAND_EDGES_HZ[band];
        if (hz >= lo && hz < hi) power[band][n] = power[band][n]! + squared;
      }
    }
    centroid[n] = weighted / Math.max(total, DSP_EPSILON);
  }
  return { frames, bins, magnitudes, centroid, power };
}
