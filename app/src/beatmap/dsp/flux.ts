import {
  ANALYSIS_SR,
  BAND_EDGES_HZ,
  DSP_EPSILON,
  FFT_SIZE,
  FLUX_NORM_PERCENTILE,
  ONSET_SPECTRAL_NOVELTY_MIN,
} from '../../core/constants';
import { BANDS } from './stft';
import type { Band, Spectrum } from './stft';
import { percentile } from './numeric';

export interface Flux {
  bands: Record<Band, Float32Array>;
  sum: Float32Array;
}
export function spectralFlux(spectrum: Spectrum): Flux {
  const { frames, bins, magnitudes } = spectrum;
  const bands = {
    low: new Float32Array(frames),
    mid: new Float32Array(frames),
    high: new Float32Array(frames),
  };
  const sum = new Float32Array(frames);
  const novel = new Uint8Array(frames);
  for (let n = 1; n < frames; n++) {
    let positive = 0,
      previousTotal = 0;
    for (let k = 0; k < bins; k++) {
      const previous = magnitudes[(n - 1) * bins + k]!;
      positive += Math.max(0, magnitudes[n * bins + k]! - previous);
      previousTotal += previous;
    }
    novel[n] = positive / Math.max(previousTotal, DSP_EPSILON) >= ONSET_SPECTRAL_NOVELTY_MIN ? 1 : 0;
  }
  for (const band of BANDS) {
    const [lo, hi] = BAND_EDGES_HZ[band];
    const start = Math.ceil((lo * FFT_SIZE) / ANALYSIS_SR),
      end = Math.min(bins, Math.ceil((hi * FFT_SIZE) / ANALYSIS_SR));
    for (let n = 1; n < frames; n++) {
      if (!novel[n]) continue;
      let value = 0;
      for (let k = start; k < end; k++)
        value += Math.max(0, magnitudes[n * bins + k]! - magnitudes[(n - 1) * bins + k]!);
      bands[band][n] = value;
    }
    const scale = Math.max(percentile(bands[band], FLUX_NORM_PERCENTILE), DSP_EPSILON);
    for (let n = 0; n < frames; n++) {
      bands[band][n] = bands[band][n]! / scale;
      sum[n] = sum[n]! + bands[band][n]!;
    }
  }
  return { bands, sum };
}
