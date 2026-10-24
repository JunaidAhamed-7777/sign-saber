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
  TEMPO_REFINE_RANGE,
  TEMPO_REFINE_STEP,
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

/** Support onsets within ±SNAP_MAX_MS of the best rigid-grid phase for a beat period (ms). */
export function gridAlignment(times: readonly number[], periodMs: number): number {
  if (!times.length) return 0;
  const phases = times.map((t) => ((t % periodMs) + periodMs) % periodMs).sort((a, b) => a - b);
  const n = phases.length;
  let best = 0,
    hi = 0;
  // Circular two-pointer count of phases within the tolerance after each candidate phase centre.
  const unwrapped = phases.concat(phases.map((p) => p + periodMs));
  let lo = 0;
  for (let i = n; i < 2 * n; i++) {
    const centre = unwrapped[i]!;
    while (unwrapped[lo]! < centre - SNAP_MAX_MS) lo++;
    hi = Math.max(hi, i);
    while (hi + 1 < unwrapped.length && unwrapped[hi + 1]! <= centre + SNAP_MAX_MS) hi++;
    best = Math.max(best, Math.min(n, hi - lo + 1));
  }
  return best;
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
  // A rigid grid whose period is off by a fraction of a hop drifts out of phase over minutes. Search
  // nearby periods for the one most supported onsets agree with. The tolerance makes the maximum a
  // plateau of periods; its middle is the estimate, and ties between plateaus keep the closest one.
  if (support.length >= TEMPO_MIN_SUPPORT_ONSETS) {
    const times = support.map((o) => o.t);
    const base = periodFrames;
    const steps = Math.round(TEMPO_REFINE_RANGE / TEMPO_REFINE_STEP);
    const counts: number[] = [];
    for (let k = -steps; k <= steps; k++) {
      const candidate = base * (1 + k * TEMPO_REFINE_STEP);
      const inRange = candidate >= (60 * frameHz) / BPM_MAX && candidate <= (60 * frameHz) / BPM_MIN;
      counts.push(inRange ? gridAlignment(times, candidate * HOP_MS) : -1);
    }
    const best = Math.max(...counts);
    let chosen = steps,
      chosenDistance = Infinity;
    for (let start = 0; start < counts.length; start++) {
      if (counts[start] !== best || counts[start - 1] === best) continue;
      let end = start;
      while (counts[end + 1] === best) end++;
      const middle = (start + end) / 2;
      if (Math.abs(middle - steps) < chosenDistance) {
        chosen = middle;
        chosenDistance = Math.abs(middle - steps);
      }
    }
    periodFrames = base * (1 + (chosen - steps) * TEMPO_REFINE_STEP);
  }
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
