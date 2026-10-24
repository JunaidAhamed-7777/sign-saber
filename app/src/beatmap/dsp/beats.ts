import {
  ANALYSIS_SR,
  BEAT_EDGE_PAD_PERIODS,
  BEAT_MAX_PERIOD_FACTOR,
  BEAT_MIN_PERIOD_FACTOR,
  BEAT_TIGHTNESS,
  FFT_SIZE,
  SNAP_GRID,
  SNAP_MAX_MS,
  UNSNAPPED_MIN_STRENGTH,
} from '../../core/constants';
import type { Onset } from '../types';
import { HOP_MS } from './stft';
import { BANDS } from './stft';
import type { TempoResult } from './tempo';

/** Ellis dynamic programming, preserving source sample zero as the time origin. */
export function trackBeats(tempo: TempoResult, onsets: Onset[], durationMs: number): number[] {
  const envelope = tempo.envelope,
    period = tempo.periodFrames;
  if (!onsets.length || !envelope.length) return [];
  const lo = Math.max(1, Math.round(BEAT_MIN_PERIOD_FACTOR * period));
  const hi = Math.max(lo, Math.round(BEAT_MAX_PERIOD_FACTOR * period));
  const costs = new Float64Array(envelope.length),
    previous = new Int32Array(envelope.length);
  previous.fill(-1);
  for (let n = 0; n < envelope.length; n++) {
    let best = -Infinity,
      arg = -1;
    for (let lag = lo; lag <= hi && n - lag >= 0; lag++) {
      const value = costs[n - lag]! - BEAT_TIGHTNESS * Math.log(lag / period) ** 2;
      if (value > best) {
        best = value;
        arg = n - lag;
      }
    }
    costs[n] = envelope[n]! + (arg < 0 ? 0 : best);
    previous[n] = arg;
  }
  let start = Math.max(0, envelope.length - hi);
  for (let n = start; n < envelope.length; n++) if (costs[n]! > costs[start]!) start = n;
  const result: number[] = [];
  const first = onsets[0]!.t - BEAT_EDGE_PAD_PERIODS * period * HOP_MS;
  const last = onsets.at(-1)!.t + BEAT_EDGE_PAD_PERIODS * period * HOP_MS;
  for (let n = start; n >= 0; n = previous[n]!) {
    const t = n * HOP_MS;
    if (t >= first && t <= last && t <= durationMs) result.push(t);
  }
  const refined = result.reverse();
  const radiusMs = (FFT_SIZE / 2 / ANALYSIS_SR) * 1000;
  let onsetIndex = 0;
  for (let i = 0; i < refined.length; i++) {
    const t = refined[i]!;
    while (
      onsetIndex + 1 < onsets.length &&
      Math.abs(onsets[onsetIndex + 1]!.t - t) <= Math.abs(onsets[onsetIndex]!.t - t)
    )
      onsetIndex++;
    const onset = onsets[onsetIndex];
    if (onset && Math.abs(onset.t - t) <= radiusMs) refined[i] = onset.t;
  }
  return refined;
}

export function snapOnsets(onsets: Onset[], beats: number[]): Onset[] {
  if (beats.length < 2) return [];
  const grid: number[] = [];
  for (let i = 0; i < beats.length - 1; i++) {
    for (let sub = 0; sub < SNAP_GRID; sub++)
      grid.push(beats[i]! + (sub / SNAP_GRID) * (beats[i + 1]! - beats[i]!));
  }
  grid.push(beats.at(-1)!);
  const result: Onset[] = [];
  let gi = 0;
  for (const onset of onsets) {
    while (gi + 1 < grid.length && Math.abs(grid[gi + 1]! - onset.t) < Math.abs(grid[gi]! - onset.t)) gi++;
    const target = grid[gi]!;
    if (Math.abs(target - onset.t) <= SNAP_MAX_MS) result.push({ ...onset, t: target });
    else if (onset.strength >= UNSNAPPED_MIN_STRENGTH) result.push({ ...onset });
  }
  result.sort((a, b) => a.t - b.t || BANDS.indexOf(a.band) - BANDS.indexOf(b.band));
  const merged: Onset[] = [];
  for (const onset of result) {
    const previous = merged.at(-1);
    if (previous && previous.t === onset.t && previous.band === onset.band)
      previous.strength = Math.max(previous.strength, onset.strength);
    else merged.push(onset);
  }
  return merged;
}
