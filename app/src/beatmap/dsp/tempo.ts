import {
  ANALYSIS_SR,
  BPM_MAX,
  BPM_MIN,
  BPM_PRIOR,
  CHORD_WINDOW_MS,
  DSP_EPSILON,
  HOP,
  SNAP_MAX_MS,
  TEMPO_DETREND_FRAMES,
  TEMPO_HARMONIC_WEIGHT,
  TEMPO_MIN_SUPPORT_ONSETS,
  TEMPO_OCTAVE_SWITCH_RATIO,
  TEMPO_PRIOR_SIGMA_OCT,
  TEMPO_SUPPORT_MIN_STRENGTH,
} from '../../core/constants';
import type { Onset } from '../types';
import { clamp01, movingAverage, percentile } from './numeric';
import { HOP_MS } from './stft';

export interface TempoResult {
  bpm: number;
  periodFrames: number;
  confidence: number;
  phaseMs: number;
  envelope: Float32Array;
}
export function distinctOnsets(onsets: Onset[]): Onset[] {
  const groups: Onset[] = [];
  for (const onset of onsets) {
    const anchor = groups.at(-1);
    if (!anchor || onset.t - anchor.t >= CHORD_WINDOW_MS) groups.push(onset);
  }
  return groups;
}

export function estimateTempo(sum: Float32Array, onsets: Onset[]): TempoResult {
  const average = movingAverage(sum, TEMPO_DETREND_FRAMES);
  const envelope = Float32Array.from(sum, (v, i) => Math.max(0, v - average[i]!));
  const frameHz = ANALYSIS_SR / HOP;
  const lagMin = Math.max(1, Math.round((60 * frameHz) / BPM_MAX)),
    lagMax = Math.round((60 * frameHz) / BPM_MIN);
  const ac = new Float64Array(2 * lagMax + 2),
    score = new Float64Array(lagMax + 2);
  for (let lag = Math.max(1, Math.floor(lagMin / 2)); lag < ac.length; lag++) {
    let value = 0;
    for (let n = 0; n + lag < envelope.length; n++) value += envelope[n]! * envelope[n + lag]!;
    ac[lag] = value / Math.max(1, envelope.length - lag);
  }
  const interpolate = (lag: number): number => {
    const a = Math.floor(lag),
      f = lag - a;
    return (ac[a] ?? 0) * (1 - f) + (ac[a + 1] ?? 0) * f;
  };
  let winner = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * frameHz) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / BPM_PRIOR) / TEMPO_PRIOR_SIGMA_OCT) ** 2);
    score[lag] = ac[lag]! * prior;
    if (score[lag]! > score[winner]!) winner = lag;
  }
  const harmonic = (lag: number): number => {
    const bpm = (60 * frameHz) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / BPM_PRIOR) / TEMPO_PRIOR_SIGMA_OCT) ** 2);
    return (interpolate(lag) + TEMPO_HARMONIC_WEIGHT * (interpolate(lag / 2) + interpolate(lag * 2))) * prior;
  };
  let selected = winner;
  for (const candidate of [winner / 2, winner * 2]) {
    if (
      candidate >= lagMin &&
      candidate <= lagMax &&
      harmonic(candidate) >= harmonic(selected) * TEMPO_OCTAVE_SWITCH_RATIO
    )
      selected = candidate;
  }
  const center = Math.round(selected),
    left = ac[center - 1] ?? 0,
    middle = ac[center] ?? 0,
    right = ac[center + 1] ?? 0;
  const denominator = left - 2 * middle + right;
  const shift =
    Math.abs(denominator) > DSP_EPSILON
      ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator)))
      : 0;
  let periodFrames = Math.max((60 * frameHz) / BPM_MAX, Math.min((60 * frameHz) / BPM_MIN, center + shift));
  const support = distinctOnsets(onsets.filter((o) => o.strength >= TEMPO_SUPPORT_MIN_STRENGTH));
  // Long event spans refine the same autocorrelation period without forcing a rigid note grid.
  // Timing quantization of one STFT hop otherwise biases a 128 BPM click train to 129.2.
  let totalSpan = 0,
    totalPeriods = 0;
  const provisionalMs = periodFrames * HOP_MS;
  for (let i = 1; i < support.length; i++) {
    const span = support[i]!.t - support[0]!.t;
    const count = Math.round(span / provisionalMs);
    if (count > 0 && Math.abs(span - count * provisionalMs) <= SNAP_MAX_MS) {
      totalSpan += span * count;
      totalPeriods += count * count;
    }
  }
  if (totalPeriods > 0)
    periodFrames = Math.max(
      (60 * frameHz) / BPM_MAX,
      Math.min((60 * frameHz) / BPM_MIN, totalSpan / totalPeriods / HOP_MS),
    );
  const periodMs = periodFrames * HOP_MS;
  let phaseMs = 0,
    bestSupport = 0,
    bestDistance = Infinity;
  for (const candidate of support) {
    const phase = candidate.t % periodMs;
    let aligned = 0,
      distance = 0;
    for (const onset of support) {
      const delta = Math.abs((((onset.t - phase) % periodMs) + periodMs) % periodMs);
      const circular = Math.min(delta, periodMs - delta);
      if (circular <= SNAP_MAX_MS) aligned++;
      distance += circular;
    }
    if (
      aligned > bestSupport ||
      (aligned === bestSupport && distance < bestDistance) ||
      (aligned === bestSupport && distance === bestDistance && phase < phaseMs)
    ) {
      phaseMs = phase;
      bestSupport = aligned;
      bestDistance = distance;
    }
  }
  const candidates = Array.from(score.subarray(lagMin, lagMax + 1));
  const best = score[winner]!;
  const peakContrast = clamp01((best - percentile(candidates, 50)) / Math.max(best, DSP_EPSILON));
  const confidence =
    support.length < TEMPO_MIN_SUPPORT_ONSETS ? 0 : Math.min(peakContrast, bestSupport / support.length);
  return { bpm: Math.round((60000 / periodMs) * 10) / 10, periodFrames, confidence, phaseMs, envelope };
}
