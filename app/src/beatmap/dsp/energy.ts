import {
  ANALYSIS_SR,
  BUILD_DROP_LOOKAHEAD_MS,
  BUILD_MAX_DIPS,
  BUILD_MAX_DIP_DEPTH,
  BUILD_MIN_RISE,
  BUILD_WINDOW_MS,
  CALM_MIN_GAP_MS,
  CALM_PERCENTILE,
  CALM_WINDOW_MS,
  DROP_BASELINE_END_MS,
  DROP_MIN_BUILD_MS,
  DROP_MIN_ENERGY,
  DROP_MIN_GAP_MS,
  DROP_RISE_RATIO,
  DSP_EPSILON,
  ENERGY_HOP_MS,
  ENERGY_NORM_PERCENTILE,
  KICK_MIN_GAP_BEATS,
  KICK_MIN_STRENGTH,
  SECTION_SMOOTH_MS,
} from '../../core/constants';
import type { MusicEvent, Onset } from '../types';
import { clamp01, movingAverage, percentile } from './numeric';

export function rmsEnvelope(mono: Float32Array): Float32Array {
  const hop = (ANALYSIS_SR * ENERGY_HOP_MS) / 1000;
  const result = new Float32Array(Math.ceil(mono.length / hop));
  for (let i = 0; i < result.length; i++) {
    const start = Math.floor(i * hop),
      end = Math.min(mono.length, Math.floor((i + 1) * hop));
    let total = 0;
    for (let n = start; n < end; n++) total += mono[n]! * mono[n]!;
    result[i] = Math.sqrt(total / Math.max(1, end - start));
  }
  return result;
}
export function normalizedEnergy(raw: Float32Array): number[] {
  const scale = Math.max(percentile(raw, ENERGY_NORM_PERCENTILE), DSP_EPSILON);
  return Array.from(raw, (v) => clamp01(v / scale));
}
function nearestBeat(t: number, beats: number[]): number {
  let best = t,
    delta = Infinity;
  for (const beat of beats) {
    const distance = Math.abs(beat - t);
    if (distance < delta) {
      best = beat;
      delta = distance;
    }
  }
  return best;
}

export function musicEvents(
  energy: number[],
  onsets: Onset[],
  beats: number[],
  bpm: number,
  confident: boolean,
): MusicEvent[] {
  const events: MusicEvent[] = [];
  let lastKick = -Infinity;
  for (const onset of onsets) {
    if (
      onset.band === 'low' &&
      onset.strength >= KICK_MIN_STRENGTH &&
      onset.t - lastKick >= (KICK_MIN_GAP_BEATS * 60000) / bpm
    ) {
      events.push({ t: onset.t, kind: 'kick', intensity: onset.strength });
      lastKick = onset.t;
    }
  }
  const smooth = movingAverage(energy, Math.ceil(SECTION_SMOOTH_MS / ENERGY_HOP_MS));
  let lastDrop = -Infinity,
    lastCalm = -Infinity;
  const drops: MusicEvent[] = [];
  const baselineFrames = Math.ceil(DROP_MIN_BUILD_MS / ENERGY_HOP_MS),
    endFrames = Math.ceil(DROP_BASELINE_END_MS / ENERGY_HOP_MS);
  if (confident) {
    for (let i = baselineFrames; i < smooth.length; i++) {
      const t = i * ENERGY_HOP_MS,
        value = smooth[i]!;
      if (value < DROP_MIN_ENERGY || t - lastDrop < DROP_MIN_GAP_MS) continue;
      let sum = 0,
        max = 0;
      for (let j = i - baselineFrames; j <= i - endFrames; j++) {
        sum += smooth[j]!;
        max = Math.max(max, smooth[j]!);
      }
      const mean = sum / (baselineFrames - endFrames + 1);
      if (mean <= DSP_EPSILON || value < DROP_RISE_RATIO * mean || max > value / DROP_RISE_RATIO) continue;
      const event: MusicEvent = {
        t: nearestBeat(t, beats),
        kind: 'drop',
        intensity: clamp01((value - mean) / mean),
      };
      drops.push(event);
      lastDrop = event.t;
    }
  }
  events.push(...drops);
  const buildFrames = Math.ceil(BUILD_WINDOW_MS / ENERGY_HOP_MS);
  for (const drop of drops) {
    const end = Math.floor(drop.t / ENERGY_HOP_MS);
    for (
      let i = Math.max(buildFrames, end - Math.ceil(BUILD_DROP_LOOKAHEAD_MS / ENERGY_HOP_MS));
      i <= end;
      i++
    ) {
      const start = i - buildFrames,
        rise = smooth[i]! - smooth[start]!;
      if (rise < BUILD_MIN_RISE) continue;
      let dips = 0,
        invalid = false;
      for (let j = start + 1; j <= i; j++) {
        const fall = smooth[j - 1]! - smooth[j]!;
        if (fall > 0) {
          dips++;
          if (fall >= BUILD_MAX_DIP_DEPTH) invalid = true;
        }
      }
      if (!invalid && dips <= BUILD_MAX_DIPS) {
        events.push({ t: start * ENERGY_HOP_MS, kind: 'build', intensity: clamp01(rise) });
        break;
      }
    }
  }
  const calmCeiling = percentile(smooth, CALM_PERCENTILE),
    calmFrames = Math.ceil(CALM_WINDOW_MS / ENERGY_HOP_MS);
  let calmRun = 0;
  for (let i = 0; i < smooth.length; i++) {
    calmRun = smooth[i]! <= calmCeiling ? calmRun + 1 : 0;
    const t = (i - calmFrames + 1) * ENERGY_HOP_MS;
    if (calmRun === calmFrames && t - lastCalm >= CALM_MIN_GAP_MS) {
      events.push({
        t: nearestBeat(t, beats),
        kind: 'calm',
        intensity: clamp01(1 - smooth[i]! / Math.max(calmCeiling, DSP_EPSILON)),
      });
      lastCalm = t;
    }
  }
  return events.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
}
