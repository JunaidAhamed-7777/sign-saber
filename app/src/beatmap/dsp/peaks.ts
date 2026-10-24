import {
  ANALYSIS_SR,
  DSP_EPSILON,
  ENERGY_HOP_MS,
  FFT_SIZE,
  ONSET_DELTA,
  ONSET_MAX_RADIUS_FRAMES,
  ONSET_MEAN_POST_FRAMES,
  ONSET_MEAN_PRE_FRAMES,
  ONSET_MIN_GAP_MS,
  ONSET_MIN_STRENGTH,
  ONSET_RAW_RMS_MIN,
  ONSET_RMS_RISE_RATIO,
} from '../../core/constants';
import type { Onset } from '../types';
import type { Flux } from './flux';
import { BANDS, HOP_MS } from './stft';
import { clamp01 } from './numeric';

export function pickOnsets(flux: Flux, rawEnergy: Float32Array, mono: Float32Array): Onset[] {
  const result: Onset[] = [];
  const start = Math.max(ONSET_MEAN_PRE_FRAMES, ONSET_MAX_RADIUS_FRAMES);
  const edge = Math.max(ONSET_MEAN_POST_FRAMES, ONSET_MAX_RADIUS_FRAMES);
  const minFrames = Math.ceil(ONSET_MIN_GAP_MS / HOP_MS);
  for (const band of BANDS) {
    const values = flux.bands[band];
    let last = -minFrames,
      lastIndex = -1;
    for (let n = start; n < values.length - edge; n++) {
      const value = values[n]!;
      if (value < ONSET_MIN_STRENGTH) continue;
      let localMax = true,
        sum = 0;
      for (let j = n - ONSET_MAX_RADIUS_FRAMES; j <= n + ONSET_MAX_RADIUS_FRAMES; j++) {
        if (values[j]! > value || (values[j] === value && j < n)) {
          localMax = false;
          break;
        }
      }
      if (!localMax) continue;
      for (let j = n - ONSET_MEAN_PRE_FRAMES; j <= n + ONSET_MEAN_POST_FRAMES; j++) sum += values[j]!;
      if (value < sum / (ONSET_MEAN_PRE_FRAMES + ONSET_MEAN_POST_FRAMES + 1) + ONSET_DELTA) continue;
      let t = n * HOP_MS;
      const energyIndex = Math.min(rawEnergy.length - 1, Math.floor(t / ENERGY_HOP_MS));
      const currentRms = Math.max(rawEnergy[energyIndex] ?? 0, rawEnergy[energyIndex + 1] ?? 0);
      const priorRms = rawEnergy[Math.max(0, energyIndex - 1)] ?? 0;
      if (
        currentRms < ONSET_RAW_RMS_MIN ||
        currentRms / Math.max(priorRms, DSP_EPSILON) < ONSET_RMS_RISE_RATIO
      )
        continue;
      // Flux peaks can lead a physical transient inside the centred FFT window.
      // Refine from the actual source samples, without a global song/audio offset.
      const centerSample = Math.round((t * ANALYSIS_SR) / 1000);
      const lo = Math.max(1, centerSample - FFT_SIZE / 2),
        hi = Math.min(mono.length, centerSample + FFT_SIZE / 2);
      let peakSample = centerSample,
        peakRise = -Infinity;
      for (let sample = lo; sample < hi; sample++) {
        const rise = mono[sample]! ** 2 - mono[sample - 1]! ** 2;
        if (rise > peakRise) {
          peakRise = rise;
          peakSample = sample;
        }
      }
      t = (peakSample / ANALYSIS_SR) * 1000;
      const onset: Onset = { t, strength: clamp01(value), band };
      if (n - last >= minFrames) {
        result.push(onset);
        lastIndex = result.length - 1;
        last = n;
      } else if (value > values[last]!) {
        result[lastIndex] = onset;
        last = n;
      }
    }
  }
  result.sort((a, b) => a.t - b.t || BANDS.indexOf(a.band) - BANDS.indexOf(b.band));
  const lastByBand = new Map<Onset['band'], Onset>();
  const removed = new Set<Onset>();
  for (const onset of result) {
    const previous = lastByBand.get(onset.band);
    if (previous && onset.t - previous.t < ONSET_MIN_GAP_MS) {
      if (onset.strength > previous.strength) {
        removed.add(previous);
        lastByBand.set(onset.band, onset);
      } else removed.add(onset);
    } else lastByBand.set(onset.band, onset);
  }
  return result.filter((onset) => !removed.has(onset));
}
